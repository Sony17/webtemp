// ONDC BAP `on_rating` callback — the asynchronous other half of `rating`.
//
// `rating` (see ../rating/route.ts) is split across two HTTP exchanges:
//   1. We POST `rating` to the CHOSEN BPP with `{ ratings: [...] }` → sync
//      ACK/NACK only (the BPP accepted the rating, but no feedback form yet).
//   2. That BPP POSTs an `on_rating` HERE, to `bap_uri/on_rating`, carrying an
//      optional `feedback_form` (a follow-up form the buyer MAY fill in) and/or
//      ack flags (`feedback_ack` / `rating_ack`). This route is that inbound
//      endpoint.
//
// STANDALONE persistence (the key difference from on_cancel/on_update, identical
// to on_support): on_rating carries NO order and NO order_id — only feedback. So
// we do NOT touch any OrderRecord; the feedback is stored in a dedicated
// RatingRecord keyed by (transaction_id, bpp_id). See store.ts saveRating /
// RatingRecord.
//
// Callback lifecycle handled below, in order (identical auth path to on_support):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / feedback_form /
//      feedback_ack / rating_ack
//   e. hand off to a persistence seam (the dummy store — see persistOnRating)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// CORRELATION (UNLIKE on_cancel/on_update; SAME as on_support): no order_id
// exists in the callback, so we key purely by the (transaction_id, bpp_id)
// composite. transaction_id is the spine — minted in search/route.ts, reused
// across the lifecycle, echoed here.
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
import { saveRating } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; we pass the whole message through
// opaquely to the persistence layer so any extra fields a network adds are
// retained. snake_case = wire format.
type OnRatingContext = {
  domain?: string;
  action?: string; // must be "on_rating"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
};

// The BPP returns a follow-up feedback form (and/or ack flags). The common shape
// of `feedback_form` is `{ form: { url, mime_type }, required }`; we read those
// for convenience but keep the whole object opaquely. All fields optional — a
// network may return only an ack.
type OnRatingFeedbackForm = {
  form?: { url?: unknown; mime_type?: unknown };
  required?: unknown;
};

type OnRatingMessage = {
  feedback_form?: OnRatingFeedbackForm;
  feedback_ack?: unknown;
  rating_ack?: unknown;
};

type OnRatingCallback = {
  context?: OnRatingContext;
  message?: OnRatingMessage;
};

// The validated essentials we lift out of a good callback.
type ExtractedOnRating = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  feedbackForm?: unknown;
  feedbackFormUrl?: string;
  feedbackFormMimeType?: string;
  feedbackRequired?: boolean;
  feedbackAck?: boolean;
  ratingAck?: boolean;
  // The full opaque message, retained so any extra fields are not lost.
  feedback: OnRatingMessage;
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
// one-function move. (Same shape as on_support/on_cancel/on_update/on_status —
// to be deduplicated when that shared module lands.)
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

// Coerce a possibly-present string field to a trimmed string or undefined.
function optStr(v: unknown): string | undefined {
  return isNonEmptyString(v) ? v.trim() : undefined;
}

// Coerce a possibly-present boolean (or its common "true"/"false" string form,
// since networks are loose about JSON types) to a boolean or undefined.
function optBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

// Pull out the required fields, or return an error string naming the first
// problem. Keeps the handler linear and the rules in one auditable place.
function extractAndValidate(
  payload: OnRatingCallback
): { ok: true; data: ExtractedOnRating } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_rating") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider replied — required to correlate this
  // back to the rating we sent, and to key persistence.
  if (!isNonEmptyString(ctx.bpp_id)) {
    return { ok: false, reason: "missing bpp_id" };
  }
  if (!isNonEmptyString(ctx.bpp_uri)) {
    return { ok: false, reason: "missing bpp_uri" };
  }
  const message = payload.message;
  if (message === null || typeof message !== "object") {
    return { ok: false, reason: "missing message" };
  }

  // Lift the common fields out of feedback_form / message.
  const ff = message.feedback_form;
  const feedbackForm =
    ff !== null && typeof ff === "object" ? ff : undefined;
  const feedbackFormUrl = optStr(ff?.form?.url);
  const feedbackFormMimeType = optStr(ff?.form?.mime_type);
  const feedbackRequired = optBool(ff?.required);
  const feedbackAck = optBool(message.feedback_ack);
  const ratingAck = optBool(message.rating_ack);

  // A useful on_rating must carry SOMETHING actionable: a feedback form, or an
  // explicit ack. An empty `{}` message gives the buyer nothing to act on and is
  // almost certainly malformed, so reject it (mirrors on_support's "must carry a
  // channel" guard).
  if (
    !feedbackForm &&
    feedbackAck === undefined &&
    ratingAck === undefined
  ) {
    return {
      ok: false,
      reason: "message has no feedback_form, feedback_ack, or rating_ack",
    };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      feedbackForm,
      feedbackFormUrl,
      feedbackFormMimeType,
      feedbackRequired,
      feedbackAck,
      ratingAck,
      // Keep the whole message so any extra fields a network adds survive.
      feedback: message,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — backed by the dummy store (src/lib/ondc/store.ts).
// ---------------------------------------------------------------------------
//
// On ACK the feedback must outlive this request so a buyer UI can read it back
// (render the follow-up form, or confirm the rating was recorded). saveRating
// upserts a STANDALONE RatingRecord for (transaction_id, bpp_id) — it does NOT
// touch any OrderRecord — last-write-wins. A store write failure throws
// (OndcStoreError) and the handler downgrades it to a NACK rather than silently
// dropping.
async function persistOnRating(data: ExtractedOnRating): Promise<void> {
  await saveRating({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    feedbackForm: data.feedbackForm,
    feedbackFormUrl: data.feedbackFormUrl,
    feedbackFormMimeType: data.feedbackFormMimeType,
    feedbackRequired: data.feedbackRequired,
    feedbackAck: data.feedbackAck,
    ratingAck: data.ratingAck,
    feedback: data.feedback,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_rating persisted", {
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    hasFeedbackForm: Boolean(data.feedbackForm),
    feedbackRequired: data.feedbackRequired,
    feedbackAck: data.feedbackAck,
    ratingAck: data.ratingAck,
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
    console.warn("ondc.on_rating key resolution failed", {
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
    console.warn("ondc.on_rating signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnRatingCallback;
  try {
    payload = JSON.parse(rawBody) as OnRatingCallback;
  } catch {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Structural validation + field extraction.
  const result = extractAndValidate(payload);
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP we sent
  // the rating to. A mismatch means a valid participant is posting under someone
  // else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_rating signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnRating(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_rating persist failed", { msg });
    return nack(500, { type: "CORE-ERROR", message: "could not store rating" });
  }

  // (f) Accept. The feedback is now available for a buyer UI to read by
  // transaction_id / bpp_id.
  return ack();
}
