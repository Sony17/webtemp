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
export const ONDC_CORE_VERSION = "1.2.0";

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
