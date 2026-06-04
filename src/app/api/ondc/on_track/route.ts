// ONDC BAP `on_track` callback — the asynchronous other half of `track`.
//
// `track` (see ../track/route.ts) is split across two HTTP exchanges:
//   1. We POST `track` to the CHOSEN BPP with just `{ order_id }` → sync
//      ACK/NACK only (the BPP accepted the query, but no tracking handle yet).
//   2. That BPP POSTs an `on_track` HERE, to `bap_uri/on_track`, carrying a
//      `tracking` object: a tracking `url`, optionally a live `location`,
//      whether tracking is `active`, and any `tags`. This route is that inbound
//      endpoint.
//
// Callback lifecycle handled below, in order (identical to on_status):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{tracking}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / tracking
//   e. hand off to a persistence seam (the dummy store — see persistOnTrack)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// CORRELATION DIFFERS from on_status: on_status carried `message.order.id`, so it
// keyed by order_id. on_track carries NO order and NO order_id — only a
// `tracking` object — so we correlate to the order purely by
// (transaction_id, bpp_id), the lifecycle spine. transaction_id is minted in
// search/route.ts, reused by select → init → confirm → status/track when
// directing this BPP, and echoed back here, so the whole chain joins on it.
//
// MANY callbacks per track (possibly unsolicited): during LIVE tracking a BPP
// may push repeated on_track callbacks (status flipping active/inactive,
// location refreshes). We keep only the LATEST (last-write-wins) on the
// OrderRecord's `tracking` field — see persistOnTrack.
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
import { saveTrackingUpdate } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; the tracking object is large and
// version-variable, so we pass it through opaquely to the persistence layer.
// snake_case = wire format.
type OnTrackContext = {
  domain?: string;
  action?: string; // must be "on_track"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns a tracking handle. We keep the whole `tracking` object opaque
// (url / location / status / tags vary by version and tracking mode) and only
// require that it be present and object-shaped.
type OnTrackMessage = {
  tracking?: unknown;
};

type OnTrackCallback = {
  context?: OnTrackContext;
  message?: OnTrackMessage;
};

// The validated essentials we lift out of a good callback. NOTE: no orderId —
// on_track does not carry one; persistence correlates by (transactionId, bppId).
type ExtractedOnTrack = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // The full tracking snapshot, retained opaquely (url / live location /
  // active|inactive status / tags).
  tracking: unknown;
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
// one-function move. (Same shape as on_status/route.ts — to be deduplicated when
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
  payload: OnTrackCallback
): { ok: true; data: ExtractedOnTrack } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_track") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider owns the order — required to match
  // this back to the track we sent, and to key persistence (the correlation key
  // is (transaction_id, bpp_id) since on_track carries no order_id).
  if (!isNonEmptyString(ctx.bpp_id)) {
    return { ok: false, reason: "missing bpp_id" };
  }
  if (!isNonEmptyString(ctx.bpp_uri)) {
    return { ok: false, reason: "missing bpp_uri" };
  }
  // The tracking object is the whole point of on_track. We treat it opaquely but
  // require it to be present and object-shaped (url/location/status/tags inside).
  const tracking = payload.message?.tracking;
  if (tracking === null || typeof tracking !== "object") {
    return { ok: false, reason: "missing message.tracking" };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      tracking,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — backed by the dummy store (src/lib/ondc/store.ts).
// ---------------------------------------------------------------------------
//
// On ACK the tracking snapshot must outlive this request so the Track/Status UI
// can read the latest handle. saveTrackingUpdate refreshes the OrderRecord for
// (transaction_id, bpp_id) — setting the latest `tracking` (last-write-wins) and
// stage "track" — so repeated/live on_track callbacks keep advancing the current
// handle without an accumulating trail. A store write failure throws
// (OndcStoreError) and the handler downgrades it to a NACK rather than silently
// dropping.
async function persistOnTrack(data: ExtractedOnTrack): Promise<void> {
  await saveTrackingUpdate({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    tracking: data.tracking,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_track persisted", {
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
    console.warn("ondc.on_track key resolution failed", {
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
    console.warn("ondc.on_track signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnTrackCallback;
  try {
    payload = JSON.parse(rawBody) as OnTrackCallback;
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
    console.warn("ondc.on_track signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnTrack(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_track persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store tracking" });
  }

  // (f) Accept. The latest tracking snapshot is now available for the Track/
  // Status APIs to read by transaction_id (+ bpp_id).
  return ack();
}
