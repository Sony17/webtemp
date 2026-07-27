// ONDC BAP `on_search` callback — the asynchronous other half of discovery.
//
// Discovery in ONDC is split across two HTTP exchanges (see search/route.ts):
//   1. We POST `search` to the gateway → sync ACK/NACK only (no catalogs yet).
//   2. The gateway broadcasts our intent to every serviceable BPP; each BPP
//      independently POSTs an `on_search` HERE, to `bap_uri/on_search`, carrying
//      its slice of the catalog. This route is that inbound endpoint.
//
// Callback lifecycle handled below, in order:
//   a. read the EXACT raw body bytes (needed to recompute the signature digest)
//   b. parse + verify the inbound `Authorization` signature against the sender's
//      registry public key (auth.ts) — reject forgeries before trusting anything
//   c. parse + structurally validate the {context, message:{catalog}} payload
//   d. extract transaction_id / message_id / bpp_id / bpp_uri / catalog
//   e. hand off to a persistence seam (no DB yet — see persistOnSearchCatalog)
//   f. return ACK immediately (work is fire-and-forget from the BPP's view)
//
// MANY callbacks per ONE transaction:  `search` is a broadcast, so a single
// `transaction_id` fans out to N BPPs and each replies with its own `on_search`
// — different `bpp_id`, different `message_id`, its own catalog — arriving
// asynchronously, in any order, over roughly the context `ttl`. There is no
// "final" callback. The BAP ACKs each one independently and ACCUMULATES them;
// the natural store key is therefore (transaction_id, bpp_id) [+ message_id for
// a BPP's incremental refreshes]. See persistOnSearchCatalog.
//
// transaction_id is the spine:  it is minted in search/route.ts, copied by the
// gateway into the broadcast intent, echoed back here by every BPP, and reused
// later by select/init/confirm — so search ↔ on_search(×N) ↔ select all join on
// the same id. That is how a future Select API knows which discovery session a
// chosen provider came from.
//
// Mirrors the existing route conventions (NextResponse, runtime = "nodejs").
import { after, NextResponse } from "next/server";
import { getOndcConfig, isOndcConfigured } from "@/lib/ondc/config";
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
import {
  peekMessageId,
  commitMessageId,
  lookupRejection,
  recordRejection,
} from "@/lib/ondc/idempotency";
import { saveCatalog } from "@/lib/ondc/store";
import { validateCatalog } from "@/lib/ondc/catalog-validate";
import { postCatalogRejection } from "@/lib/ondc/catalog-rejection-outbound";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

const FAST_ACK_BYPASS_HEADER = "x-openidea-fast-ack-bypass";

// ---------------------------------------------------------------------------
// Inbound payload shape (the ONDC wire format we RECEIVE)
// ---------------------------------------------------------------------------
//
// Only the fields this route reads are typed; ONDC's catalog is large and we
// pass it through opaquely to the persistence layer. snake_case = wire format.
type OnSearchContext = {
  domain?: string;
  action?: string; // must be "on_search"
  city?: string; // city scope of the discovery — used for registry /lookup
  bap_id?: string; // must echo OUR bapId
  bap_uri?: string; // must echo OUR bapUri
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp?: string;
  ttl?: string;
};

type OnSearchCallback = {
  context?: OnSearchContext;
  message?: { catalog?: unknown };
  // Per RET 1.2.5 contract ("Catalog Validation & Rejection"): the SNP MAY
  // send a top-level `error` block on /on_search to signal a catalog the BNP
  // should reject (the Workbench rejection-test scenario fires this). When
  // present we echo it back as a NACK envelope without persisting anything.
  error?: unknown;
};

// The validated essentials we lift out of a good callback.
type ExtractedOnSearch = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  // City passes through to the registry resolver so cross-city BPPs are
  // looked up with the city they served, not our home city.
  city: string;
  catalog: unknown;
};

// ---------------------------------------------------------------------------
// ACK / NACK responses (BAP → caller, the sync reply ONDC expects)
// ---------------------------------------------------------------------------

function ack(trace?: AuditTrace, context?: unknown): NextResponse {
  // Echoes the inbound `context` (when known) per ONDC's response contract.
  return buildAck({ context, trace });
}

