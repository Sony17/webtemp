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
import { NextResponse } from "next/server";
import { getOndcConfig, isOndcConfigured } from "@/lib/ondc/config";
import { resolveBppSigningPublicKey } from "@/lib/ondc/registry";
import {
  parseAuthorizationHeader,
  normalizeEd25519PublicKey,
  verifyOndcSignature,
} from "@/lib/ondc/auth";
import type { OndcAckResponse, OndcError } from "@/lib/ondc/client";
import { saveCatalog } from "@/lib/ondc/store";

// auth.ts (node:crypto) + config are `import "server-only"`, so this callback
// must run on the Node runtime, like the rest of the app's API routes.
export const runtime = "nodejs";

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
};

type OnSearchCallback = {
  context?: OnSearchContext;
  message?: { catalog?: unknown };
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
  if (!isNonEmptyString(ctx.bap_id) || ctx.bap_id !== expected.bapId) {
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
  console.log("ondc.on_search ENTER", {
    ts: new Date().toISOString(),
    url: req.url,
    headers: [...req.headers.keys()],
  });

  // Can't verify signatures without our network config loaded.
  // server fault, not the sender's — NACK 500.
  if (!isOndcConfigured()) {
    return nack(500, { type: "CORE-ERROR", message: "BAP not configured" });
  }
  const config = getOndcConfig();

  // (b-i) Authorization header must be present and parseable.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return nack(401, { type: "CONTEXT-ERROR", message: "missing signature" });
  }
  const parsed = parseAuthorizationHeader(authHeader);
  if (!parsed) {
    return nack(401, { type: "CONTEXT-ERROR", message: "invalid signature" });
  }

  // (a) Read the EXACT raw bytes — the digest is computed over these, so
  // re-serializing the parsed object would break verification.
  const rawBody = await req.text();

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

  // (b-ii) Resolve the sender's registry public key (scoped to the city the
  // BPP served) and verify the signature.
  const publicKey = await resolveBppSigningPublicKey(
    parsed.subscriberId,
    parsed.uniqueKeyId,
    typeof tentativeCity === "string" && tentativeCity.trim().length > 0
      ? tentativeCity
      : undefined
  );
  if (!publicKey) {
    console.warn("ondc.on_search key resolution failed", {
      subscriberId: parsed.subscriberId,
      uniqueKeyId: parsed.uniqueKeyId,
      city: tentativeCity,
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
    console.warn("ondc.on_search signature rejected", {
      subscriberId: parsed.subscriberId,
      reason: verdict.reason,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (c) Body is trusted — now demand a parseable shape (we could not 400 on
  // bad JSON earlier without leaking which-stage-failed signal to forgers).
  if (!tentativePayload) {
    return nack(400, { type: "CONTEXT-ERROR", message: "invalid JSON" });
  }

  // (c/d) Full structural + identity validation. bap_id/bap_uri/domain must
  // echo OUR identity (defense in depth on top of the signature check).
  const result = extractAndValidate(tentativePayload, {
    bapId: config.bapId,
    bapUri: config.bapUri,
    domain: config.domain,
  });
  if (!result.ok) {
    return nack(400, { type: "CONTEXT-ERROR", message: result.reason });
  }

  // Defense in depth: the signer (keyId.subscriber_id) should be the BPP that
  // claims to have sent this catalog. A mismatch means a valid participant is
  // posting under someone else's bpp_id — reject it.
  if (parsed.subscriberId !== result.data.bppId) {
    console.warn("ondc.on_search signer/bpp_id mismatch", {
      signer: parsed.subscriberId,
      bppId: result.data.bppId,
    });
    return nack(401, { type: "CONTEXT-ERROR", message: "unauthorized" });
  }

  // (e) Hand off to persistence (currently a logging no-op). We await it so a
  // future store failure can downgrade to a NACK rather than a silent drop.
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
    return nack(500, { type: "CORE-ERROR", message: "could not store catalog" });
  }

  // (f) Accept. The aggregated catalogs are now (will be) available for the
  // future Select API to read by transaction_id.
  return ack();
}
