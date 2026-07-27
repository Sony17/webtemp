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
import type { OndcError } from "@/lib/ondc/client";
import { validateContextFreshness } from "@/lib/ondc/context";
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
import { saveCancelUpdate } from "@/lib/ondc/store";
import { sendBuyerEmail } from "@/lib/email/send";
import { orderCancelledEmail } from "@/lib/email/templates";

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
  timestamp?: string;
  ttl?: string;
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

// Extract a human-readable cancellation reason from the raw order object. The
// reason can be in cancellation.reason.id, cancellation.reason.short_desc, or
// the fulfillment state descriptor.
function extractCancelReason(order: OnCancelOrder): string | undefined {
  const raw = order as {
    cancellation?: {
      reason?: { id?: unknown; short_desc?: unknown };
      cancelled_by?: unknown;
    };
    fulfillments?: Array<{
      state?: { descriptor?: { code?: unknown } };
      type?: unknown;
    }>;
  };
  if (raw.cancellation?.reason?.short_desc) {
    return String(raw.cancellation.reason.short_desc);
  }
  if (raw.cancellation?.reason?.id) {
    return `Reason code: ${String(raw.cancellation.reason.id)}`;
  }
  // Fall back to the first cancelled fulfillment state.
  const cancelled = raw.fulfillments?.find(
    (f) =>
      f?.state?.descriptor?.code === "Cancelled" ||
      f?.type === "Cancel"
  );
  if (cancelled?.state?.descriptor?.code) {
    return String(cancelled.state.descriptor.code);
  }
  return undefined;
}

export async function POST(req: Request) {
  const trace = beginAuditTrace({
    action: "on_cancel",
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
      console.warn("ondc.on_cancel key resolution failed", {
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
      console.warn("ondc.on_cancel signature rejected", {
        subscriberId: parsed.subscriberId,
        reason: verdict.reason,
      });
      return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
    }
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnCancelCallback;
  try {
    payload = JSON.parse(rawBody) as OnCancelCallback;
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
    console.warn("ondc.on_cancel freshness rejected", {
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
    "on_cancel",
    result.data.transactionId,
    result.data.messageId
  );
  if (seen.status === "replay") {
    console.log("ondc.on_cancel idempotent replay", {
      transactionId: result.data.transactionId,
      messageId: result.data.messageId,
      firstSeenAt: new Date(seen.firstSeenAt).toISOString(),
    });
    return ack(trace, ctx);
  }


  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // owns this order. A mismatch means a valid participant is posting under
  // someone else's bpp_id — reject it. Holds for unsolicited seller cancels too:
  // the seller's BPP is still the signer.
  if (!isNoAuth && parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_cancel signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnCancel(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_cancel persist failed", { msg });
    return nack(500, coreError("could not store order"), trace, ctx);
  }

  // Fire-and-forget cancellation email to the buyer.
  const cancelReason = extractCancelReason(result.data.order);
  const { subject, html } = orderCancelledEmail({
    orderId: result.data.orderId,
    reason: cancelReason,
    orderUrl: `https://openidea.co.in/shop/order/${encodeURIComponent(result.data.transactionId)}/${encodeURIComponent(result.data.bppId)}`,
  });
  void sendBuyerEmail(result.data.transactionId, result.data.bppId, subject, html);

  // Commit idempotency ONLY now that persistence has succeeded. Committing
  // after persist (not before) is what prevents the ACK-without-persistence
  // bug: the failed-persist branch above returned NACK 500 WITHOUT committing,
  // so the sender's retry re-attempts persistence instead of replay-ACKing.
  commitMessageId(
    "on_cancel",
    result.data.transactionId,
    result.data.messageId
  );

  // (f) Accept. The cancelled order is now available for the Status/Track APIs to
  // read by transaction_id / order_id.
  return ack(trace, ctx);
}
