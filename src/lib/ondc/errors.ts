// ONDC error codes used in NACK responses.
//
// ONDC's error-code-spec assigns numeric codes to common failure modes so a
// counterparty (and the workbench reviewer) can grade NACKs without parsing
// `error.message`. We previously sent `{ type, message }` only; workbench grades
// on `error.code`. This module centralises the codes we emit so every `nack()`
// call site has a single source of truth.
//
// Codes are taken from the ONDC error-code-spec (Beckn 1.2.x family). They are
// stringified on the wire — ONDC's spec types `code` as a string, not a number.
//
// Reference: https://github.com/ONDC-Official/developer-docs (error-code-spec).
import "server-only";

import type { OndcError } from "@/lib/ondc/client";
import type { ContextFreshnessFailure } from "@/lib/ondc/context";

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

// CONTEXT-ERROR family (10xxx / 20xxx) — envelope, auth, freshness, identity.
export const ONDC_ERROR = {
  // 10001 — JSON schema validation failure on the inbound body.
  JSON_SCHEMA: "10001",
  // 10002 — Invalid action (context.action doesn't match the endpoint).
  INVALID_ACTION: "10002",
  // 20000 — Generic context error (catch-all for envelope problems).
  CONTEXT_GENERIC: "20000",
  // 20001 — Invalid signature on the Authorization header.
  INVALID_SIGNATURE: "20001",
  // 20002 — Invalid keyId / signer (unique_key_id not in registry).
  INVALID_KEY: "20002",
  // 20003 — Stale request: context.timestamp outside the acceptable window
  // (clock-skew or absurdly far in past/future).
  STALE_TIMESTAMP: "20003",
  // 20006 — Domain not supported (context.domain mismatch).
  INVALID_DOMAIN: "20006",
  // 30016 — Invalid / expired TTL: context.timestamp + context.ttl has elapsed,
  // or context.ttl is not a valid ISO-8601 duration.
  INVALID_TTL: "30016",
  // 30022 — Duplicate message: same message_id replayed inside the idempotency
  // window. Reserved for the Tier B replay-rejection work.
  DUPLICATE_MESSAGE: "30022",
  // 31002 — BAP/BPP identity mismatch: bap_id/bap_uri don't echo us, or signer
  // ≠ context.bpp_id.
  IDENTITY_MISMATCH: "31002",
  // Generic server / core fault — used when persistence fails.
  CORE_ERROR: "90001",
} as const;

export type OndcErrorCode = (typeof ONDC_ERROR)[keyof typeof ONDC_ERROR];

// ---------------------------------------------------------------------------
// Constructors — keep nack() call sites short and consistent.
// ---------------------------------------------------------------------------

// A CONTEXT-ERROR with an explicit code. Most envelope-level failures use this.
export function contextError(
  code: OndcErrorCode,
  message: string,
  path?: string
): OndcError {
  return { type: "CONTEXT-ERROR", code, message, ...(path ? { path } : {}) };
}

// A CORE-ERROR (server fault — config missing, persistence failed, etc.).
export function coreError(message: string): OndcError {
  return {
    type: "CORE-ERROR",
    code: ONDC_ERROR.CORE_ERROR,
    message,
  };
}

// A JSON-SCHEMA-ERROR — body failed structural validation.
export function schemaError(message: string, path?: string): OndcError {
  return {
    type: "JSON-SCHEMA-ERROR",
    code: ONDC_ERROR.JSON_SCHEMA,
    message,
    ...(path ? { path } : {}),
  };
}

// Map a context-freshness validation failure (from validateContextFreshness)
// to the appropriate ONDC error payload. Kept here so call sites stay short:
//
//   const fresh = validateContextFreshness(payload.context);
//   if (!fresh.ok) return nack(400, freshnessError(fresh.failure));
//
// Missing/invalid timestamp + skew → STALE_TIMESTAMP (20003).
// Missing/invalid ttl + expired ttl → INVALID_TTL (30016).
export function freshnessError(failure: ContextFreshnessFailure): OndcError {
  switch (failure.kind) {
    case "missing_timestamp":
      return contextError(
        ONDC_ERROR.STALE_TIMESTAMP,
        "missing context.timestamp",
        "context.timestamp"
      );
    case "invalid_timestamp":
      return contextError(
        ONDC_ERROR.STALE_TIMESTAMP,
        `invalid context.timestamp "${failure.got}"`,
        "context.timestamp"
      );
    case "timestamp_skew":
      return contextError(
        ONDC_ERROR.STALE_TIMESTAMP,
        `context.timestamp out of acceptable range (drift ${failure.driftSeconds}s)`,
        "context.timestamp"
      );
    case "missing_ttl":
      return contextError(
        ONDC_ERROR.INVALID_TTL,
        "missing context.ttl",
        "context.ttl"
      );
    case "invalid_ttl":
      return contextError(
        ONDC_ERROR.INVALID_TTL,
        `invalid context.ttl "${failure.got}"`,
        "context.ttl"
      );
    case "expired_ttl":
      return contextError(
        ONDC_ERROR.INVALID_TTL,
        `context.ttl expired ${failure.expiredAgoSeconds}s ago`,
        "context.ttl"
      );
  }
}
