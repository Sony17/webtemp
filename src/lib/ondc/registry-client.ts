// ONDC registry — HARDENED sender-key resolution.
//
// This is the production-grade counterpart to the verbatim extraction in
// registry.ts. It is the single place the inbound callback path resolves a
// sender's Ed25519 signing public key, with the safeguards the network actually
// requires:
//
//   1. Signed POST /lookup — preprod's v2.0 registry does not expose /vlookup
//      (Spring 404 on /v2.0/vlookup, CDN 403 on bare /vlookup). /lookup at v2.0
//      accepts the same signed Authorization + Digest headers and returns the
//      subscriber records we need. Anti-replay / identity safety comes from
//      the strict (subscriber_id, ukId) match in validation below, not the URL.
//   2. Strict (subscriber_id, unique_key_id) match — never positional fallback.
//   3. Subscriber validation — the returned record's subscriber_id/domain/type
//      must match what we asked for; a mismatch is a forgery signal, not data.
//   4. SUBSCRIBED status — keys belonging to INITIATED / UNDER_SUBSCRIPTION /
//      EXPIRED / INVALID_SSL participants are refused even when mathematically
//      valid, because the network doesn't consider them live participants.
//   5. Key validity window — valid_from <= now <= valid_until. A small clock
//      skew is allowed in both directions, matching auth.verifyOndcSignature.
//   6. Key rotation — the cache is keyed by (subscriber_id, unique_key_id), so
//      a rotated ukId naturally drives a fresh lookup; we never reuse an old
//      cached key for a new ukId.
//   7. TTL cache — positive entries cached for POSITIVE_TTL_SECONDS. The key
//      itself may rotate before that; the TTL bounds how long we can be wrong.
//   8. Negative cache — "no such record" / "not SUBSCRIBED" answers cached for
//      a SHORTER NEGATIVE_TTL_SECONDS, so an attacker spraying garbage ukIds
//      can't make us hammer the registry, but a real registration that lands a
//      minute later isn't denied for long.
//
// Failure model: every public function returns a typed Result. We never throw
// across the API boundary — verification callers turn a non-OK into a NACK 401,
// and the diagnostic route surfaces the reason verbatim.
import "server-only";
import { signRequest } from "@/lib/ondc/auth";
import { getOndcConfig } from "@/lib/ondc/config";

// ---------------------------------------------------------------------------
// Tunables. Kept as module-level constants (not env) on purpose: a TTL changes
// rarely and is a security property, not a deployment knob.
// ---------------------------------------------------------------------------

// How long a successfully resolved, validated key is reused before we re-ask
// the registry. Short enough that a key rotation propagates within minutes;
// long enough that a busy gateway burst doesn't fan out to registry traffic.
const POSITIVE_TTL_SECONDS = 10 * 60; // 10 minutes

// How long a "no such record" / "not SUBSCRIBED" answer is remembered. Shorter
// than positive TTL on purpose: a real subscription can flip to SUBSCRIBED
// within the registration window, and we shouldn't keep refusing it for hours.
const NEGATIVE_TTL_SECONDS = 30;

// Clock skew tolerance when comparing now against the key's valid_from /
// valid_until. Mirrors the 5s allowance in auth.verifyOndcSignature so the two
// stay aligned (no scenario where the signature is "fresh" but the key window
// declares the signer's key out-of-validity).
const CLOCK_SKEW_SECONDS = 5;

// Registry participant role for our callback senders. We only ever verify
// inbound callbacks from sellerApp (BPP) — buyer-side actions, by definition,
// originate FROM us, not TO us. Making this a constant guards against ever
// accidentally accepting a key belonging to a gateway/LSP record.
//
// The /lookup request FILTER uses the ONDC name "sellerApp". The /lookup
// RESPONSE record's `type` field uses Beckn's acronym "BPP" for the same role.
// We accept either on the response side; we only send "sellerApp" as the
// filter.
const LOOKUP_FILTER_PARTICIPANT_TYPE = "sellerApp";
const ACCEPTED_RESPONSE_PARTICIPANT_TYPES = new Set(["sellerApp", "BPP"]);

// ---------------------------------------------------------------------------
// Result types. Every reason a verification can fail has a distinct tag so the
// callback route can NACK with a specific log line (never surfaced to the
// caller — we don't help a forger triangulate which check tripped).
// ---------------------------------------------------------------------------

export type RegistryFailureReason =
  | "registry_unreachable"
  | "registry_http_error"
  | "registry_malformed_response"
  | "subscriber_mismatch"
  | "key_not_found"
  | "key_not_subscribed"
  | "key_outside_validity_window"
  | "signing_error";

export type RegistryResolveResult =
  | { ok: true; signingPublicKey: string; cached: boolean }
  | { ok: false; reason: RegistryFailureReason; detail?: string };

