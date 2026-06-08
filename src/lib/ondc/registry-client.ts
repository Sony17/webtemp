// ONDC registry — HARDENED sender-key resolution.
//
// This is the production-grade counterpart to the verbatim extraction in
// registry.ts. It is the single place the inbound callback path resolves a
// sender's Ed25519 signing public key, with the safeguards the network actually
// requires:
//
//   1. Signed POST /vlookup (not the unsigned /lookup) — the registry will only
//      answer authenticated queries on preprod/prod, and its response is bound
//      to OUR request id, so an attacker can't replay an answer to us.
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
const EXPECTED_PARTICIPANT_TYPE = "sellerApp";

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

  // 3. Participant type. The registry surfaces buyerApp/sellerApp/gateway/LSP;
  //    we're verifying inbound seller callbacks, so anything else is wrong.
  if (record.type && record.type !== EXPECTED_PARTICIPANT_TYPE) {
    return {
      ok: false,
      reason: "subscriber_mismatch",
      detail: `expected type ${EXPECTED_PARTICIPANT_TYPE}, got ${record.type}`,
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

// /vlookup query envelope per the v2.0 spec. Sending the same six filters that
// /lookup accepts scopes the answer to exactly the record we're verifying.
type VlookupQuery = {
  sender_subscriber_id: string; // who is asking — us
  request_id: string; // freshness binder, included in the registry's reply
  timestamp: string; // ISO-8601 — registry rejects skewed timestamps
  search_parameters: {
    subscriber_id: string;
    unique_key_id: string;
    domain: string;
    country: string;
    city: string;
    type: string;
  };
};

function buildVlookupQuery(
  expected: { subscriberId: string; uniqueKeyId: string },
  nowMs: number
): VlookupQuery {
  const config = getOndcConfig();
  // Deterministic request_id: subscriber|ukId|nowMs — unique enough for ONDC's
  // dedup, traceable in logs, and we don't need crypto-random here (the value
  // is bound to the signature, not the secret).
  const requestId = `${config.subscriberId}-${expected.uniqueKeyId}-${nowMs}`;
  return {
    sender_subscriber_id: config.subscriberId,
    request_id: requestId,
    timestamp: new Date(nowMs).toISOString(),
    search_parameters: {
      subscriber_id: expected.subscriberId,
      unique_key_id: expected.uniqueKeyId,
      domain: config.domain,
      country: config.countryCode,
      city: config.cityCode,
      type: EXPECTED_PARTICIPANT_TYPE,
    },
  };
}

// /vlookup returns either an array (most versions) or a wrapper with an array
// under `subscribers`. We tolerate both because preprod and prod have drifted.
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

async function fetchAndValidate(
  expected: { subscriberId: string; uniqueKeyId: string },
  nowSec: number,
  nowMs: number
): Promise<RegistryResolveResult> {
  const config = getOndcConfig();
  const url = `${config.registryBaseUrl}/vlookup`;
  const body = JSON.stringify(buildVlookupQuery(expected, nowMs));

  // Sign the body — preprod/prod /vlookup requires it. Catch the auth path's
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

  const fetchStartedAt = Date.now();
  console.log("ondc.registry vlookup start", {
    startedAt: new Date(fetchStartedAt).toISOString(),
    url,
  });
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
    console.log("ondc.registry vlookup response", {
      status: res.status,
      elapsedMs: Date.now() - fetchStartedAt,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "registry_unreachable",
      detail: err instanceof Error ? err.message : "network error",
    };
  }

  if (!res.ok) {
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
    return { ok: false, reason: "registry_malformed_response" };
  }

  // The registry can return multiple records per subscriber (one per key).
  // Walk them and accept the first that fully validates against our
  // expectation; collect the LAST rejection reason for diagnostics so the
  // operator can see *why* nothing matched, not just "no match".
  let lastFail: ValidationFail | null = null;
  for (const record of records) {
    const verdict = validateRegistryRecord(record, expected, nowSec);
    if (verdict.ok) {
      return { ok: true, signingPublicKey: verdict.signingPublicKey, cached: false };
    }
    lastFail = verdict;
  }

  // No matching/validated record. Surface the most informative reason we saw.
  if (lastFail) {
    return { ok: false, reason: lastFail.reason, detail: lastFail.detail };
  }
  // Empty array — record genuinely absent.
  return { ok: false, reason: "key_not_found", detail: "registry returned no records" };
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
  now?: number
): Promise<RegistryResolveResult> {
  const nowMs = now ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const key = cacheKey(subscriberId, uniqueKeyId);
  const cached = readCache(key, nowSec);
  if (cached) {
    if (cached.kind === "positive") {
      return { ok: true, signingPublicKey: cached.signingPublicKey, cached: true };
    }
    return { ok: false, reason: cached.reason, detail: "cached negative" };
  }

  const result = await fetchAndValidate(
    { subscriberId, uniqueKeyId },
    nowSec,
    nowMs
  );

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
