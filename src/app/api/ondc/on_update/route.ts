// ONDC BAP `on_update` callback — the asynchronous other half of `update`.
//
// `update` (see ../update/route.ts) is split across two HTTP exchanges:
//   1. We POST `update` to the CHOSEN BPP with `{ update_target, order }` → sync
//      ACK/NACK only (the BPP accepted the request, but no updated order yet).
//   2. That BPP applies the change and POSTs an `on_update` HERE, to
//      `bap_uri/on_update`, carrying the FULL updated order: its `id` (the
//      BPP-assigned order id), the new `state`, and the `payments` /
//      `fulfillments` reflecting the change (e.g. a settled payment, a
//      rescheduled delivery, a part-cancel/return fulfillment sub-state). This
//      route is that inbound endpoint.
//
// GENERIC by design: like ../update/route.ts, this callback does NOT model
// returns/replacements specially. Whatever the BPP applied, it reports as an
// updated order; we persist the order opaquely plus the updated payments and
// fulfillments. The `update_target` is request-side metadata and is not echoed in
// the callback, so there is nothing target-specific to branch on here.
//
// Callback lifecycle handled below, in order (identical to on_cancel):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / order / order_id
//      / payments / fulfillments
//   e. hand off to a persistence seam (the dummy store — see persistOnUpdate)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// UNSOLICITED callbacks: like on_cancel, an on_update can arrive with NO preceding
// buyer /update — a BPP can push an order update (settlement, fulfillment change)
// unprompted. We must accept that: the signer is still the BPP (signer === bpp_id
// holds), and the store creates the order record defensively if this is the first
// callback we have seen for it.
//
// CORRELATION (like on_status/on_cancel, UNLIKE on_track): on_update carries the
// order and its `id`, so we key by order_id (re-asserting the secondary index) as
// well as the (transaction_id, bpp_id) composite. transaction_id is the spine —
// minted in search/route.ts, reused across select → init → confirm →
// status/track/cancel/update, and echoed back here.
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
import { validateContextFreshness } from "@/lib/ondc/context";
import {
  ONDC_ERROR,
  contextError,
  coreError,
  freshnessError,
} from "@/lib/ondc/errors";
import {
  annotateTrace,
  beginAuditTrace,
  finalizeAuditTrace,
  type AuditTrace,
} from "@/lib/ondc/audit";
import { saveUpdateOrder } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's order is large and we pass
// it through opaquely to the persistence layer. snake_case = wire format.
type OnUpdateContext = {
  domain?: string;
  action?: string; // must be "on_update"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp?: string;
  ttl?: string;
};

// The BPP returns the updated order. We read the order `id` (the BPP-assigned
// identifier), the `state` (post-update state), the `payments` (updated payment
// terms / status — the most common thing an update touches), and the
// `fulfillments`; keep the whole order for downstream reads, and otherwise treat
// the order opaquely.
type OnUpdateOrder = {
  id?: unknown;
  state?: unknown;
  payments?: unknown;
  fulfillments?: unknown;
};

