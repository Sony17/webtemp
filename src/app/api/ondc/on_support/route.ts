// ONDC BAP `on_support` callback — the asynchronous other half of `support`.
//
// `support` (see ../support/route.ts) is split across two HTTP exchanges:
//   1. We POST `support` to the CHOSEN BPP with `{ ref_id }` → sync ACK/NACK only
//      (the BPP accepted the request, but no contact channels yet).
//   2. That BPP POSTs an `on_support` HERE, to `bap_uri/on_support`, carrying the
//      contact channels: `phone`, `email`, `uri` (ONDC 1.2.x sends these flat;
//      some networks add GRO details). This route is that inbound endpoint.
//
// STANDALONE persistence (the key difference from on_cancel/on_update): on_support
// carries NO order and NO order_id — only contact channels. So we do NOT touch any
// OrderRecord; the channels are stored in a dedicated SupportRecord keyed by
// (transaction_id, bpp_id). See store.ts saveSupport / SupportRecord.
//
// Callback lifecycle handled below, in order (identical auth path to on_cancel):
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / phone / email /
//      uri / ref_id
//   e. hand off to a persistence seam (the dummy store — see persistOnSupport)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// CORRELATION (UNLIKE on_cancel/on_update): no order_id exists in the callback, so
// we key purely by the (transaction_id, bpp_id) composite. transaction_id is the
// spine — minted in search/route.ts, reused across the lifecycle, echoed here.
//
// SCOPE: contact-channel discovery only — NOT ONDC's IGM (/issue, /on_issue, …)
// grievance flow, which is a separate spec.
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
import { saveSupport } from "@/lib/ondc/store";
import { sendBuyerEmail } from "@/lib/email/send";
import { supportContactEmail } from "@/lib/email/templates";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; we pass the whole message through
// opaquely to the persistence layer so any extra channels a network adds are
// retained. snake_case = wire format.
type OnSupportContext = {
  domain?: string;
  action?: string; // must be "on_support"
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp?: string;
  ttl?: string;
};

// The BPP returns the contact channels. ONDC 1.2.x sends these flat; all are
// optional (a network may return only a subset), but a useful on_support has at
// least one. `ref_id` is sometimes echoed back from the request.
type OnSupportMessage = {
  ref_id?: unknown;
  phone?: unknown;
  email?: unknown;
  uri?: unknown;
};

type OnSupportCallback = {
  context?: OnSupportContext;
  message?: OnSupportMessage;
};

// The validated essentials we lift out of a good callback.
type ExtractedOnSupport = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  phone?: string;
  email?: string;
  uri?: string;
  refId?: string;
  // The full opaque message, retained so any extra channels are not lost.
  support: OnSupportMessage;
};

// ---------------------------------------------------------------------------
// ACK / NACK responses (BAP → caller, the sync reply ONDC expects)
// ---------------------------------------------------------------------------

// Echoes the inbound `context` (when known) per ONDC's response contract — see
// responses.ts. Completes the context-echo started in Commit 1 for the support
// callback.
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

// Coerce a possibly-present string channel to a trimmed string or undefined.
function optStr(v: unknown): string | undefined {
  return isNonEmptyString(v) ? v.trim() : undefined;
}

// Pull out the required fields, or return an error string naming the first
// problem. Keeps the handler linear and the rules in one auditable place.
function extractAndValidate(
  payload: OnSupportCallback
): { ok: true; data: ExtractedOnSupport } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_support") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider replied — required to correlate this
  // back to the support request we sent, and to key persistence.
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

  // A useful on_support must carry at least one contact channel; an empty reply
  // gives the buyer nothing to act on, so reject it as malformed.
  const phone = optStr(message.phone);
  const email = optStr(message.email);
  const uri = optStr(message.uri);
  if (!phone && !email && !uri) {
    return {
      ok: false,
      reason: "message has no contact channel (phone/email/uri)",
    };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      phone,
      email,
      uri,
      refId: optStr(message.ref_id),
      // Keep the whole message so any extra channels a network adds survive.
      support: message,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — backed by the dummy store (src/lib/ondc/store.ts).
// ---------------------------------------------------------------------------
//
// On ACK the contact channels must outlive this request so a buyer UI can read
// them back. saveSupport upserts a STANDALONE SupportRecord for (transaction_id,
// bpp_id) — it does NOT touch any OrderRecord — last-write-wins. A store write
// failure throws (OndcStoreError) and the handler downgrades it to a NACK rather
// than silently dropping.
async function persistOnSupport(data: ExtractedOnSupport): Promise<void> {
  await saveSupport({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    phone: data.phone,
    email: data.email,
    uri: data.uri,
    refId: data.refId,
    support: data.support,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  // Contact channels are not secrets, but we log only their presence, not values.
  console.log("ondc.on_support persisted", {
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    hasPhone: Boolean(data.phone),
    hasEmail: Boolean(data.email),
    hasUri: Boolean(data.uri),
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const trace = beginAuditTrace({
    action: "on_support",
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
    console.warn("ondc.on_support key resolution failed", {
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
    console.warn("ondc.on_support signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (c) Now that the body is trusted, parse it as JSON.
  let payload: OnSupportCallback;
  try {
    payload = JSON.parse(rawBody) as OnSupportCallback;
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
    console.warn("ondc.on_support freshness rejected", {
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
    "on_support",
    result.data.transactionId,
    result.data.messageId
  );
  if (seen.status === "replay") {
    console.log("ondc.on_support idempotent replay", {
      transactionId: result.data.transactionId,
      messageId: result.data.messageId,
      firstSeenAt: new Date(seen.firstSeenAt).toISOString(),
    });
    return ack(trace, ctx);
  }


  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP we asked
  // for support. A mismatch means a valid participant is posting under someone
  // else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_support signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"), trace);
  }

  // (e) Hand off to persistence. We await it so a store failure can downgrade to
  // a NACK rather than a silent drop.
  try {
    await persistOnSupport(result.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "persistence error";
    console.error("ondc.on_support persist failed", { msg });
    return nack(500, coreError("could not store support"), trace, ctx);
  }

  // Fire-and-forget support-contact email to the buyer.
  const { subject, html } = supportContactEmail({
    transactionId: result.data.transactionId,
    phone: result.data.phone,
    email: result.data.email,
    orderUrl: `https://openidea.co.in/shop/order/${encodeURIComponent(result.data.transactionId)}/${encodeURIComponent(result.data.bppId)}`,
  });
  void sendBuyerEmail(result.data.transactionId, result.data.bppId, subject, html);

  // Commit idempotency ONLY now that persistence has succeeded. Committing
  // after persist (not before) is what prevents the ACK-without-persistence
  // bug: the failed-persist branch above returned NACK 500 WITHOUT committing,
  // so the sender's retry re-attempts persistence instead of replay-ACKing.
  commitMessageId(
    "on_support",
    result.data.transactionId,
    result.data.messageId
  );

  // (f) Accept. The contact channels are now available for a buyer UI to read by
  // transaction_id / bpp_id. Echo the inbound context (like every other callback
  // and like this route's own replay-ACK at the idempotency branch above) so the
  // ONDC log validator does not grade the success ACK as "context missing".
  return ack(trace, ctx);
}
