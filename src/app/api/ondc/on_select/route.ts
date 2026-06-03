// ONDC BAP `on_select` callback — the asynchronous other half of `select`.
//
// `select` (see select/route.ts) is split across two HTTP exchanges:
//   1. We POST `select` to the CHOSEN BPP → sync ACK/NACK only (no quote yet).
//   2. That BPP prices the order and POSTs an `on_select` HERE, to
//      `bap_uri/on_select`, carrying `message.order.quote` (item prices, taxes,
//      delivery/packing charges) and the fulfillment serviceability. This route
//      is that inbound endpoint.
//
// Callback lifecycle handled below, in order (identical to on_search):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{order}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / quote / fulfillments
//   e. hand off to a persistence seam (no DB yet — see persistOnSelectQuote)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// ONE callback per select (NOT many):  unlike on_search — where one broadcast
// fans out to N BPPs, each replying with its own catalog — `select` is DIRECTED
// at a single BPP, so we expect exactly ONE `on_select` for a given
// (transaction_id, bpp_id). A BPP may re-quote (e.g. price/serviceability
// changes), so the natural store key is still (transaction_id, bpp_id) with the
// latest message_id winning. See persistOnSelectQuote.
//
// transaction_id is the spine:  it is minted in search/route.ts, reused by
// select/route.ts when directing this BPP, and echoed back here — so
// search ↔ on_search ↔ select ↔ on_select all join on the same id. That is how
// this quote is matched to the select it answers, and how init/confirm later
// continue the same order.
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
// Only the fields this route reads are typed; ONDC's order/quote is large and we
// pass it through opaquely to the persistence layer. snake_case = wire format.
type OnSelectContext = {
  domain?: string;
  action?: string; // must be "on_select"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns the order it priced. We read the quote (the point of select)
// and fulfillments (serviceability / delivery options) and otherwise treat the
// order opaquely.
type OnSelectOrder = {
  quote?: unknown;
  fulfillments?: unknown;
};

type OnSelectCallback = {
  context?: OnSelectContext;
  message?: { order?: OnSelectOrder };
};

// The validated essentials we lift out of a good callback.
type ExtractedOnSelect = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  quote: unknown;
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
// one-function move. (Same shape as on_search/route.ts — to be deduplicated when
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
  payload: OnSelectCallback
): { ok: true; data: ExtractedOnSelect } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_select") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider priced the order — required to match
  // this quote to the select we sent, and to key persistence.
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
  // The quote is the whole point of select — a valid on_select must carry one.
  const quote = order.quote;
  if (quote === null || typeof quote !== "object") {
    return { ok: false, reason: "missing message.order.quote" };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      quote,
      // fulfillments are optional in the shapes networks send; pass through
      // whatever the BPP included (serviceability/delivery options) for later
      // stages, or undefined when absent.
      fulfillments: order.fulfillments,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — NO DATABASE YET (by design).
// ---------------------------------------------------------------------------
//
// On ACK the quote must outlive this request so the Init/Confirm APIs can read
// it (init firms billing/fulfillment against this quote). That store isn't built
// yet, so this is the single integration point for it.
// FUTURE: upsert keyed by (transaction_id, bpp_id) — latest message_id wins, so
// a BPP's re-quote replaces the prior one for the same select. For now we only
// log (structured, no secrets) so the flow is observable end-to-end in dev.
async function persistOnSelectQuote(data: ExtractedOnSelect): Promise<void> {
  // TODO(persistence): replace with a real store (DB/KV). Until then this is a
  // no-op beyond logging — quotes are NOT retained across requests.
  console.log("ondc.on_select received", {
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
    console.warn("ondc.on_select key resolution failed", {
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
    console.warn("ondc.on_select signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnSelectCallback;
  try {
    payload = JSON.parse(rawBody) as OnSelectCallback;
  } catch {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // claims to have sent this quote. A mismatch means a valid participant is
  // posting under someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_select signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
  try {
    await persistOnSelectQuote(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_select persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store quote" });
  }

  // (f) Accept. The quote is now (will be) available for the future Init/Confirm
  // APIs to read by transaction_id.
  return ack();
}