type OnUpdateCallback = {
  context?: OnUpdateContext;
  message?: { order?: OnUpdateOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnUpdate = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The BPP-assigned order id — the identifier status/track/cancel/update use.
  orderId: string;
  // The full updated order, retained opaquely for later reads (state, quote,
  // plus everything below).
  order: OnUpdateOrder;
  // The updated payment terms / status, retained opaquely.
  payments: unknown;
  fulfillments: unknown;
};

// ---------------------------------------------------------------------------
// ACK / NACK responses (BAP → caller, the sync reply ONDC expects)
// ---------------------------------------------------------------------------

function ack(trace?: AuditTrace): NextResponse {
  const body: OndcAckResponse = { message: { ack: { status: "ACK" } } };
  if (trace) finalizeAuditTrace(trace, { status: 200, body });
  return NextResponse.json(body, { status: 200 });
}

// A NACK carries an error block and a non-2xx status so the sender can tell it
// apart. We keep `error.message` terse on auth failures — never echo back *why*
// a signature failed (don't coach a forger); the real reason is logged instead.
function nack(
  httpStatus: number,
  error: OndcError,
  trace?: AuditTrace
): NextResponse {
  const body: OndcAckResponse = {
    message: { ack: { status: "NACK" } },
    error,
  };
  if (trace) finalizeAuditTrace(trace, { status: httpStatus, body });
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
  payload: OnUpdateCallback
): { ok: true; data: ExtractedOnUpdate } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_update") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider owns the order — required to match
  // this back to the update we sent (or to attribute an unsolicited BPP update),
  // and to key persistence.
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
  // The order id ties this update to the placed order on_confirm introduced —
  // every action references it. A valid on_update must carry one.
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
      // payments are what an update most often touches (settlement, refund);
      // pass through whatever the BPP included, or undefined when absent.
      payments: order.payments,
      // fulfillments carry any rescheduled / returned / replaced fulfillment
      // state; pass through whatever the BPP included, or undefined.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — backed by the dummy store (src/lib/ondc/store.ts).
// ---------------------------------------------------------------------------
//
// On ACK the updated order must outlive this request so the Status/Track UI can
// read the new state. saveUpdateOrder updates the OrderRecord for
// (transaction_id, bpp_id) to stage "update" — persisting the updated `payments`
// and `fulfillments`, refreshing the opaque order + state, and appending the
// milestone to statusHistory — while preserving the rest of the lifecycle data
// (quote/tracking/cancellation). It creates the record defensively when no prior
// callback was seen (the unsolicited BPP-update case). A store write failure
// throws (OndcStoreError) and the handler downgrades it to a NACK rather than
// silently dropping.
async function persistOnUpdate(data: ExtractedOnUpdate): Promise<void> {
  await saveUpdateOrder({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    orderId: data.orderId,
    state: data.order.state,
    order: data.order,
    payments: data.payments,
    fulfillments: data.fulfillments,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_update persisted", {
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
  const trace = beginAuditTrace({
    action: "on_update",
    requestHeaders: Object.fromEntries(req.headers),
  });

  // Can't verify signatures without our network config loaded. A misconfig is a
  // server fault, not the sender's — NACK 500.
  if (!isOndcConfigured()) {
    return nack(500, coreError("BAP not configured"), trace);
  }

  // (b-i) Authorization header must be present and parseable.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "missing signature"), trace);
  }
  const parsed = parseAuthorizationHeader(authHeader);
  if (!parsed) {
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "invalid signature"), trace);
  }

  // (a) Read the EXACT raw bytes BEFORE parsing JSON — the digest is computed
  // over these bytes, so re-serializing would break verification.
  const rawBody = await req.text();
  annotateTrace(trace, { rawBody });

  // (b-ii) Resolve the sender's registry public key and verify the signature.
  const publicKey = await resolveBppSigningPublicKey(
    parsed.subscriberId,
    parsed.uniqueKeyId
  );
  if (!publicKey) {
    console.warn("ondc.on_update key resolution failed", {
      subscriberId: parsed.subscriberId,
      uniqueKeyId: parsed.uniqueKeyId,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  const verdict = verifyOndcSignature({
    rawBody,
    parsed,
    publicKey: normalizeEd25519PublicKey(publicKey),
  });
  if (!verdict.valid) {
    // Log the real reason; tell the sender nothing actionable.
    console.warn("ondc.on_update signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnUpdateCallback;
  try {
    payload = JSON.parse(rawBody) as OnUpdateCallback;
  } catch {
    return nack(400, contextError(ONDC_ERROR.CONTEXT_GENERIC, "invalid JSON"), trace);
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, contextError(ONDC_ERROR.CONTEXT_GENERIC, result.reason), trace);
  }
  annotateTrace(trace, {
    transactionId: result.data.transactionId,
    messageId: result.data.messageId,
    bppId: result.data.bppId,
  });

  // Envelope freshness: context.timestamp must be within skew, and
  // context.timestamp + context.ttl must not have elapsed. Separate from the
  // HTTP-signature freshness — that covers the signing string, this covers the
  // Beckn envelope.
  const fresh = validateContextFreshness(payload.context);
  if (!fresh.ok) {
    console.warn("ondc.on_update freshness rejected", {
      kind: fresh.failure.kind,
      transactionId: result.data.transactionId,
      bppId: result.data.bppId,
    });
    return nack(400, freshnessError(fresh.failure), trace);
  }


  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // owns this order. A mismatch means a valid participant is posting under
  // someone else's bpp_id — reject it. Holds for unsolicited BPP updates too:
  // the seller's BPP is still the signer.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_update signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnUpdate(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_update persist failed", { msg });
    return nack(500, coreError("could not store order"), trace);
  }

  // (f) Accept. The updated order is now available for the Status/Track APIs to
  // read by transaction_id / order_id.
  return ack(trace);
}
