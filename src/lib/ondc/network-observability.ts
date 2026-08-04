// ONDC Network Observability (NO) — transaction-log forwarding.
//
// ONDC's Network Observability & Open Data Framework requires every Network
// Participant to forward a copy of its transaction logs (the API calls it sends
// and the callbacks it receives, with Personal Data scrubbed) to an ONDC-run
// log collector. This module is the single seam that does that forwarding.
//
// It plugs into the TWO points every ONDC exchange already funnels through:
//   - inbound  on_* callbacks → forwardInboundCallbackLog(), called from
//     responses.ts right where finalizeAuditTrace() already fires.
//   - outbound BAP requests  → forwardOutboundExchangeLog(), called from
//     client.ts right after a completed (or failed) exchange.
// Neither call site changes behavior when NO is unconfigured — both are pure
// no-ops until ONDC_OBSERVABILITY_URL + ONDC_OBSERVABILITY_TOKEN are set.
//
// Design mirrors audit.ts: fire-and-forget, never on the hot path, never able to
// NACK a real callback. A submission failure is counted and logged, never thrown.
//
// ── Token & environment ────────────────────────────────────────────────────
// The token authenticates THIS participant to the collector. It is generated
// from the ONDC Network Observability portal and is PER-ENVIRONMENT: the token
// you generate for pre-prod is NOT the one you use in prod (the prod token comes
// from the registry "update participant info" step after you subscribe to prod).
// Because the token is per-environment, all NO vars resolve through
// readOndcScopedEnv(): ONDC_PREPROD_NO_TOKEN and ONDC_PROD_NO_TOKEN (likewise
// _NO_ENDPOINT) can both be set, and ONDC_ENV picks which one is live. The
// unscoped names (ONDC_NO_TOKEN / ONDC_OBSERVABILITY_TOKEN) remain as
// fallbacks for single-environment deployments.
//
// ── Endpoint & payload schema ──────────────────────────────────────────────
// The collector is ONDC's analytics ingest (pre-prod):
//   POST https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs
//   Authorization: Bearer <NO token>
//   body: { type: "<action>", data: <PII-scrubbed raw ONDC payload> }
// Each API Call yields TWO events — "<action>" (the request) and
// "<action>_response" (the synchronous ACK/NACK) — per §3 of the NO
// notification. URL + token are CONFIGURABLE via ONDC_OBSERVABILITY_URL/TOKEN
// (or ONDC's own ONDC_NO_ENDPOINT / ONDC_NO_TOKEN aliases); the wire shape lives
// in buildObservabilityEvents() below.
//
// Server-only (reads secrets via getOndcPublicContext + touches process.env).
import "server-only";
import { after } from "next/server";
import type { AuditTrace } from "@/lib/ondc/audit";
import { getOndcPublicContext, readOndcScopedEnv } from "@/lib/ondc/config";

// ---------------------------------------------------------------------------
// Config — read lazily from env, resilient, feature-flagged OFF by default.
// ---------------------------------------------------------------------------

export type ObservabilityConfig = {
  // Collector ingestion endpoint (per-environment; no safe default exists, so
  // the operator MUST set it — the feature stays off until they do).
  url: string;
  // The generated NO token for THIS environment (secret).
  token: string;
  // Header the token rides in. Defaults to "Authorization". Some collectors use
  // a bespoke header name — override via ONDC_OBSERVABILITY_AUTH_HEADER.
  authHeader: string;
  // Scheme prefix prepended to the token in the header value, e.g. "Bearer ".
  // Set ONDC_OBSERVABILITY_AUTH_SCHEME="" to send the raw token with no prefix.
  authScheme: string;
  // Per-request timeout for the (fire-and-forget) submission.
  timeoutMs: number;
  // Non-secret identity/context stamped onto every forwarded log.
  subscriberId: string;
  environment: string;
};