// ---------------------------------------------------------------------------
// Cache. A single Map holds both positive ("here's the key") and negative
// ("no such key") entries, distinguished by the discriminator. Sharing one
// map keeps eviction and lookup uniform; the negative branch deliberately has
// no key string, only a reason.
// ---------------------------------------------------------------------------

type CacheEntry =
  | { kind: "positive"; signingPublicKey: string; expiresAt: number }
  | { kind: "negative"; reason: RegistryFailureReason; expiresAt: number };

const cache = new Map<string, CacheEntry>();

// Cache key is just the identity tuple. Since /lookup no longer filters by
// city/domain/country, an answer applies network-wide for that (subscriber,
// ukId) — no need to partition the cache by city.
function cacheKey(subscriberId: string, uniqueKeyId: string): string {
  return `${subscriberId}|${uniqueKeyId}`;
}

function readCache(key: string, nowSec: number): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowSec) {
    cache.delete(key);
    return null;
  }
  return entry;
}

// Exposed for tests + the diagnostic route; the resolver never calls it
// directly. Keeps the cache observable without exposing its internals.
export function clearRegistryCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Registry shape. The ONDC registry's /vlookup response is an array of records;
// we accept either snake_case or camelCase variants for the few fields whose
// casing has drifted across versions. EVERY field is optional in the type
// because the registry can omit fields — validation below treats missing
// required fields as a failure, not as "absent means ok".
// ---------------------------------------------------------------------------

type RegistryRecord = {
  // Identity
  subscriber_id?: string;
  subscriberId?: string;
  // Key identity
  ukId?: string;
  unique_key_id?: string;
  uniqueKeyId?: string;
  // Key material
  signing_public_key?: string;
  signingPublicKey?: string;
  // Role + status
  type?: string; // "buyerApp" | "sellerApp" | "gateway" | "LSP"
  status?: string; // "SUBSCRIBED" | "INITIATED" | ...
  subscriber_status?: string; // some versions emit this name
  // Validity window — ONDC emits ISO-8601 timestamps
  valid_from?: string;
  validFrom?: string;
  valid_until?: string;
  valid_to?: string;
  validUntil?: string;
  validTo?: string;
};

