// ONDC Retail BAP context builder.
//
// Every ONDC/Beckn request carries a `context` envelope that routes and
// correlates the message. This module produces that envelope in ONDC's
// snake_case wire format, ready to `JSON.stringify` straight into a request
// body. Network identity (domain, city, bap_id, …) comes from getOndcConfig();
// this builder only adds the per-call / per-flow fields.
//
// Reads ONDC config (which reads private keys), so it stays server-only.
import "server-only";
import { randomUUID } from "node:crypto";
import { getOndcConfig } from "@/lib/ondc/config";

// BAP-initiated actions across the full Retail order lifecycle. The discovery
// + ordering core (search, select, init, confirm, status) plus the
// post-order/fulfilment actions, so future endpoints reuse this file as-is.
export type OndcAction =
  | "search"
  | "select"
  | "init"
  | "confirm"
  | "status"
  | "track"
  | "cancel"
  | "update"
  | "rating"
  | "support";

// The context envelope, in the exact snake_case shape ONDC expects on the wire.
// bpp_id/bpp_uri are optional: absent for `search` (gateway broadcast), present
// for every BPP-directed action thereafter.
export type OndcContext = {
  domain: string;
  country: string;
  city: string;
  action: OndcAction;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl: string;
};

// ONDC Retail protocol version. Pinned here (not in env) because it's a code
// concern, not a deployment one; override per-call via params.coreVersion when
// migrating versions. Bump when the network mandates a new version.
//
// TODO(ondc-versioning): this single pinned constant + flat country/city shape
// only supports the 1.2.x family. Before production rollout, refactor version
// handling into a VersionProfile strategy so 1.2.0 / 1.2.5 / 2.0.x can be
// switched without duplicating builder logic. See ./VERSIONING.md.
export const ONDC_CORE_VERSION = "1.2.5";

// `search` is the only BAP action that omits BPP routing (it's broadcast to the
// gateway). Everything else is directed at a specific BPP.
const GATEWAY_BROADCAST_ACTIONS = new Set<OndcAction>(["search"]);

export type BuildContextParams = {
  // Which ONDC action this envelope is for. Required.
  action: OndcAction;

  // Reuse across an order lifecycle. search→select→init→confirm→status all
  // share ONE transaction_id; pass it through here. A new one is minted when
  // omitted (i.e. when starting a fresh transaction with `search`).
  transactionId?: string;

  // Unique per request. Generated fresh unless provided — override only for
  // idempotent retries or deterministic tests.
  messageId?: string;

  // BPP routing. Required by ONDC for every action except `search`; obtained
  // from the on_search catalog (provider's bpp_id/bpp_uri).
  bppId?: string;
  bppUri?: string;

  // Overrides — default to getOndcConfig() values / now / pinned version.
  timestamp?: string; // RFC-3339 UTC; defaults to current time
  ttl?: string; // ISO-8601 duration; defaults to config.ttl
  coreVersion?: string; // defaults to ONDC_CORE_VERSION
  domain?: string; // defaults to config.domain
  city?: string; // defaults to config.cityCode
  country?: string; // defaults to config.countryCode
};

// A fresh transaction id — mint once at the start of a flow and thread it
// through every subsequent buildContext call via params.transactionId.
export function newTransactionId(): string {
  return randomUUID();
}

// A fresh message id — one per request. Exposed for callers that need the id
// before/after building the context (e.g. to key a response correlation map).
export function newMessageId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Inbound freshness validation — applied to every on_* callback we receive.
// ---------------------------------------------------------------------------
//
// ONDC requires the envelope itself (NOT just the HTTP signature window) to be
// fresh:
//   * context.timestamp must be within a small skew of wall-clock now
//   * context.timestamp + context.ttl must not be in the past
// Workbench probes both with timestamps shifted ±10 min and with TTLs of "PT1S"
// followed by a delayed resend; expects a NACK with the matching error code.
//
// Pure: no I/O, no config — caller injects `now` for deterministic tests. The
// auth/signature freshness check in auth.ts covers the HTTP signing string;
// this covers the Beckn envelope. The two are independent.

// How far context.timestamp may drift from wall-clock now, in either direction,
// before we reject it as stale/future. ONDC RET preprod commonly tolerates ~5
// minutes; 5 min here matches their public guidance. Tweak if a counterparty's
// clock drift trips this in practice.
const DEFAULT_CONTEXT_SKEW_SECONDS = 5 * 60;

