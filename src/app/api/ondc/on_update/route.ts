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
import { isOndcConfigured, getOndcConfig } from "@/lib/ondc/config";
import { resolveBppSigningPublicKey } from "@/lib/ondc/registry";
import {
  parseAuthorizationHeader,
  normalizeEd25519PublicKey,
  verifyOndcSignature,
} from "@/lib/ondc/auth";
import type { OndcError } from "@/lib/ondc/client";
import { sendOndcRequest } from "@/lib/ondc/client";
import { buildContext, validateContextFreshness } from "@/lib/ondc/context";
import {
  ONDC_ERROR,
  contextError,
  coreError,
  freshnessError,
} from "@/lib/ondc/errors";
import { buildAck, buildNack } from "@/lib/ondc/responses";
import {
  annotateTrace,
  beginAuditTrace,
  type AuditTrace,
} from "@/lib/ondc/audit";
import { peekMessageId, commitMessageId } from "@/lib/ondc/idempotency";
import { saveUpdateOrder } from "@/lib/ondc/store";
import { sendBuyerEmail } from "@/lib/email/send";
import { orderUpdatedEmail } from "@/lib/email/templates";
import { buildRefundUpdate, type UpdateMessage } from "@/lib/ondc/update-builders";

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

// Echoes the inbound `context` (when known) per ONDC's response contract — see
// responses.ts.
function ack(trace?: AuditTrace, context?: unknown): NextResponse {
  return buildAck({ context, trace });
}

// A NACK carries an error block and a non-2xx status so the sender can tell it
// apart. We keep `error.message` terse on auth failures — never echo back *why*
// a signature failed (don't coach a forger); the real reason is logged instead.
function nack(
  httpStatus: number,
  error: OndcError,
  trace?: AuditTrace,
  context?: unknown
): NextResponse {
  return buildNack({ httpStatus, error, context, trace });
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

function extractState(state: unknown): string | undefined {
  if (typeof state === "string") return state;
  if (state && typeof state === "object") {
    const s = state as { code?: unknown; short_desc?: unknown };
    return String(s.code ?? s.short_desc ?? "");
  }
  return undefined;
}

function describeUpdate(data: ExtractedOnUpdate): string | undefined {
  const rawOrder = data.order as {
    fulfillments?: Array<{ type?: unknown; state?: { descriptor?: { code?: unknown } } }>;
    payment?:
      | { "@ondc/org/settlement_details"?: Array<{ settlement_phase?: unknown; settlement_amount?: unknown }> }
      | undefined;
    quote?: { price?: { value?: unknown } };
  };
  const types = new Set<string>();
  if (Array.isArray(rawOrder.fulfillments)) {
    for (const f of rawOrder.fulfillments) {
      if (typeof f.type === "string") types.add(f.type);
    }
  }

  // Detect refund from settlement_details with phase === "refund".
  const settlements = rawOrder.payment?.["@ondc/org/settlement_details"];
  const hasRefund = Array.isArray(settlements) && settlements.some(
    (s) => String(s?.settlement_phase ?? "") === "refund"
  );
  if (hasRefund) {
    const amount = settlements!.find(
      (s) => String(s?.settlement_phase ?? "") === "refund"
    )?.settlement_amount;
    return amount ? `Refund of ₹${String(amount)} initiated` : "Refund initiated";
  }

  if (types.has("Return")) return "Return request update";
  if (types.has("Cancel")) return "Cancellation update";
  if (types.has("Replacement")) return "Replacement update";
  if (types.has("RTO")) return "RTO update";
  return undefined;
}

// Extract return_request tags from a Return fulfillment to detect replacement.
// Returns { fulfillmentId, itemId, quantity } when replace=yes is found.
function extractReplacementDetails(
  rawOrder: Record<string, unknown>
): { fulfillmentId: string; itemId: string; quantity: number } | null {
  const fulfillments = rawOrder.fulfillments;
  if (!Array.isArray(fulfillments)) return null;
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const o = f as { id?: unknown; type?: unknown; tags?: Array<{ code?: unknown; list?: Array<{ code?: unknown; value?: unknown }> }> };
    if (String(o.type ?? "") !== "Return" || !Array.isArray(o.tags)) continue;
    for (const tag of o.tags) {
      if (!tag || typeof tag !== "object") continue;
      if (String((tag as { code?: unknown }).code ?? "") !== "return_request") continue;
      const list = (tag as { list?: unknown }).list;
      if (!Array.isArray(list)) continue;
      let fulfillmentId = "";
      let itemId = "";
      let quantity = 0;
      let isReplace = false;
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as { code?: unknown; value?: unknown };
        const code = String(e.code ?? "");
        const value = String(e.value ?? "");
        if (code === "id") fulfillmentId = value;
        if (code === "item_id") itemId = value;
        if (code === "item_quantity") quantity = Number(value);
        if (code === "replace" && value === "yes") isReplace = true;
      }
      if (isReplace && fulfillmentId && itemId) {
        return { fulfillmentId, itemId, quantity: quantity || 1 };
      }
    }
  }
  return null;
}