function envTrim(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

// Returns the config only when NO is fully enabled, else null (→ every forward
// becomes a no-op). Enabled means: a URL and a token are both present, and the
// operator has not flipped the ONDC_OBSERVABILITY_ENABLED="0" kill switch.
//
// Read fresh every call (not memoized) so the kill switch and token rotation
// take effect without a restart, and so tests can flip env between cases. The
// env reads are trivial; this is never in a tight loop.
export function getObservabilityConfig(): ObservabilityConfig | null {
  if (readOndcScopedEnv("ONDC_OBSERVABILITY_ENABLED") === "0") return null;

  // Accept ONDC's own env names (ONDC_NO_ENDPOINT / ONDC_NO_TOKEN — the names
  // the NO portal documents) as aliases, falling back to our OBSERVABILITY_*.
  // Each resolves ONDC_ENV-scoped first (ONDC_PROD_NO_TOKEN, …).
  const url =
    readOndcScopedEnv("ONDC_OBSERVABILITY_URL") ??
    readOndcScopedEnv("ONDC_NO_ENDPOINT");
  const token =
    readOndcScopedEnv("ONDC_OBSERVABILITY_TOKEN") ??
    readOndcScopedEnv("ONDC_NO_TOKEN");
  // Both are required — a URL with no token (or vice versa) is a half-configured
  // state we treat as "off" rather than submitting unauthenticated logs.
  if (!url || !token) return null;

  // subscriber_id + environment are metadata for the payload. They come from the
  // core ONDC config, which throws when ONDC isn't configured — but if ONDC
  // isn't configured there are no transactions to forward, so treat that as off.
  let subscriberId = "";
  let environment = "";
  try {
    const ctx = getOndcPublicContext();
    subscriberId = ctx.subscriberId;
    environment = ctx.env;
  } catch {
    return null;
  }

  const timeoutRaw = Number.parseInt(
    process.env.ONDC_OBSERVABILITY_TIMEOUT_MS ?? "",
    10
  );

  return {
    url,
    token,
    authHeader: envTrim("ONDC_OBSERVABILITY_AUTH_HEADER") ?? "Authorization",
    // Default to the RFC-6750 Bearer scheme. An explicitly empty env value means
    // "no prefix" (send the token verbatim); an unset value means the default.
    authScheme:
      process.env.ONDC_OBSERVABILITY_AUTH_SCHEME === undefined
        ? "Bearer "
        : process.env.ONDC_OBSERVABILITY_AUTH_SCHEME,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10_000,
    subscriberId,
    environment,
  };
}

// True when NO forwarding is live. Cheap boolean for status surfaces.
export function isObservabilityEnabled(): boolean {
  return getObservabilityConfig() !== null;
}

// ---------------------------------------------------------------------------
// Personal-data scrubbing (Open Data Framework).
// ---------------------------------------------------------------------------
//
// The framework requires Personal Data be removed BEFORE a log leaves the
// participant. We walk the payload and redact known personal fields in place,
// preserving structure (so the log still validates) rather than deleting keys.
//
// Only LEAF fields carrying personal data are listed — container objects
// (billing, contact, person, address) are traversed so their personal leaves
// are caught wherever they nest. This set is deliberately conservative and is
// meant to be reviewed against the current Open Data Framework; extend it there.
const PERSONAL_LEAF_KEYS = new Set<string>([
  // NOTE: "name" is intentionally NOT here. A bare `name` is usually a
  // descriptor (provider / item) name, which the Open Data Framework needs for
  // its Seller-Growth / SKU-Growth metrics — redacting it everywhere would
  // corrupt the log. Person names are redacted contextually, keyed on their
  // parent object; see PERSON_NAME_PARENTS + scrubPersonalData below.
  "email",
  "phone",
  "phone_number",
  "mobile",
  "telephone",
  // Precise address components (area_code / city / state are kept — they are
  // coarse location, not identifying, and the collector keys on them).
  "building",
  "door",
  "street",
  "locality",
  "ward",
  "po_box",
  // Financial / government identifiers.
  "aadhaar",
  "aadhar",
  "pan",
  "upi_id",
  "vpa",
  "account_number",
  "bank_account_number",
]);

// `name` is Personal Data only inside a person / address object. §5b of the NO
// notification names "names of persons" and "building name" as PD, while a
// provider / item `descriptor.name` is not. So a `name` leaf is redacted only
// when its immediate parent key is one of these; anywhere else it passes through.
const PERSON_NAME_PARENTS = new Set<string>([
  "billing",
  "person",
  "contact",
  "customer",
  "address", // address.name carries the building name, which §5b treats as PD
]);

const REDACTED = "[REDACTED]";

// gps is masked (not fully redacted): the collector may need coarse geography,
// and a truncated coordinate de-identifies while staying schema-valid. ~2
// decimals ≈ 1 km. Applied only to the "gps" key.
function maskGps(value: unknown): unknown {
  if (typeof value !== "string") return REDACTED;
  const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return REDACTED;
  const trunc = (n: string) => {
    const f = Number.parseFloat(n);
    return Number.isFinite(f) ? f.toFixed(2) : n;
  };
  return `${trunc(m[1])},${trunc(m[2])}`;
}

// Recursively copy `value`, redacting personal leaves. Pure — never mutates the
// input. Non-objects pass through untouched. `parentKey` is the key that held
// `value`; it lets a `name` leaf be judged in context — a person name (redact)
// vs a descriptor name (keep). See PERSON_NAME_PARENTS.
export function scrubPersonalData(value: unknown, parentKey?: string): unknown {
  // Array elements inherit the array's own parent key, so items[].descriptor
  // and fulfillments[].person are judged by "items"/"fulfillments" as expected.
  if (Array.isArray(value))
    return value.map((v) => scrubPersonalData(v, parentKey));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (lower === "gps") out[key] = maskGps(v);
      else if (PERSONAL_LEAF_KEYS.has(lower)) out[key] = REDACTED;
      else if (lower === "name")
        out[key] = PERSON_NAME_PARENTS.has((parentKey ?? "").toLowerCase())
          ? REDACTED
          : scrubPersonalData(v, lower);
      else out[key] = scrubPersonalData(v, lower);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Payload envelope.
// ---------------------------------------------------------------------------

export type ObservabilityDirection = "inbound" | "outbound";

// The normalized record a forward site hands us. requestBody is the EXACT bytes
// on the wire (so parse is best-effort); responseBody is already an object.
export type ObservabilityRecord = {
  direction: ObservabilityDirection;
  action: string;
  transactionId?: string;
  messageId?: string;
  bppId?: string;
  // Outbound only: the URL we POSTed to.
  targetUrl?: string;
  requestBody: string;
  responseBody: unknown;
  httpStatus?: number;
  ackStatus?: "ACK" | "NACK";
  recordedAt: string; // ISO-8601
};

function tryParseJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Keep the raw string when it isn't JSON — a malformed body is itself a
    // useful observability signal, and dropping it would hide it.
    return raw;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// One event as the ONDC log collector expects it:
//   POST /v1/api/push-txn-logs  { type: "<action>", data: <scrubbed payload> }
// `type` is the ONDC action; `data` is the RAW ONDC payload (context + message
// for a request; the ACK/NACK envelope for a response), with Personal Data
// scrubbed. ONDC identifies the participant from the Bearer token, so no
// subscriber_id / metadata rides on the wire — it lives inside `data.context`.
export type ObservabilityEvent = { type: string; data: unknown };

// An ONDC "API Call" is the request AND its synchronous response (§3 of the NO
// notification), submitted as two events: "<action>" and "<action>_response".
// The response event is omitted when nothing was captured (e.g. a transport
// failure that never produced a body).
export function buildObservabilityEvents(
  record: ObservabilityRecord
): ObservabilityEvent[] {
  const requestData = scrubPersonalData(tryParseJson(record.requestBody));
  const events: ObservabilityEvent[] = [
    { type: record.action, data: requestData },
  ];

  if (record.responseBody !== undefined && record.responseBody !== null) {
    // The NO schema requires data.context (with the BASE action, not
    // "<action>_response") on the response event too — but ONDC ACK/NACK bodies
    // carry no context. So lift the request's context and pair it with the
    // response's message (+ error on a NACK), matching the "<action>_response"
    // examples in the NO spec.
    const reqContext = isRecord(requestData) ? requestData.context : undefined;
    const resp = scrubPersonalData(record.responseBody);
    const respObj = isRecord(resp) ? resp : {};
    events.push({
      type: `${record.action}_response`,
      data: {
        ...(reqContext !== undefined ? { context: reqContext } : {}),
        message:
          respObj.message ?? { ack: { status: respObj.error ? "NACK" : "ACK" } },
        ...(respObj.error !== undefined ? { error: respObj.error } : {}),
      },
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Submission + stats.
// ---------------------------------------------------------------------------

export type ObservabilityStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __ondcObservability__: ObservabilityStats | undefined;
}

function stats(): ObservabilityStats {
  if (!globalThis.__ondcObservability__) {
    globalThis.__ondcObservability__ = { attempted: 0, succeeded: 0, failed: 0 };
  }
  return globalThis.__ondcObservability__;
}

// Read-only snapshot for the status endpoint.
export function getObservabilityStats(): ObservabilityStats {
  return { ...stats() };
}

const MAX_ATTEMPTS = 3;

// POST one payload to the collector, with a bounded timeout and a couple of
// retries on transport/5xx failure. Resolves true on success; on final failure
// it records + logs and resolves false (never throws — a NO failure must never
// disrupt a real ONDC exchange).
async function submit(
  cfg: ObservabilityConfig,
  payload: ObservabilityEvent
): Promise<boolean> {
  const s = stats();
  s.attempted += 1;
  const body = JSON.stringify(payload);

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [cfg.authHeader]: `${cfg.authScheme}${cfg.token}`,
        },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        s.succeeded += 1;
        s.lastSuccessAt = new Date().toISOString();
        return true;
      }
      // 4xx won't fix itself on retry (bad token / bad schema) — stop early.
      lastErr = `HTTP ${res.status}`;
      if (res.status < 500) break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  s.failed += 1;
  s.lastFailureAt = new Date().toISOString();
  s.lastError = lastErr;
  console.warn("ondc.observability submit failed", {
    type: payload.type,
    error: lastErr,
  });
  return false;
}

// Core entry point: forward one record, if NO is enabled. Returns immediately;
// the network call runs detached. Safe to call unconditionally from hot paths.
export function forwardObservabilityLog(record: ObservabilityRecord): void {
  const cfg = getObservabilityConfig();
  if (!cfg) return;
  // One API Call → a request event and (usually) a response event.
  for (const event of buildObservabilityEvents(record)) {
    scheduleSubmit(cfg, event);
  }
}

// On serverless (Vercel) a bare detached promise is frozen the moment the route
// handler returns its response, so a fire-and-forget POST never completes (we saw
// attempted++ but succeeded stay 0). `after()` runs the submit AFTER the response
// is sent but keeps the function alive (via waitUntil) until it resolves — so the
// log is actually delivered, without adding latency to the ONDC ACK. Outside a
// request scope (e.g. a script/build) `after()` throws; fall back to detached.
function scheduleSubmit(cfg: ObservabilityConfig, event: ObservabilityEvent): void {
  try {
    after(() => submit(cfg, event));
  } catch {
    void submit(cfg, event);
  }
}

// Awaitable single-record submission for manual / batch flows (the /forward POST
// replay). Unlike forwardObservabilityLog (fire-and-forget), this resolves once
// the collector has responded, so a batch caller can report real success/failure
// AND the submission isn't cut short when a serverless request returns.
export async function submitObservabilityLogNow(
  record: ObservabilityRecord
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const cfg = getObservabilityConfig();
  if (!cfg) return { ok: false, skipped: true, error: "not configured" };
  let ok = true;
  for (const event of buildObservabilityEvents(record)) {
    ok = (await submit(cfg, event)) && ok;
  }
  return ok ? { ok: true } : { ok: false, error: stats().lastError };
}

// ---------------------------------------------------------------------------
// Call-site adapters — keep the forwarding logic out of responses.ts/client.ts.
// ---------------------------------------------------------------------------

// Lift the ACK/NACK status off a response envelope for the metadata fields.
function ackStatusOf(body: unknown): "ACK" | "NACK" | undefined {
  const s = (body as { message?: { ack?: { status?: unknown } } } | null)
    ?.message?.ack?.status;
  return s === "ACK" || s === "NACK" ? s : undefined;
}

// Inbound: called from responses.ts alongside finalizeAuditTrace. We forward
// only FULLY-EXTRACTED callbacks — those carry both a transaction_id and a
// message_id (annotated after signature + structural validation). This filter
// naturally skips the pre-verification fast-ACK event and pre-parse error NACKs,
// so a single callback is forwarded exactly once (the verified pass).
export function forwardInboundCallbackLog(
  trace: AuditTrace,
  response: { status: number; body: unknown }
): void {
  if (!getObservabilityConfig()) return; // cheap early-out before any work
  if (!trace.transactionId || !trace.messageId) return;

  forwardObservabilityLog({
    direction: "inbound",
    action: trace.action,
    transactionId: trace.transactionId,
    messageId: trace.messageId,
    bppId: trace.bppId,
    requestBody: trace.rawBody,
    responseBody: response.body,
    httpStatus: response.status,
    ackStatus: ackStatusOf(response.body),
    recordedAt: new Date().toISOString(),
  });
}

// Outbound: called from client.ts after a completed exchange (ACK or NACK) OR a
// transport failure (responseBody carries whatever we managed to read).
export function forwardOutboundExchangeLog(args: {
  action: string;
  url: string;
  requestBody: string;
  transactionId?: string;
  messageId?: string;
  responseBody: unknown;
  httpStatus?: number;
}): void {
  if (!getObservabilityConfig()) return;

  forwardObservabilityLog({
    direction: "outbound",
    action: args.action,
    transactionId: args.transactionId,
    messageId: args.messageId,
    targetUrl: args.url,
    requestBody: args.requestBody,
    responseBody: args.responseBody,
    httpStatus: args.httpStatus,
    ackStatus: ackStatusOf(args.responseBody),
    recordedAt: new Date().toISOString(),
  });
}
