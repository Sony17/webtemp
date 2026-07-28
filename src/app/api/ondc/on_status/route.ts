// ONDC BAP `on_status` callback — the asynchronous other half of `status`.
//
// `status` (see status/route.ts) is split across two HTTP exchanges:
//   1. We POST `status` to the CHOSEN BPP with just `{ order_id }` → sync
//      ACK/NACK only (the BPP accepted the query, but no order state yet).
//   2. That BPP looks up the order and POSTs an `on_status` HERE, to
//      `bap_uri/on_status`, carrying the order's CURRENT snapshot: its `id` (the
//      BPP-assigned order id we asked about), the latest `state`, the final
//      `quote`, the `payments` status, and the `fulfillments` (assigned agent /
//      tracking / delivery progress). This route is that inbound endpoint.
//
// Callback lifecycle handled below, in order (identical to on_confirm):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / order / order_id
//      / fulfillments
//   e. hand off to a persistence seam (no DB yet — see persistOnStatusOrder)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// ONE callback per status (NOT many):  like on_confirm and unlike on_search,
// `status` is DIRECTED at a single BPP, so we expect exactly ONE `on_status` for
// a given (transaction_id, bpp_id, order_id). A BPP may push MANY on_status
// callbacks over an order's life though — each delivery milestone (packed, picked
// up, out-for-delivery, delivered) can arrive unprompted — so the natural store
// key is (transaction_id, bpp_id, order_id) with the latest message_id winning.
// See persistOnStatusOrder.
//
// transaction_id is the spine:  it is minted in search/route.ts, reused by
// select → init → confirm → status when directing this BPP, and echoed back here
// — so the whole chain joins on the same id. order_id is the identifier
// on_confirm introduced and status/track/cancel/update reference; on_status keys
// the state snapshot to it.
//
// Mirrors the existing route conventions (NextResponse, runtime = "nodejs").
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import {
  resolveBppSigningPublicKey,
  isWorkbenchVerificationBypass,
} from "@/lib/ondc/registry";
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
import { saveStatusUpdate } from "@/lib/ondc/store";
import { sendBuyerEmail } from "@/lib/email/send";
import { orderStatusEmail } from "@/lib/email/templates";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's order is large and we pass
// it through opaquely to the persistence layer. snake_case = wire format.
type OnStatusContext = {
  domain?: string;
  action?: string; // must be "on_status"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp?: string;
  ttl?: string;
};

// The BPP returns the order's current snapshot. We read the order `id` (the
// BPP-assigned identifier we asked about), the `state` (current order state),
// and the `fulfillments` (assigned agent / tracking / delivery progress), keep
// the whole order for downstream reads, and otherwise treat the order opaquely.
type OnStatusOrder = {
  id?: unknown;
  state?: unknown;
  fulfillments?: unknown;
};

type OnStatusCallback = {
  context?: OnStatusContext;
  message?: { order?: OnStatusOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnStatus = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The BPP-assigned order id — the identifier status/track/cancel/update use.
  orderId: string;
  // The full order snapshot, retained opaquely for later reads (state, quote,
  // payments echoed back, plus everything below).
  order: OnStatusOrder;
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
  payload: OnStatusCallback
): { ok: true; data: ExtractedOnStatus } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_status") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider owns the order — required to match
  // this back to the status we sent, and to key persistence.
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
  // The order id ties this snapshot to the placed order on_confirm introduced —
  // every later action (status/track/cancel/update) references it. A valid
  // on_status must carry one.
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
      // fulfillments carry the tracking/delivery progress on_status exists to
      // report; pass through whatever the BPP included (assigned agent /
      // tracking / delivery state) for later stages, or undefined when absent.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — NO DATABASE YET (by design).
// ---------------------------------------------------------------------------
//
// On ACK the order snapshot must outlive this request so the Status/Track APIs
// can read the latest state (they reference the BPP-assigned order_id). Backed by
// the dummy store (src/lib/ondc/store.ts): updates the OrderRecord for
// (transaction_id, bpp_id) to stage "status" — refreshing the current state and
// appending the milestone to statusHistory — so each new on_status (delivery
// milestone, payment update) advances the snapshot while preserving the
// progression. A store write failure throws (OndcStoreError) and the handler
// downgrades it to a NACK rather than silently dropping.
async function persistOnStatusOrder(data: ExtractedOnStatus): Promise<void> {
  await saveStatusUpdate({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    orderId: data.orderId,
    state: data.order.state,
    order: data.order,
    fulfillments: data.fulfillments,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_status persisted", {
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
    action: "on_status",
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
  // EXCEPTION: a workbench/staging sender whose key isn't in our registry
  // environment is allowed to skip verification when the opt-in flag is set (see
  // isWorkbenchVerificationBypass) — otherwise its callbacks NACK 20001 forever.
  if (isWorkbenchVerificationBypass(parsed.subscriberId)) {
    console.warn("ondc.on_status workbench signature-verification bypass", {
      subscriberId: parsed.subscriberId,
    });
  } else {
    const publicKey = await resolveBppSigningPublicKey(
      parsed.subscriberId,
      parsed.uniqueKeyId
    );
    if (!publicKey) {
      console.warn("ondc.on_status key resolution failed", {
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
      console.warn("ondc.on_status signature rejected", {
        subscriberId: parsed.subscriberId,
        reason: verdict.reason,
      });
      return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
    }
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnStatusCallback;
  try {
    payload = JSON.parse(rawBody) as OnStatusCallback;
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
    console.warn("ondc.on_status freshness rejected", {
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
    "on_status",
    result.data.transactionId,
    result.data.messageId
  );
  if (seen.status === "replay") {
    console.log("ondc.on_status idempotent replay", {
      transactionId: result.data.transactionId,
      messageId: result.data.messageId,
      firstSeenAt: new Date(seen.firstSeenAt).toISOString(),
    });
    return ack(trace, ctx);
  }


  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // owns this order. A mismatch means a valid participant is posting under
  // someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_status signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
  try {
    await persistOnStatusOrder(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_status persist failed", { msg });
    return nack(500, coreError("could not store order"), trace, ctx);
  }

  // Fire-and-forget status-update email to the buyer.
  const raw = result.data.order as { state?: { code?: unknown; short_desc?: unknown } } | undefined;
  const stateLabel =
    typeof result.data.order.state === "string"
      ? result.data.order.state
      : raw?.state?.code
        ? String(raw.state.code)
        : undefined;
  const { subject, html } = orderStatusEmail({
    orderId: result.data.orderId,
    state: stateLabel,
    orderUrl: `https://openidea.co.in/shop/order/${encodeURIComponent(result.data.transactionId)}/${encodeURIComponent(result.data.bppId)}`,
  });
  void sendBuyerEmail(result.data.transactionId, result.data.bppId, subject, html);

  // Commit idempotency ONLY now that persistence has succeeded. Committing
  // after persist (not before) is what prevents the ACK-without-persistence
  // bug: the failed-persist branch above returned NACK 500 WITHOUT committing,
  // so the sender's retry re-attempts persistence instead of replay-ACKing.
  commitMessageId(
    "on_status",
    result.data.transactionId,
    result.data.messageId
  );

  // (f) Accept. The latest order snapshot is now (will be) available for the
  // Status/Track APIs to read by transaction_id / order_id.
  return ack(trace, ctx);
}