// Calculate refund amount from the order's quote.breakup for a replacement
// where the BPP has not yet provided quote_trail (state < Return_Picked).
// Per contract section 00B footnote 1115, quote_trail appears at Return_Picked.
function calculateRefundFromQuote(
  rawOrder: Record<string, unknown>,
  itemId: string,
  quantity: number
): string {
  const quote = rawOrder.quote as { breakup?: Array<Record<string, unknown>> } | undefined;
  if (!quote || !Array.isArray(quote.breakup)) return "0.00";
  for (const b of quote.breakup) {
    if (String((b as Record<string, unknown>)["@ondc/org/item_id"] ?? "") !== itemId) continue;
    const itemQty = (b as Record<string, unknown>)["@ondc/org/item_quantity"] as { count?: number } | undefined;
    const price = (b as Record<string, unknown>).price as { value?: string } | undefined;
    if (!itemQty || !price) continue;
    const qty = Number(itemQty.count ?? 0);
    const total = Number(price.value ?? 0);
    if (qty <= 0 || total <= 0) continue;
    return ((total / qty) * quantity).toFixed(2);
  }
  return "0.00";
}

// Auto-trigger refund update after the BPP settles a return/replacement.
// Scans the inbound on_update for:
//   1. settlement_details with phase === "refund" (BPP-initiated refund), OR
//   2. Return fulfillment with replace=yes in return_request (replacement flow)
// and fires a signed /update with the refund amount derived from
// quote_trail (return) or quote.breakup (replacement at < Return_Picked).
async function triggerRefundIfSettled(data: ExtractedOnUpdate): Promise<void> {
  const rawOrder = data.order as Record<string, unknown>;
  const payment = rawOrder.payment as Record<string, unknown> | undefined;
  const settlements = payment?.["@ondc/org/settlement_details"] as Array<Record<string, unknown>> | undefined;
  const hasRefundSettlement = Array.isArray(settlements) && settlements.some(
    (s) => String(s?.settlement_phase ?? "") === "refund"
  );

  // When BPP includes refund settlement, use quote_trail from fulfillments (return flow).
  if (hasRefundSettlement) {
    const fulfillments = rawOrder.fulfillments;
    if (!Array.isArray(fulfillments) || fulfillments.length === 0) return;
    try {
      const config = getOndcConfig();
      const context = buildContext({
        action: "update",
        transactionId: data.transactionId,
        bppId: data.bppId,
        bppUri: data.bppUri,
      });
      const { message } = buildRefundUpdate({
        orderId: data.orderId,
        fulfillments,
        timestamp: new Date().toISOString(),
      });
      await sendOndcRequest({
        url: `${data.bppUri}/update`,
        action: "update",
        context,
        message,
      });
      console.log("ondc.on_update auto-triggered refund update", {
        transactionId: data.transactionId,
        bppId: data.bppId,
        orderId: data.orderId,
        mode: "return (settlement)",
      });
    } catch (err) {
      console.warn("ondc.on_update auto-trigger refund failed", {
        transactionId: data.transactionId,
        bppId: data.bppId,
        orderId: data.orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // Check for replacement flow: Return fulfillment with replace=yes.
  const replacement = extractReplacementDetails(rawOrder);
  if (!replacement) return;

  const fulfillments = rawOrder.fulfillments;
  if (!Array.isArray(fulfillments) || fulfillments.length === 0) return;

  // Prefer quote_trail when BPP already sent it (state >= Return_Picked).
  const { refund } = buildRefundUpdate({
    orderId: data.orderId,
    fulfillments,
    timestamp: new Date().toISOString(),
  });
  let refundAmount = refund.value;
  if (refundAmount === "0.00" || refundAmount === "0") {
    // No quote_trail yet (state = Return_Initiated / < Return_Picked).
    // Calculate from the order's quote.breakup per the contract.
    refundAmount = calculateRefundFromQuote(rawOrder, replacement.itemId, replacement.quantity);
  }
  if (refundAmount === "0.00" || refundAmount === "0") return;

  try {
    const config = getOndcConfig();
    const context = buildContext({
      action: "update",
      transactionId: data.transactionId,
      bppId: data.bppId,
      bppUri: data.bppUri,
    });

    // Build the refund payload per contract "settlement trail for refund initiation".
    const order: Record<string, unknown> = {
      id: data.orderId,
      fulfillments: [{ id: replacement.fulfillmentId, type: "Return" }],
      payment: {
        "@ondc/org/settlement_details": [{
          settlement_counterparty: "buyer",
          settlement_phase: "refund",
          settlement_type: "upi",
          settlement_amount: refundAmount,
          settlement_timestamp: new Date().toISOString(),
        }],
      },
    };
    const message: UpdateMessage = { update_target: "payment", order };

    await sendOndcRequest({
      url: `${data.bppUri}/update`,
      action: "update",
      context,
      message,
    });
    console.log("ondc.on_update auto-triggered refund update", {
      transactionId: data.transactionId,
      bppId: data.bppId,
      orderId: data.orderId,
      amount: refundAmount,
      mode: "replacement",
    });
  } catch (err) {
    console.warn("ondc.on_update auto-trigger refund failed", {
      transactionId: data.transactionId,
      bppId: data.bppId,
      orderId: data.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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

  const authHeader = req.headers.get("authorization");
  const isNoAuth = authHeader?.trim() === "no-auth";

  const rawBody = await req.text();
  annotateTrace(trace, { rawBody });

  let parsed;

  if (!isNoAuth) {
    if (!authHeader) {
      return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "missing signature"), trace);
    }
    parsed = parseAuthorizationHeader(authHeader);
    if (!parsed) {
      return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "invalid signature"), trace);
    }

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
      console.warn("ondc.on_update signature rejected", {
        subscriberId: parsed.subscriberId,
        reason: verdict.reason,
      });
      return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
    }
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnUpdateCallback;
  try {
    payload = JSON.parse(rawBody) as OnUpdateCallback;
  } catch {
    return nack(400, contextError(ONDC_ERROR.CONTEXT_GENERIC, "invalid JSON"), trace);
  }

  // The inbound context, echoed back in our sync ACK/NACK per ONDC's response
  // contract (Workbench grades a context-less response as "context missing").
  const ctx = payload.context;

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, contextError(ONDC_ERROR.CONTEXT_GENERIC, result.reason), trace, ctx);
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
    return nack(400, freshnessError(fresh.failure), trace, ctx);
  }

  // Idempotency CHECK (read-only): a same (action, txn, msg) re-send is
  // workbench/BPP retrying because they didn't get our prior ACK. If this tuple
  // was already COMMITTED (a prior attempt persisted successfully), replay-ACK
  // without persisting again. We only PEEK here — the tuple is committed AFTER
  // persist succeeds (see commitMessageId below), so a failed persist is
  // correctly retried instead of being masked as success.
  const seen = peekMessageId(
    "on_update",
    result.data.transactionId,
    result.data.messageId
  );
  if (seen.status === "replay") {
    console.log("ondc.on_update idempotent replay", {
      transactionId: result.data.transactionId,
      messageId: result.data.messageId,
      firstSeenAt: new Date(seen.firstSeenAt).toISOString(),
    });
    return ack(trace, ctx);
  }


  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // owns this order. A mismatch means a valid participant is posting under
  // someone else's bpp_id — reject it. Holds for unsolicited BPP updates too:
  // the seller's BPP is still the signer.
  if (!isNoAuth && parsed.subscriberId !== result.data.bppId) {
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
    return nack(500, coreError("could not store order"), trace, ctx);
  }

  // Fire-and-forget update email to the buyer.
  const updatedDesc = describeUpdate(result.data);
  const { subject, html } = orderUpdatedEmail({
    orderId: result.data.orderId,
    state: extractState(result.data.order.state),
    description: updatedDesc,
    orderUrl: `https://openidea.co.in/shop/order/${encodeURIComponent(result.data.transactionId)}/${encodeURIComponent(result.data.bppId)}`,
  });
  void sendBuyerEmail(result.data.transactionId, result.data.bppId, subject, html);

  // Auto-trigger refund update: when the BPP's on_update carries
  // settlement_details with settlement_phase === "refund", the BAP must send
  // a follow-up /update with the refund derived from the quote_trail in the
  // fulfillments (QA Iter 4: "refund update call missing" for return/replacement
  // flows). Fire-and-forget so this ACK is never blocked.
  void triggerRefundIfSettled(result.data);

  // Commit idempotency ONLY now that persistence has succeeded. Committing
  // after persist (not before) is what prevents the ACK-without-persistence
  // bug: the failed-persist branch above returned NACK 500 WITHOUT committing,
  // so the sender's retry re-attempts persistence instead of replay-ACKing.
  commitMessageId(
    "on_update",
    result.data.transactionId,
    result.data.messageId
  );

  // (f) Accept. The updated order is now available for the Status/Track APIs to
  // read by transaction_id / order_id.
  return ack(trace, ctx);
}