// Parse an ISO-8601 duration (e.g. "PT30S", "PT5M", "P1D") into seconds. We
// intentionally only support the day/hour/minute/second forms ONDC uses; weeks/
// months/years are rejected (their length is calendar-dependent). Returns null
// on malformed input so the caller can NACK with INVALID_TTL.
function parseIsoDurationSeconds(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    iso.trim()
  );
  if (!m) return null;
  const [, d, h, mi, s] = m;
  if (!d && !h && !mi && !s) return null;
  const days = d ? Number(d) : 0;
  const hours = h ? Number(h) : 0;
  const minutes = mi ? Number(mi) : 0;
  const seconds = s ? Number(s) : 0;
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

export type ContextFreshnessFailure =
  | { kind: "missing_timestamp" }
  | { kind: "invalid_timestamp"; got: string }
  | { kind: "missing_ttl" }
  | { kind: "invalid_ttl"; got: string }
  | { kind: "timestamp_skew"; driftSeconds: number }
  | { kind: "expired_ttl"; expiredAgoSeconds: number };

export type ContextFreshnessResult =
  | { ok: true }
  | { ok: false; failure: ContextFreshnessFailure };

// Validate that an inbound context's timestamp + ttl are fresh. Tolerates a
// small clock skew in either direction (DEFAULT_CONTEXT_SKEW_SECONDS) for honest
// drift. Returns a structured failure the route maps to a NACK code.
export function validateContextFreshness(
  ctx: { timestamp?: string; ttl?: string } | undefined | null,
  options: { now?: number; skewSeconds?: number } = {}
): ContextFreshnessResult {
  const skew = options.skewSeconds ?? DEFAULT_CONTEXT_SKEW_SECONDS;
  const nowMs = options.now ?? Date.now();

  const tsRaw = ctx?.timestamp;
  if (typeof tsRaw !== "string" || tsRaw.trim().length === 0) {
    return { ok: false, failure: { kind: "missing_timestamp" } };
  }
  const tsMs = Date.parse(tsRaw);
  if (!Number.isFinite(tsMs)) {
    return { ok: false, failure: { kind: "invalid_timestamp", got: tsRaw } };
  }

  const driftMs = nowMs - tsMs;
  const driftSeconds = Math.round(driftMs / 1000);
  if (Math.abs(driftMs) > skew * 1000) {
    return { ok: false, failure: { kind: "timestamp_skew", driftSeconds } };
  }

  // ttl is OPTIONAL on inbound callbacks. Several real-network BPPs (incl.
  // Workbench's `ushopmicro-stage.hulcd.com`) omit `context.ttl` on
  // `on_search`. We still validate it when present (invalid format and
  // already-expired both NACK), but treat absence as "no expiration declared"
  // rather than refusing the callback. The timestamp skew check above and the
  // HTTP-signature freshness check in auth.ts cover liveness regardless.
  const ttlRaw = ctx?.ttl;
  if (typeof ttlRaw === "string" && ttlRaw.trim().length > 0) {
    const ttlSeconds = parseIsoDurationSeconds(ttlRaw);
    if (ttlSeconds === null) {
      return { ok: false, failure: { kind: "invalid_ttl", got: ttlRaw } };
    }

    const expiresAtMs = tsMs + ttlSeconds * 1000;
    const expiredAgoMs = nowMs - expiresAtMs;
    if (expiredAgoMs > skew * 1000) {
      return {
        ok: false,
        failure: {
          kind: "expired_ttl",
          expiredAgoSeconds: Math.round(expiredAgoMs / 1000),
        },
      };
    }
  }

  return { ok: true };
}

// Build an ONDC-compliant context envelope for the given action.
export function buildContext(params: BuildContextParams): OndcContext {
  const config = getOndcConfig();
  const { action } = params;

  // Both BPP fields must travel together — one without the other is always a
  // routing bug (the message would reach the wrong place or be rejected).
  if (Boolean(params.bppId) !== Boolean(params.bppUri)) {
    throw new Error(
      `buildContext("${action}"): bppId and bppUri must be provided together.`
    );
  }

  const context: OndcContext = {
    domain: params.domain ?? config.domain,
    country: params.country ?? config.countryCode,
    city: params.city ?? config.cityCode,
    action,
    core_version: params.coreVersion ?? ONDC_CORE_VERSION,
    bap_id: config.bapId,
    bap_uri: config.bapUri,
    transaction_id: params.transactionId ?? newTransactionId(),
    message_id: params.messageId ?? newMessageId(),
    timestamp: params.timestamp ?? new Date().toISOString(),
    ttl: params.ttl ?? config.ttl,
  };

  // Attach BPP routing for directed actions only. For `search` it's omitted so
  // the gateway broadcasts to the network.
  if (!GATEWAY_BROADCAST_ACTIONS.has(action) && params.bppId && params.bppUri) {
    context.bpp_id = params.bppId;
    context.bpp_uri = params.bppUri;
  }

  return context;
}
