// ONDC BAP `on_init` callback — the asynchronous other half of `init`.
//
// `init` (see init/route.ts) is split across two HTTP exchanges:
//   1. We POST `init` to the CHOSEN BPP → sync ACK/NACK only (no firm order yet).
//   2. That BPP finalizes the order and POSTs an `on_init` HERE, to
//      `bap_uri/on_init`, carrying the firmed-up `message.order`: the final
//      `quote`, the buyer's `billing` echoed back, `payments` terms, and the
//      `fulfillments` (confirmed serviceability / delivery). This route is that
//      inbound endpoint.
//
// Callback lifecycle handled below, in order (identical to on_select):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / order / quote /
//      fulfillments
//   e. hand off to a persistence seam (no DB yet — see persistOnInitOrder)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// ONE callback per init (NOT many):  like on_select and unlike on_search, `init`
// is DIRECTED at a single BPP, so we expect exactly ONE `on_init` for a given
// (transaction_id, bpp_id). A BPP may re-issue (e.g. payment/quote changes), so
// the natural store key is still (transaction_id, bpp_id) with the latest
// message_id winning. See persistOnInitOrder.
//
// transaction_id is the spine:  it is minted in search/route.ts, reused by
// select → init when directing this BPP, and echoed back here — so the whole
// chain (search ↔ on_search ↔ select ↔ on_select ↔ init ↔ on_init) joins on the
// same id. That is how this firmed-up order is matched to the init it answers,
// and how confirm later continues the same order.
//
// Mirrors the existing route conventions (NextResponse, runtime = "nodejs").
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import { resolveBppSigningPublicKey } from "@/lib/ondc/registry";
import {
  parseAuthorizationHeader,
  normalizeEd25519PublicKey,
  verifyOndcSignature,
} from "@/lib/ondc/auth";
import type { OndcAckResponse, OndcError } from "@/lib/ondc/client";
import { saveInitOrder } from "@/lib/ondc/store";
import { validatePayments } from "@/lib/ondc/payment";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's order/quote is large and we
// pass it through opaquely to the persistence layer. snake_case = wire format.
type OnInitContext = {
  domain?: string;
  action?: string; // must be "on_init"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns the order it firmed up. We read the quote (final pricing) and
// fulfillments (confirmed serviceability / delivery), keep the whole order for
// downstream confirm, and otherwise treat the order opaquely.
type OnInitOrder = {
  quote?: unknown;
  payments?: unknown;
  fulfillments?: unknown;
};

type OnInitCallback = {
  context?: OnInitContext;
  message?: { order?: OnInitOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnInit = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The full firmed-up order, retained opaquely for confirm (billing/payments
  // echoed back, plus everything below).
  order: OnInitOrder;
  quote: unknown;
  payments: unknown;
  fulfillments: unknown;
};

// ---------------------------------------------------------------------------
// ACK / NACK responses (BAP → caller, the sync reply ONDC expects)
// ---------------------------------------------------------------------------

function ack(): NextResponse {
  const body: OndcAckResponse = { message: { ack: { status: "ACK" } } };
  return NextResponse.json(body, { status: 200 });
}

// A NACK carries an error block and a non-2xx status so the sender can tell it
// apart. We keep `error.message` terse on auth failures — never echo back *why*
// a signature failed (don't coach a forger); the real reason is logged instead.
function nack(httpStatus: number, error: OndcError): NextResponse {
  const body: OndcAckResponse = {
    message: { ack: { status: "NACK" } },
    error,
  };
  return NextResponse.json(body, { status: httpStatus });
}

// ---------------------------------------------------------------------------
// BPP signing-key resolution (registry lookup)
// ---------------------------------------------------------------------------
//
// The SENDER's signing public key is resolved from the ONDC registry by the
// shared resolver in @/lib/ondc/registry (imported above) — the single place
// that knows how a key is fetched (strict unique_key_id match, fail-closed).
// Extracted from a per-route copy that was duplicated across all 10 callbacks.

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Pull out the required fields, or return an error string naming the first
// problem. Keeps the handler linear and the rules in one auditable place.
function extractAndValidate(
  payload: OnInitCallback
): { ok: true; data: ExtractedOnInit } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_init") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider firmed up the order — required to
  // match this back to the init we sent, and to key persistence.
  if (!isNonEmptyString(ctx.bpp_id)) {
    return { ok: false, reason: "missing bpp_id" };
  }
  if (!isNonEmptyString(ctx.bpp_uri)) {
    return { ok: false, reason: "missing bpp_uri" };
  }
  const order = payload.message?.order;
  if (order === null || typeof order !== "object") {
    return { ok: false, reason: "missing message.order" };
  }
  // The quote is the firmed-up price — a valid on_init must carry one (it's what
  // confirm commits to).
  const quote = order.quote;
  if (quote === null || typeof quote !== "object") {
    return { ok: false, reason: "missing message.order.quote" };
  }
  // Payment metadata validation (shared, enum-aware). Absent payments → valid.
  const paymentsCheck = validatePayments(order.payments);
  if (!paymentsCheck.ok) {
    return { ok: false, reason: paymentsCheck.reason };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      // Keep the whole order so confirm can read billing/payments echoed back.
      order,
      quote,
      payments: order.payments,
      // fulfillments are optional in the shapes networks send; pass through
      // whatever the BPP included (confirmed serviceability/delivery) for later
      // stages, or undefined when absent.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — NO DATABASE YET (by design).
// ---------------------------------------------------------------------------
//
// On ACK the firmed-up order must outlive this request so the Confirm API can
// read it (confirm places the order against this quote + payment terms). Backed
// by the dummy store (src/lib/ondc/store.ts): drafts the OrderRecord for
// (transaction_id, bpp_id) at stage "init", last-write-wins, so a BPP's re-issued
// on_init replaces the prior draft. A store write failure throws (OndcStoreError)
// and the handler downgrades it to a NACK rather than silently dropping.
async function persistOnInitOrder(data: ExtractedOnInit): Promise<void> {
  await saveInitOrder({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    order: data.order,
    quote: data.quote,
    payments: data.payments,
    fulfillments: data.fulfillments,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_init persisted", {
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // Can't verify signatures without our network config loaded. A misconfig is a
  // server fault, not the sender's — NACK 500.
  if (!isOndcConfigured()) {
    return nack(500, { type: "CORE-ERROR", message: "BAP not configured" });
  }

  // (b-i) Authorization header must be present and parseable.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return nack(401, { type: "CONTEXT-ERROR", message: "missing signature" });
  }
  const parsed = parseAuthorizationHeader(authHeader);
  if (!parsed) {
    return nack(401, { type: "CONTEXT-ERROR", message: "invalid signature" });
  }

  // (a) Read the EXACT raw bytes BEFORE parsing JSON — the digest is computed
  // over these bytes, so re-serializing would break verification.
  const rawBody = await req.text();

  // (b-ii) Resolve the sender's registry public key and verify the signature.
  const publicKey = await resolveBppSigningPublicKey(
    parsed.subscriberId,
    parsed.uniqueKeyId
  );
  if (!publicKey) {
    console.warn("ondc.on_init key resolution failed", {
      subscriberId: parsed.subscriberId,
      uniqueKeyId: parsed.uniqueKeyId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  const verdict = verifyOndcSignature({
    rawBody,
    parsed,
    publicKey: normalizeEd25519PublicKey(publicKey),
  });
  if (!verdict.valid) {
    // Log the real reason; tell the sender nothing actionable.
    console.warn("ondc.on_init signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnInitCallback;
  try {
    payload = JSON.parse(rawBody) as OnInitCallback;
  } catch {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // claims to have sent this order. A mismatch means a valid participant is
  // posting under someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_init signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
  try {
    await persistOnInitOrder(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_init persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store order" });
  }

  // (f) Accept. The firmed-up order is now (will be) available for the future
  // Confirm API to read by transaction_id.
  return ack();
}
