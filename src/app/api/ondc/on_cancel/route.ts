// ONDC BAP `on_cancel` callback — the asynchronous other half of `cancel`.
//
// `cancel` (see ../cancel/route.ts) is split across two HTTP exchanges:
//   1. We POST `cancel` to the CHOSEN BPP with `{ order_id, reason }` → sync
//      ACK/NACK only (the BPP accepted the request, but no cancelled order yet).
//   2. That BPP cancels the order and POSTs an `on_cancel` HERE, to
//      `bap_uri/on_cancel`, carrying the FULL updated order: its `id` (the
//      BPP-assigned order id), `state` "Cancelled", a `cancellation` block
//      (cancelled_by / reason.id), and the `quote` / `payments` / `fulfillments`
//      reflecting any cancellation charges or refunds. This route is that
//      inbound endpoint.
//
// Callback lifecycle handled below, in order (identical to on_status):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / order / order_id
//      / cancellation / fulfillments
//   e. hand off to a persistence seam (the dummy store — see persistOnCancel)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// UNSOLICITED callbacks: unlike status/track, an on_cancel can arrive with NO
// preceding buyer /cancel — a seller can FORCE-CANCEL an order and push the
// on_cancel unprompted. We must accept that: the signer is still the BPP
// (signer === bpp_id holds), and the store creates the order record defensively
// if this is the first callback we have seen for it.
//
// CORRELATION (like on_status, UNLIKE on_track): on_cancel carries the order and
// its `id`, so we key by order_id (re-asserting the secondary index) as well as
// the (transaction_id, bpp_id) composite. transaction_id is the spine — minted
// in search/route.ts, reused by select → init → confirm → status/track/cancel,
// and echoed back here.
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
import { saveCancelUpdate } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's order is large and we pass
// it through opaquely to the persistence layer. snake_case = wire format.
type OnCancelContext = {
  domain?: string;
  action?: string; // must be "on_cancel"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns the cancelled order. We read the order `id` (the BPP-assigned
// identifier), the `state` ("Cancelled"), the `cancellation` block (who/why),
// and the `fulfillments`; keep the whole order for downstream reads, and
// otherwise treat the order opaquely.
type OnCancelOrder = {
  id?: unknown;
  state?: unknown;
  cancellation?: unknown;
  fulfillments?: unknown;
};

type OnCancelCallback = {
  context?: OnCancelContext;
  message?: { order?: OnCancelOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnCancel = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The BPP-assigned order id — the identifier status/track/cancel/update use.
  orderId: string;
  // The full order snapshot, retained opaquely for later reads (state, quote,
  // payments echoed back, plus everything below).
  order: OnCancelOrder;
  // The cancellation block (cancelled_by / reason.id / …), retained opaquely.
  cancellation: unknown;
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
  payload: OnCancelCallback
): { ok: true; data: ExtractedOnCancel } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_cancel") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider owns the order — required to match
  // this back to the cancel we sent (or to attribute an unsolicited seller
  // cancel), and to key persistence.
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
  // The order id ties this cancellation to the placed order on_confirm
  // introduced — every later action references it. A valid on_cancel must carry
  // one.
  if (!isNonEmptyString(order.id)) {
    return { ok: false, reason: "missing message.order.id" };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      orderId: order.id,
      // Keep the whole order so later reads can see state/quote/payments.
      order,
      // The cancellation block (cancelled_by / reason.id) — pass through whatever
      // the BPP included, or undefined when absent.
      cancellation: order.cancellation,
      // fulfillments carry any RTO / refund-related fulfillment state; pass
      // through whatever the BPP included for later reads, or undefined.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — backed by the dummy store (src/lib/ondc/store.ts).
// ---------------------------------------------------------------------------
//
// On ACK the cancelled order must outlive this request so the Status/Track UI
// can read the terminal state. saveCancelUpdate updates the OrderRecord for
// (transaction_id, bpp_id) to stage "cancel" — recording the `cancellation`
// block AND appending the terminal Cancelled milestone to statusHistory — while
// preserving the rest of the lifecycle data (order/quote/tracking). It creates
// the record defensively when no prior callback was seen (the unsolicited
// seller-cancel case). A store write failure throws (OndcStoreError) and the
// handler downgrades it to a NACK rather than silently dropping.
async function persistOnCancel(data: ExtractedOnCancel): Promise<void> {
  await saveCancelUpdate({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    orderId: data.orderId,
    state: data.order.state,
    order: data.order,
    cancellation: data.cancellation,
    fulfillments: data.fulfillments,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_cancel persisted", {
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    orderId: data.orderId,
    state: data.order.state,
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
    console.warn("ondc.on_cancel key resolution failed", {
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
    console.warn("ondc.on_cancel signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnCancelCallback;
  try {
    payload = JSON.parse(rawBody) as OnCancelCallback;
  } catch {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // owns this order. A mismatch means a valid participant is posting under
  // someone else's bpp_id — reject it. Holds for unsolicited seller cancels too:
  // the seller's BPP is still the signer.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_cancel signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnCancel(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_cancel persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store order" });
  }

  // (f) Accept. The cancelled order is now available for the Status/Track APIs to
  // read by transaction_id / order_id.
  return ack();
}