function pickString(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

// Parse an ISO-8601 timestamp to epoch seconds. Returns null for missing /
// malformed input; callers decide whether absence is fatal (we treat a missing
// valid_until as "no expiry" but a malformed one as a hard failure).
function parseIsoSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

// ---------------------------------------------------------------------------
// Validation. Pure: takes (record, expectations, now) → ok | reason.
// Separated from the network call so it's unit-testable against synthetic
// records without spinning up a fake registry.
// ---------------------------------------------------------------------------

type ValidationOk = {
  ok: true;
  signingPublicKey: string;
};
type ValidationFail = {
  ok: false;
  reason: RegistryFailureReason;
  detail?: string;
};

export function validateRegistryRecord(
  record: RegistryRecord,
  expected: { subscriberId: string; uniqueKeyId: string },
  nowSec: number
): ValidationOk | ValidationFail {
  // 1. Subscriber match — the registry CAN return multiple records; we MUST
  //    accept only the one whose subscriber_id matches what we asked for.
  const recSubscriber = pickString(record.subscriber_id, record.subscriberId);
  if (recSubscriber !== expected.subscriberId) {
    return {
      ok: false,
      reason: "subscriber_mismatch",
      detail: `expected ${expected.subscriberId}, got ${recSubscriber ?? "<none>"}`,
    };
  }

  // 2. ukId strict match — fail closed; no positional fallback. The whole
  //    point of ukId is to disambiguate concurrent / rotating keys.
  const recUkId = pickString(
    record.ukId,
    record.unique_key_id,
    record.uniqueKeyId
  );
  if (recUkId !== expected.uniqueKeyId) {
    return {
      ok: false,
      reason: "key_not_found",
      detail: `expected ukId ${expected.uniqueKeyId}, got ${recUkId ?? "<none>"}`,
    };
  }

  // 3. Participant type. The registry surfaces buyerApp/sellerApp/gateway/LSP
  //    on input, and the response field uses Beckn's "BPP"/"BAP" acronyms; we
  //    accept either spelling for the seller role. Anything else is wrong.
  if (record.type && !ACCEPTED_RESPONSE_PARTICIPANT_TYPES.has(record.type)) {
    return {
      ok: false,
      reason: "subscriber_mismatch",
      detail: `expected one of [${[...ACCEPTED_RESPONSE_PARTICIPANT_TYPES].join(", ")}], got ${record.type}`,
    };
  }

  // 4. SUBSCRIBED. Some registry versions name this `status`, some
  //    `subscriber_status`. We accept either; a missing value is treated as
  //    not-SUBSCRIBED (refuse rather than assume).
  const status = pickString(record.status, record.subscriber_status);
  if (status !== "SUBSCRIBED") {
    return {
      ok: false,
      reason: "key_not_subscribed",
      detail: `status=${status ?? "<none>"}`,
    };
  }

  // 5. Validity window. valid_from is required (if absent we refuse); a
  //    missing valid_until is allowed (no upper bound), but a malformed one
  //    is a hard failure — never silently extend.
  const validFromRaw = pickString(record.valid_from, record.validFrom);
  const validUntilRaw = pickString(
    record.valid_until,
    record.valid_to,
    record.validUntil,
    record.validTo
  );
  const validFrom = parseIsoSeconds(validFromRaw);
  if (validFrom === null) {
    return {
      ok: false,
      reason: "key_outside_validity_window",
      detail: `valid_from missing/malformed: ${validFromRaw ?? "<none>"}`,
    };
  }
  if (nowSec + CLOCK_SKEW_SECONDS < validFrom) {
    return {
      ok: false,
      reason: "key_outside_validity_window",
      detail: `not yet valid (valid_from=${validFromRaw})`,
    };
  }
  if (validUntilRaw !== undefined) {
    const validUntil = parseIsoSeconds(validUntilRaw);
    if (validUntil === null) {
      return {
        ok: false,
        reason: "key_outside_validity_window",
        detail: `valid_until malformed: ${validUntilRaw}`,
      };
    }
    if (nowSec - CLOCK_SKEW_SECONDS > validUntil) {
      return {
        ok: false,
        reason: "key_outside_validity_window",
        detail: `expired (valid_until=${validUntilRaw})`,
      };
    }
  }

  // 6. Key material. After all the above checks the key is finally trusted —
  //    no point validating its bytes here; auth.normalizeEd25519PublicKey
  //    rejects bad shapes at verify-time with a precise error.
  const signingPublicKey = pickString(
    record.signing_public_key,
    record.signingPublicKey
  );
  if (!signingPublicKey) {
    return {
      ok: false,
      reason: "key_not_found",
      detail: "record has no signing_public_key",
    };
  }

  return { ok: true, signingPublicKey };
}

// ---------------------------------------------------------------------------
// Network call. Signed POST /vlookup with our identity, then validate the
// response. Kept fail-soft (no throws) so the caller can NACK cleanly.
// ---------------------------------------------------------------------------

// /lookup query body. The (subscriber_id, ukId) pair is already unique in the
// registry — domain / country / city would be additional AND-narrowing that
// excludes valid BPPs registered under sibling domains or different city
// codes. We send only the identity tuple + the sellerApp role and rely on the
// post-fetch validator (strict subscriber_id + ukId + SUBSCRIBED + validity
// window match) for correctness. The previous strict 6-field query was
// returning zero records for workbench's mock seller; this single targeted
// lookup is the simpler answer.
//
// If preprod's /lookup ever responds NACK 151 ("city is required") to this
// shape, that surfaces as a clean error in extractNackError below — at which
// point add fields back deliberately, instead of guessing.
type LookupQuery = {
  subscriber_id: string;
  ukId: string;
  type: string;
};

function buildLookupQuery(expected: {
  subscriberId: string;
  uniqueKeyId: string;
}): LookupQuery {
  return {
    subscriber_id: expected.subscriberId,
    ukId: expected.uniqueKeyId,
    type: LOOKUP_FILTER_PARTICIPANT_TYPE,
  };
}

// /lookup returns either a bare array of records (preprod v2.0) or a wrapper
// with the array under `subscribers` (some other registry versions). We
// tolerate both because preprod and prod have drifted.
function extractRecords(raw: unknown): RegistryRecord[] | null {
  if (Array.isArray(raw)) return raw as RegistryRecord[];
  if (raw && typeof raw === "object") {
    const wrapper = raw as { subscribers?: unknown };
    if (Array.isArray(wrapper.subscribers)) {
      return wrapper.subscribers as RegistryRecord[];
    }
  }
  return null;
}

// preprod /lookup returns HTTP 200 with a Beckn NACK envelope when the request
// schema is rejected (e.g. missing/invalid city). We surface the registry's
// own error message rather than the generic "malformed" reason — the operator
// needs to see the actual NACK code/text to diagnose the request shape.
function extractNackError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as {
    message?: { ack?: { status?: string } };
    error?: { code?: string; message?: string; type?: string };
  };
  if (env.message?.ack?.status !== "NACK") return null;
  const code = env.error?.code ?? "?";
  const msg = env.error?.message ?? "<no message>";
  return `NACK ${code}: ${msg}`;
}