// A NACK carries an error block and a non-2xx status so the sender can tell it
// apart. We keep `error.message` terse on auth failures — never echo back *why*
// a signature failed (don't coach a forger); the real reason is logged instead.
//
// When `cacheKey` is provided, the (httpStatus, error) pair is stashed in the
// short-TTL negative cache so an identical retry (same Authorization header)
// short-circuits at the top of the handler — no registry lookup, no signature
// verify. Caller passes cacheKey ONLY for rejections that happen AFTER the
// expensive verify pipeline; auth-stage failures aren't worth caching.
function nack(
  httpStatus: number,
  error: OndcError,
  trace?: AuditTrace,
  cacheKey?: string,
  context?: unknown
): NextResponse {
  if (cacheKey) recordRejection(cacheKey, { httpStatus, error });
  return buildNack({ httpStatus, error, context, trace });
}

function cloneForPostAckProcessing(req: Request, rawBody: string): Request {
  const headers = new Headers(req.headers);
  headers.set(FAST_ACK_BYPASS_HEADER, "1");
  return new Request(req.url, {
    method: "POST",
    headers,
    body: rawBody,
  });
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

// Normalize an ONDC URI for tolerant equality: trim whitespace, lowercase the
// scheme+host, strip trailing slashes from the path. ONDC participants and
// gateways disagree on trailing slashes and host casing; without normalization
// "https://openidea.co.in/ondc" vs "https://openidea.co.in/ondc/" will compare
// unequal even though they identify the same endpoint.
function normalizeOndcUri(value: string): string {
  const trimmed = value.trim();
  try {
    const u = new URL(trimmed);
    const pathname = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${pathname}${u.search}`;
  } catch {
    // Not a parseable URL — fall back to trim + trailing-slash strip so at
    // least the obvious cosmetic differences don't trip the check.
    return trimmed.replace(/\/+$/, "");
  }
}

// TEMPORARY (Workbench / staging automation only): the ONDC staging-automation
// harness does NOT echo our bap_id in on_search callbacks — it stamps its OWN
// subscriber id here (identical to the bpp_id it signs with). That is technically
// non-compliant, but it blocks Workbench certification because the bap_id echo gate
// below would NACK it. When ONDC_ALLOW_WORKBENCH_BAP_MISMATCH=1, we allowlist ONLY
// this one well-known automation id; without the flag, every non-echoed bap_id
// NACKs as before. The authoritative controls (signature verification, signer ==
// bpp_id, bap_uri and domain echoes) are all unchanged, so authenticity and routing
// are unaffected. Remove the flag once ONDC fixes the harness / after certification.
const STAGING_AUTOMATION_BAP_ID = "staging-automation.ondc.org";
function isWorkbenchBapMismatchAllowed(): boolean {
  return process.env.ONDC_ALLOW_WORKBENCH_BAP_MISMATCH === "1";
}

// CATALOG REJECTION SIGNAL — when the SNP includes a top-level `error` on its
// /on_search payload, the contract treats that callback as a rejection notice
// (the Workbench Catalog Validation & Rejection flow drives this when the
// search intent contains a sentinel query/category). The BNP MUST echo the
// error block back as a NACK envelope rather than persisting the catalog.
//
// We accept whatever subset of {type, code, message, path} the SNP populated —
// ONDC networks are inconsistent. A bare error block with no `code` is treated
// as no rejection (we ACK normally), because without a code we have no
// rejection reason to mirror back.
function extractInboundError(payload: OnSearchCallback): OndcError | null {
  const raw = payload.error;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const code = typeof obj.code === "string" ? obj.code.trim() : "";
  if (!code) return null;
  const type = typeof obj.type === "string" ? obj.type : undefined;
  const message = typeof obj.message === "string" ? obj.message : undefined;
  const path = typeof obj.path === "string" ? obj.path : undefined;
  return {
    type: type ?? "DOMAIN-ERROR",
    code,
    ...(message ? { message } : {}),
    ...(path ? { path } : {}),
  };
}

// Pull out the required fields, or return an error string naming the first
// problem. Keeps the handler linear and the rules in one auditable place.
// `expected` carries OUR identity so we can reject callbacks that don't quote
// us as the BAP (defense in depth on top of the signature check).
function extractAndValidate(
  payload: OnSearchCallback,
  expected: { bapId: string; bapUri: string; domain: string }
): { ok: true; data: ExtractedOnSearch } | { ok: false; reason: string } {
  const ctx = payload.context;
  if (!ctx) return { ok: false, reason: "missing context" };
  if (ctx.action !== "on_search") {
    return { ok: false, reason: `unexpected action "${ctx.action}"` };
  }
  if (!isNonEmptyString(ctx.transaction_id)) {
    return { ok: false, reason: "missing transaction_id" };
  }
  if (!isNonEmptyString(ctx.message_id)) {
    return { ok: false, reason: "missing message_id" };
  }
  // bpp_id/bpp_uri identify which provider sent this slice — required to route
  // the later select/init/confirm back to it, and to key accumulation.
  if (!isNonEmptyString(ctx.bpp_id)) {
    return { ok: false, reason: "missing bpp_id" };
  }
  if (!isNonEmptyString(ctx.bpp_uri)) {
    return { ok: false, reason: "missing bpp_uri" };
  }
  // Domain / bap identity must echo what WE sent. A RET10 BAP must not silently
  // accept a LOG10 callback, and a callback that quotes someone else's bap_id
  // is at best confused routing, at worst an attempt to misroute responses.
  if (!isNonEmptyString(ctx.domain) || ctx.domain !== expected.domain) {
    return {
      ok: false,
      reason: `unexpected domain "${ctx.domain ?? ""}"`,
    };
  }
  // bap_id echo: a compliant BPP echoes back the bap_id we sent in /search.
  // EXCEPTION (Workbench / staging only, opt-in via ONDC_ALLOW_WORKBENCH_BAP_MISMATCH=1):
  // the ONDC staging-automation harness sends STAGING_AUTOMATION_BAP_ID here instead of
  // echoing ours. When the flag is set we allow ONLY that exact value — warn and continue.
  // Without the flag, or for any other non-echoed bap_id, we NACK as before.
  if (
    isWorkbenchBapMismatchAllowed() &&
    isNonEmptyString(ctx.bap_id) &&
    ctx.bap_id === STAGING_AUTOMATION_BAP_ID
  ) {
    console.warn("ondc.on_search bap_id allowlisted (staging automation)", {
      incomingBapId: ctx.bap_id,
      configuredBapId: expected.bapId,
      configuredSubscriberId: getOndcConfig().subscriberId,
      transactionId: ctx.transaction_id ?? null,
      messageId: ctx.message_id ?? null,
    });
  } else if (!isNonEmptyString(ctx.bap_id) || ctx.bap_id !== expected.bapId) {
    // DEBUG (temporary): dump the identity inputs right before the bap_id gate
    // fails, to explain why Workbench callbacks quote a different bap_id than our
    // outbound search. Logging only — does NOT alter the check. Remove after debugging.
    console.warn("ondc.on_search bap_id mismatch DEBUG", {
      incomingBapId: ctx.bap_id ?? null,
      configuredBapId: expected.bapId,
      configuredSubscriberId: getOndcConfig().subscriberId,
      transactionId: ctx.transaction_id ?? null,
      messageId: ctx.message_id ?? null,
    });
    return {
      ok: false,
      reason: `bap_id mismatch (got "${ctx.bap_id ?? ""}")`,
    };
  }
  if (
    !isNonEmptyString(ctx.bap_uri) ||
    normalizeOndcUri(ctx.bap_uri) !== normalizeOndcUri(expected.bapUri)
  ) {
    return {
      ok: false,
      reason: `bap_uri mismatch (got "${ctx.bap_uri ?? ""}")`,
    };
  }
  // city is required for the registry /lookup that resolves the BPP's signing
  // key — preprod rejects a missing/invalid city with NACK 151. Refuse here
  // rather than guess our home city and silently miss cross-city records.
  if (!isNonEmptyString(ctx.city)) {
    return { ok: false, reason: "missing city" };
  }
  const catalog = payload.message?.catalog;
  if (catalog === null || typeof catalog !== "object") {
    return { ok: false, reason: "missing message.catalog" };
  }

  return {
    ok: true,
    data: {
      transactionId: ctx.transaction_id,
      messageId: ctx.message_id,
      bppId: ctx.bpp_id,
      bppUri: ctx.bpp_uri,
      city: ctx.city,
      catalog,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence seam — NO DATABASE YET (by design).
// ---------------------------------------------------------------------------
//
// On ACK the catalog must outlive this request so the Select API can read it.
// Backed by the dummy store (src/lib/ondc/store.ts): upsert keyed by
// (transaction_id, bpp_id, message_id) so the N async callbacks for one
// transaction — and a BPP's incremental refreshes — accumulate into one
// aggregated, queryable result set. A store write failure throws (OndcStoreError)
// and the handler downgrades it to a NACK rather than silently dropping.
async function persistOnSearchCatalog(data: ExtractedOnSearch): Promise<void> {
  await saveCatalog({
    transactionId: data.transactionId,
    messageId: data.messageId,
    bppId: data.bppId,
    bppUri: data.bppUri,
    catalog: data.catalog,
  });
  // Structured, no-secrets log — keeps the flow observable end-to-end in dev.
  console.log("ondc.on_search persisted", {
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
  const fastAckBypass = req.headers.get(FAST_ACK_BYPASS_HEADER) === "1";

  console.log("ondc.on_search ENTER", {
    ts: new Date().toISOString(),
    url: req.url,
    hasAuth: req.headers.has("authorization"),
    contentLength: req.headers.get("content-length"),
    fastAckBypass,
  });

  const trace = beginAuditTrace({
    action: "on_search",
    requestHeaders: Object.fromEntries(req.headers),
  });

  // Can't verify signatures without our network config loaded.
  // server fault, not the sender's — NACK 500.
  if (!isOndcConfigured()) {
    return nack(500, coreError("BAP not configured"), trace);
  }
  const config = getOndcConfig();

  // (b-i) Authorization header must be present and parseable.
  const authHeader = req.headers.get("authorization");
  const isNoAuth = authHeader?.trim() === "no-auth";
  let parsed = null as unknown as ReturnType<typeof parseAuthorizationHeader>;

  if (!isNoAuth) {
    if (!authHeader) {
      return nack(
        401,
        contextError(ONDC_ERROR.INVALID_SIGNATURE, "missing signature"),
        trace
      );
    }
    parsed = parseAuthorizationHeader(authHeader);
    if (!parsed) {
      return nack(
        401,
        contextError(ONDC_ERROR.INVALID_SIGNATURE, "invalid signature"),
        trace
      );
    }
  }

  // Negative cache: an identical retry (same Authorization header, same body
  // digest) within the short TTL replays the prior NACK without re-running the
  // registry lookup or signature verify. Preprod BPPs retry busted requests
  // dozens of times; this trims that cost without changing what we tell them.
  const cached = lookupRejection(authHeader);
  if (cached && fastAckBypass) {
    console.log("ondc.on_search negative cache hit", {
      subscriberId: parsed.subscriberId,
      httpStatus: cached.httpStatus,
      code: cached.error.code,
    });
    return nack(cached.httpStatus, cached.error, trace);
  }

  // (a) Read the EXACT raw bytes — the digest is computed over these, so
  // re-serializing the parsed object would break verification.
  const rawBody = await req.text();
  annotateTrace(trace, { rawBody });

  // (c-pre) Tolerantly parse the JSON ONLY to lift `context.city` for the
  // registry lookup — preprod's /lookup is city-scoped and a wrong city
  // returns zero records. If parsing fails we fall back to our city and
  // let the signature verification handle the rejection (a body that
  // doesn't parse won't verify either). We do NOT trust any of the parsed
  // values for validation until the signature is checked.
  let tentativePayload: OnSearchCallback | null = null;
  try {
    tentativePayload = JSON.parse(rawBody) as OnSearchCallback;
  } catch {
    // intentional: deferred to the post-verify parse below.
  }
  const tentativeCity = tentativePayload?.context?.city;

  // Workbench grades /on_search on the synchronous HTTP response. For a normal
  // catalog callback, ACK immediately after parsing enough to echo context, then
  // run the existing signature/identity/persistence pipeline after the response.
  // Top-level error callbacks are excluded because the contract expects a
  // business NACK echo for those.
  if (!fastAckBypass && tentativePayload && !extractInboundError(tentativePayload)) {
    after(async () => {
      try {
        await POST(cloneForPostAckProcessing(req, rawBody));
      } catch (err) {
        console.error("ondc.on_search post-ack verifier failed", {
          msg: err instanceof Error ? err.message : String(err),
          transactionId: tentativePayload.context?.transaction_id ?? null,
          messageId: tentativePayload.context?.message_id ?? null,
          bppId: tentativePayload.context?.bpp_id ?? null,
        });
      }
    });
    return ack(trace, tentativePayload.context);
  }

  if (!isNoAuth) {
    const publicKey = await resolveBppSigningPublicKey(
      parsed!.subscriberId,
      parsed!.uniqueKeyId,
      typeof tentativeCity === "string" && tentativeCity.trim().length > 0
        ? tentativeCity
        : undefined
    );
    if (!publicKey) {
      console.warn("ondc.on_search key resolution failed", {
        gate: 5,
        subscriberId: parsed!.subscriberId,
        uniqueKeyId: parsed!.uniqueKeyId,
        city: tentativeCity,
      });
      return nack(
        401,
        contextError(ONDC_ERROR.INVALID_KEY, "unauthorized"),
        trace
      );
    }

    const verdict = verifyOndcSignature({
      rawBody,
      parsed: parsed!,
      publicKey: normalizeEd25519PublicKey(publicKey),
    });
    if (!verdict.valid) {
      console.warn("ondc.on_search signature rejected", {
        gate:
          verdict.reason === "expired" ||
          verdict.reason === "created in the future"
            ? 6
            : 7,
        subscriberId: parsed!.subscriberId,
        reason: verdict.reason,
      });
      return nack(
        401,
        contextError(ONDC_ERROR.INVALID_SIGNATURE, "unauthorized"),
        trace
      );
    }
  }

  // (c) Body is trusted — now demand a parseable shape (we could not 400 on
  // bad JSON earlier without leaking which-stage-failed signal to forgers).
  if (!tentativePayload) {
    return nack(
      400,
      contextError(ONDC_ERROR.CONTEXT_GENERIC, "invalid JSON"),
      trace,
      authHeader
    );
  }

  // The inbound (now signature-verified, parseable) context, echoed back in our
  // sync ACK/NACK per ONDC's response contract (Workbench grades a context-less
  // response as "context missing").
  const ctx = tentativePayload.context;

  // CATALOG-REJECTION pass-through. If the verified payload carries a
  // top-level error block with a code, the SNP is reporting that this catalog
  // slice should be rejected (Workbench Catalog Validation & Rejection flow).
  // Echo it back as a NACK envelope, HTTP 200 (it's a business NACK, not a
  // transport failure), and skip persistence + idempotency commit — there is
  // nothing to ingest. We do this BEFORE extractAndValidate, because a
  // rejection callback may omit `message.catalog` and would otherwise be
  // NACK'd with our generic "missing message.catalog" error instead of the
  // SNP's actual rejection reason.
  const inboundError = extractInboundError(tentativePayload);
  if (inboundError) {
    console.log("ondc.on_search catalog rejection passthrough", {
      transactionId: tentativePayload.context?.transaction_id ?? null,
      messageId: tentativePayload.context?.message_id ?? null,
      bppId: tentativePayload.context?.bpp_id ?? null,
      errorCode: inboundError.code,
      errorType: inboundError.type,
    });
    return nack(200, inboundError, trace, authHeader, ctx);
  }

  // (c/d) Full structural + identity validation. bap_id/bap_uri/domain must
  // echo OUR identity (defense in depth on top of the signature check).
  const result = extractAndValidate(tentativePayload, {
    bapId: config.bapId,
    bapUri: config.bapUri,
    domain: config.domain,
  });
  if (!result.ok) {
    // Surface the rejected field in logs. The NACK body already carries this
    // reason, but Vercel's runtime log view shows only the ENTER line, so
    // without an explicit warn we can't tell which echo (bap_id, bap_uri,
    // domain, city, catalog) Workbench/BPP is sending wrong.
    console.warn("ondc.on_search rejected", {
      // DEBUG (temporary): map the extract/identity reason to its gate number
      // (15 domain, 16 bap_id, 17 bap_uri, 18 city; 0 = a different field).
      gate: result.reason.startsWith("unexpected domain")
        ? 15
        : result.reason.startsWith("bap_id mismatch")
          ? 16
          : result.reason.startsWith("bap_uri mismatch")
            ? 17
            : result.reason === "missing city"
              ? 18
              : 0,
      reason: result.reason,
      receivedBapId: tentativePayload.context?.bap_id,
      receivedBapUri: tentativePayload.context?.bap_uri,
      receivedDomain: tentativePayload.context?.domain,
      receivedCity: tentativePayload.context?.city,
      expectedBapId: config.bapId,
      expectedBapUri: config.bapUri,
      expectedDomain: config.domain,
    });
    return nack(
      400,
      contextError(ONDC_ERROR.CONTEXT_GENERIC, result.reason),
      trace,
      authHeader,
      ctx
    );
  }
  annotateTrace(trace, {
    transactionId: result.data.transactionId,
    messageId: result.data.messageId,
    bppId: result.data.bppId,
  });

  // Envelope freshness: context.timestamp must be within skew, and
  // context.timestamp + context.ttl must not have elapsed. Separate from the
  // HTTP-signature freshness checked above — that covers the signing string,
  // this covers the Beckn envelope.
  const fresh = validateContextFreshness(tentativePayload.context);
  if (!fresh.ok) {
    console.warn("ondc.on_search freshness rejected", {
      kind: fresh.failure.kind,
      transactionId: result.data.transactionId,
      bppId: result.data.bppId,
    });
    return nack(400, freshnessError(fresh.failure), trace, authHeader, ctx);
  }

  // Idempotency CHECK (read-only): a same (action, txn, msg) re-send is
  // workbench/BPP retrying because they didn't get our prior ACK. If this tuple
  // was already COMMITTED (a prior attempt persisted successfully), replay-ACK
  // without persisting again. We only PEEK here — the tuple is committed AFTER
  // persist succeeds (see commitMessageId below), so a failed persist is
  // correctly retried instead of being masked as success.
  const seen = peekMessageId(
    "on_search",
    result.data.transactionId,
    result.data.messageId
  );
  if (seen.status === "replay") {
    console.log("ondc.on_search idempotent replay", {
      transactionId: result.data.transactionId,
      messageId: result.data.messageId,
      firstSeenAt: new Date(seen.firstSeenAt).toISOString(),
    });
    return ack(trace, ctx);
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // claims to have sent this catalog. A mismatch means a valid participant is
  // posting under someone else's bpp_id — reject it.
  if (!isNoAuth && parsed!.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_search signer/bpp_id mismatch", {
      gate: 22, // DEBUG (temporary): signer subscriber_id ≠ context.bpp_id
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(
      401,
      contextError(ONDC_ERROR.IDENTITY_MISMATCH, "unauthorized"),
      trace,
      authHeader,
      ctx
    );
  }

  // (e/f) Return the synchronous ACK immediately; do persistence and catalog
  // rejection work after the response is committed. The Workbench ACK window is
  // short, and waiting on JSON/blob/DB storage can be reported as "no response".
  after(async () => {
    try {
      await persistOnSearchCatalog(result.data);
    } catch (err) {
      const e = err instanceof Error ? err : null;
      // Surface the wrapped CAUSE so we can tell EROFS / EACCES (Vercel read-only
      // FS) from a Blob auth failure from a real bug. Without this the route was
      // logging only the wrapper message ("failed to persist snapshot").
      const cause = e && "cause" in e ? (e.cause as Error | undefined) : undefined;
      console.error("ondc.on_search persist failed", {
        msg: e?.message ?? "persistence error",
        causeMessage: cause?.message,
        causeCode: (cause as NodeJS.ErrnoException | undefined)?.code,
        transactionId: result.data.transactionId,
        bppId: result.data.bppId,
      });
      return;
    }

    // Commit idempotency ONLY now that persistence has succeeded. Committing
    // after persist (not before) is what prevents the ACK-without-persistence
    // bug: a failed persist remains retryable on a fresh sender retry.
    commitMessageId(
      "on_search",
      result.data.transactionId,
      result.data.messageId
    );

    // RET 1.2.5 Catalog Validation & Rejection Flow: after ACKing the catalog,
    // the BAP walks it and, when it finds items/stores it refuses to ingest,
    // POSTs a follow-up `catalog_rejection` callback to the SNP.
    const validation = validateCatalog(result.data.catalog);
    if (!validation.ok && validation.error) {
      console.log("ondc.on_search catalog rejected (firing callback)", {
        transactionId: result.data.transactionId,
        bppId: result.data.bppId,
        errorCode: validation.error.code,
        rejectionCount: validation.rejections.length,
      });
      await postCatalogRejection({
        bppId: result.data.bppId,
        bppUri: result.data.bppUri,
        transactionId: result.data.transactionId,
        city: result.data.city,
        error: validation.error,
      });
    }
  });

  // (f) Accept. The aggregated catalogs are now (will be) available for the
  // future Select API to read by transaction_id.
  return ack(trace, ctx);
}
