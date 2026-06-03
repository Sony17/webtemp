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
import { getOndcConfig, isOndcConfigured } from "@/lib/ondc/config";
import {
  parseAuthorizationHeader,
  normalizeEd25519PublicKey,
  verifyOndcSignature,
} from "@/lib/ondc/auth";
import type { OndcAckResponse, OndcError } from "@/lib/ondc/client";

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
// BPP signing-key resolution (registry lookup) — the one external dependency.
// ---------------------------------------------------------------------------
//
// To verify the signature we need the SENDER's signing public key, which lives
// in the ONDC registry keyed by (subscriber_id, unique_key_id). A dedicated,
// hardened registry client (signed /vlookup, cache TTL, persistence) is a
// separate module not built yet — so this is a focused seam: a best-effort
// /lookup with an in-process memo. It is deliberately the ONLY place that knows
// how a key is fetched, so graduating it to `lib/ondc/registry.ts` later is a
// one-function move. (Same shape as on_confirm/route.ts — to be deduplicated
// when that shared module lands.)
const keyCache = new Map<string, string>();

async function resolveBppSigningPublicKey(
  subscriberId: string,
  uniqueKeyId: string
): Promise<string | null> {
  const cacheKey = `${subscriberId}|${uniqueKeyId}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const { registryBaseUrl } = getOndcConfig();
  try {
    const res = await fetch(`${registryBaseUrl}/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriber_id: subscriberId, ukId: uniqueKeyId }),
    });
    if (!res.ok) return null;

    // /lookup returns an array of subscriber records; pick the one whose key id
    // matches (the registry can return multiple keys for one subscriber).
    const records = (await res.json()) as Array<{
      ukId?: string;
      unique_key_id?: string;
      signing_public_key?: string;
    }>;
    const match = Array.isArray(records)
      ? records.find(
          (r) => (r.ukId ?? r.unique_key_id) === uniqueKeyId
        ) ?? records[0]
      : undefined;

    const key = match?.signing_public_key;
    if (!key) return null;

    keyCache.set(cacheKey, key);
    return key;
  } catch {
    // Network/registry failure → treat as unresolvable; caller NACKs.
    return null;
  }
}

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
// can read the latest state (they reference the BPP-assigned order_id). That
// store isn't built yet, so this is the single integration point for it. FUTURE:
// upsert keyed by (transaction_id, bpp_id, order_id) — latest message_id wins, so
// each new on_status (delivery milestone, payment update) replaces the prior
// snapshot. For now we only log (structured, no secrets) so the flow is
// observable end-to-end in dev.
async function persistOnStatusOrder(data: ExtractedOnStatus): Promise<void> {
  // TODO(persistence): replace with a real store (DB/KV). Until then this is a
  // no-op beyond logging — order state is NOT retained across requests.
  console.log("ondc.on_status received", {
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
    console.warn("ondc.on_status key resolution failed", {
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
    console.warn("ondc.on_status signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnStatusCallback;
  try {
    payload = JSON.parse(rawBody) as OnStatusCallback;
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
  // someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_status signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
  try {
    await persistOnStatusOrder(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_status persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store order" });
  }

  // (f) Accept. The latest order snapshot is now (will be) available for the
  // Status/Track APIs to read by transaction_id / order_id.
  return ack();
}