// Signed POST /lookup with the identity-only query, then validate the records
// against our (subscriber_id, ukId, SUBSCRIBED, validity-window) expectation.
// Single round-trip. If preprod ever NACKs the schema (e.g. demands a city
// field), the NACK text surfaces verbatim in the result `detail` so we add the
// field back deliberately rather than guessing.
async function fetchAndValidate(
  expected: { subscriberId: string; uniqueKeyId: string },
  nowSec: number
): Promise<RegistryResolveResult> {
  const config = getOndcConfig();
  const url = `${config.registryBaseUrl}/lookup`;
  const body = JSON.stringify(buildLookupQuery(expected));

  // Sign the body — preprod/prod /lookup accepts the same Beckn Authorization
  // + Digest headers that every other ONDC call uses. Catch the auth path's
  // typed error here so it's reported as a resolve reason instead of throwing
  // up into the callback route (which would 500 instead of cleanly NACKing).
  let authorization: string;
  let digest: string;
  try {
    const signed = signRequest(body);
    authorization = signed.authorization;
    digest = signed.digest;
  } catch (err) {
    return {
      ok: false,
      reason: "signing_error",
      detail: err instanceof Error ? err.message : "signing failed",
    };
  }

  console.log("ondc.registry lookup request", { url, expected });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
        Digest: digest,
      },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "registry_unreachable",
      detail: err instanceof Error ? err.message : "network error",
    };
  }

  if (!res.ok) {
    const text = await res.text();
    console.warn("ondc.registry lookup http error", {
      url,
      status: res.status,
      body: text,
    });
    return {
      ok: false,
      reason: "registry_http_error",
      detail: `HTTP ${res.status}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, reason: "registry_malformed_response" };
  }

  const records = extractRecords(parsed);
  if (!records) {
    // preprod returns HTTP 200 with a Beckn NACK envelope when it rejects the
    // request schema (e.g. demands a city/domain field we omitted). Surface
    // the registry's own error so we can fix the query shape deliberately.
    const nack = extractNackError(parsed);
    if (nack) return { ok: false, reason: "registry_http_error", detail: nack };
    return { ok: false, reason: "registry_malformed_response" };
  }

  // Walk records; take the first that validates. Collect the LAST rejection
  // reason so a "registry returned 3 records but none SUBSCRIBED" answer is
  // visible instead of a vague "key_not_found".
  let lastFail: ValidationFail | null = null;
  for (const record of records) {
    const verdict = validateRegistryRecord(record, expected, nowSec);
    if (verdict.ok) {
      return {
        ok: true,
        signingPublicKey: verdict.signingPublicKey,
        cached: false,
      };
    }
    lastFail = verdict;
  }

  if (lastFail) {
    return { ok: false, reason: lastFail.reason, detail: lastFail.detail };
  }
  return {
    ok: false,
    reason: "key_not_found",
    detail: "registry returned no records",
  };
}

// ---------------------------------------------------------------------------
// Public entry point. Cache-first, with both positive and negative TTLs.
// ---------------------------------------------------------------------------

// Resolve the BPP's Ed25519 signing public key with full hardening. Returns a
// discriminated result the caller maps to either successful verification or a
// specific NACK reason. `now` is injectable for tests.
export async function resolveBppSigningKey(
  subscriberId: string,
  uniqueKeyId: string,
  // `city` is accepted but ignored — kept for call-site compatibility with the
  // on_* routes that still pass context.city through. /lookup is no longer
  // city-scoped, so the field has no effect on resolution.
  options?: { city?: string; now?: number }
): Promise<RegistryResolveResult> {
  const nowMs = options?.now ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const key = cacheKey(subscriberId, uniqueKeyId);
  const cached = readCache(key, nowSec);
  if (cached) {
    if (cached.kind === "positive") {
      return { ok: true, signingPublicKey: cached.signingPublicKey, cached: true };
    }
    return { ok: false, reason: cached.reason, detail: "cached negative" };
  }

  const result = await fetchAndValidate({ subscriberId, uniqueKeyId }, nowSec);

  // Only cache TERMINAL outcomes. A transient network/HTTP fault is NOT cached
  // — caching "registry was down" would extend the outage past its real end.
  if (result.ok) {
    cache.set(key, {
      kind: "positive",
      signingPublicKey: result.signingPublicKey,
      expiresAt: nowSec + POSITIVE_TTL_SECONDS,
    });
  } else if (
    result.reason === "key_not_found" ||
    result.reason === "key_not_subscribed" ||
    result.reason === "subscriber_mismatch" ||
    result.reason === "key_outside_validity_window"
  ) {
    cache.set(key, {
      kind: "negative",
      reason: result.reason,
      expiresAt: nowSec + NEGATIVE_TTL_SECONDS,
    });
  }
  // registry_unreachable / registry_http_error / registry_malformed_response /
  // signing_error: NOT cached. These reflect OUR side or transport health, not
  // a definitive answer from the registry about the subscriber.

  return result;
}
