// ONDC BAP `on_confirm` callback — the asynchronous other half of `confirm`.
//
// `confirm` (see confirm/route.ts) is split across two HTTP exchanges:
//   1. We POST `confirm` to the CHOSEN BPP → sync ACK/NACK only (the order is
//      not placed yet, only accepted for placement).
//   2. That BPP places the order and POSTs an `on_confirm` HERE, to
//      `bap_uri/on_confirm`, carrying the CREATED order: its `id` (the order id
//      the buyer references from now on), the initial `state`, the final
//      `quote`, the `payments` status, and the `fulfillments` (assigned agent /
//      tracking / delivery state). This route is that inbound endpoint.
//
// Callback lifecycle handled below, in order (identical to on_init):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / order / order_id
//      / fulfillments
//   e. hand off to a persistence seam (no DB yet — see persistOnConfirmOrder)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// ONE callback per confirm (NOT many):  like on_init and unlike on_search,
// `confirm` is DIRECTED at a single BPP, so we expect exactly ONE `on_confirm`
// for a given (transaction_id, bpp_id). A BPP may re-issue (order state changes
// can also arrive via on_status), so the natural store key is still
// (transaction_id, bpp_id) with the latest message_id winning. See
// persistOnConfirmOrder.
//
// transaction_id is the spine:  it is minted in search/route.ts, reused by
// select → init → confirm when directing this BPP, and echoed back here — so the
// whole chain joins on the same id. order_id is the NEW identifier this callback
// introduces: the BPP-assigned id that status/track/cancel/update reference from
// here on.
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
import { saveConfirmOrder } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's order is large and we pass
// it through opaquely to the persistence layer. snake_case = wire format.
type OnConfirmContext = {
  domain?: string;
  action?: string; // must be "on_confirm"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns the order it placed. We read the order `id` (the new
// BPP-assigned identifier), the `state` (initial order state), and the
// `fulfillments` (assigned agent / tracking / delivery state), keep the whole
// order for downstream status/track, and otherwise treat the order opaquely.
type OnConfirmOrder = {
  id?: unknown;
  state?: unknown;
  fulfillments?: unknown;
};

type OnConfirmCallback = {
  context?: OnConfirmContext;
  message?: { order?: OnConfirmOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnConfirm = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The BPP-assigned order id — the identifier status/track/cancel/update use.
  orderId: string;
  // The full placed order, retained opaquely for later stages (state, quote,
  // payments echoed back, plus everything below).
  order: OnConfirmOrder;
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
// one-function move. (Same shape as on_init/route.ts — to be deduplicated when
// that shared module lands.)
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
  payload: OnConfirmCallback
): { ok: true; data: ExtractedOnConfirm } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_confirm") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider placed the order — required to match
  // this back to the confirm we sent, and to key persistence.
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
  // The order id is what this callback introduces — the BPP-assigned identifier
  // every later action (status/track/cancel/update) references. A valid
  // on_confirm must carry one.
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
      // Keep the whole order so status/track can read state/quote/payments.
      order,
      // fulfillments are optional in the shapes networks send; pass through
      // whatever the BPP included (assigned agent / tracking / delivery state)
      // for later stages, or undefined when absent.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — NO DATABASE YET (by design).
// ---------------------------------------------------------------------------
//
// On ACK the placed order must outlive this request so the Status/Track APIs can
// read it (they reference the BPP-assigned order_id). Backed by the dummy store
// (src/lib/ondc/store.ts): enriches the OrderRecord for (transaction_id, bpp_id)
// to stage "confirm" — assigning order_id + initial state and registering the
// order_id index — last-write-wins, so a re-issued on_confirm (or a subsequent
// on_status carrying a newer state) replaces the prior snapshot. A store write
// failure throws (OndcStoreError) and the handler downgrades it to a NACK rather
// than silently dropping.
async function persistOnConfirmOrder(data: ExtractedOnConfirm): Promise<void> {
  await saveConfirmOrder({
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
  console.log("ondc.on_confirm persisted", {
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    orderId: data.orderId,
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
    console.warn("ondc.on_confirm key resolution failed", {
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
    console.warn("ondc.on_confirm signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnConfirmCallback;
  try {
    payload = JSON.parse(rawBody) as OnConfirmCallback;
  } catch {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // claims to have placed this order. A mismatch means a valid participant is
  // posting under someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_confirm signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
  try {
    await persistOnConfirmOrder(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_confirm persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store order" });
  }

  // (f) Accept. The placed order is now (will be) available for the future
  // Status/Track APIs to read by transaction_id / order_id.
  return ack();
}
