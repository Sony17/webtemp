// Tocxi Partner API — outbound transport layer (the "Tocxi SDK").
//
// Every call to Tocxi's /api/v1/partner/** surface is the same shape: a JSON
// request to `${baseUrl}/api/v1/partner/...` carrying an `X-API-Key` header, back
// a JSON response (or a typed error on non-2xx). This module captures that shape
// once in `tocxiFetch` so the public functions (quote / serviceability /
// createShipment / getShipment / listShipments / cancelShipment) only supply
// what differs — the path, method, body, and any extra headers.
//
// Cross-cutting concerns handled centrally in tocxiFetch:
//   * auth      — inject X-API-Key from getTocxiConfig() on every request
//   * errors    — non-2xx becomes a typed TocxiError carrying the HTTP status and
//                 the machine-readable Tocxi error code (INVALID_API_KEY, …)
//   * retry     — 429 and 5xx are retried (honoring Retry-After); 4xx are not
//   * timeout   — an AbortController bounds each attempt
//
// getTocxiConfig() reads the API key (a secret) from the environment, so this
// module must never run on the client. `import "server-only"` turns an
// accidental client import into a build error, mirroring the payments/ondc stacks.
import "server-only";
import { getTocxiConfig } from "@/lib/logistics/config";
import type {
  CreateShipmentRequest,
  QuoteRequest,
  QuoteResponse,
  ShipmentListResponse,
  ShipmentResponse,
  TocxiErrorCode,
} from "@/lib/logistics/types";

// A failed exchange with Tocxi: an auth rejection, a validation 4xx, a
// not-found, a rate-limit, or a transport fault (timeout / network / non-JSON).
// Mirrors the named-error pattern in ondc/client.ts (OndcClientError) so callers
// can branch on `code` (the machine string) and `httpStatus` rather than parsing
// a message. A retryable() helper marks the transient cases (429 / 5xx / timeout).
export class TocxiError extends Error {
  // The Tocxi machine code when the response carried one (INVALID_API_KEY,
  // PARTNER_SUSPENDED, RATE_LIMITED, …). Undefined for transport faults.
  readonly code?: TocxiErrorCode;
  // HTTP status, when the failure happened after a response was received.
  readonly httpStatus?: number;
  // True when the request was aborted by our own timeout (vs. a network error).
  readonly timeout: boolean;
  // The raw response body (parsed JSON or text) when we got one but it wasn't a
  // usable 2xx — invaluable when a gateway returns an HTML error page.
  readonly responseBody?: unknown;

  constructor(
    message: string,
    options: {
      code?: TocxiErrorCode;
      httpStatus?: number;
      timeout?: boolean;
      responseBody?: unknown;
      cause?: unknown;
    } = {}
  ) {
    super(`Tocxi API error: ${message}`, { cause: options.cause });
    this.name = "TocxiError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.timeout = options.timeout ?? false;
    this.responseBody = options.responseBody;
  }

  // Whether retrying this error stands a chance of succeeding: rate limits, any
  // 5xx, and our own timeouts. A 4xx other than 429 is a request the caller must
  // fix, so it is NOT retryable.
  retryable(): boolean {
    if (this.timeout) return true;
    if (this.httpStatus === 429) return true;
    return this.httpStatus !== undefined && this.httpStatus >= 500;
  }
}

// ---------------------------------------------------------------------------
// tocxiFetch — the single outbound call site.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES
const RETRY_BASE_DELAY_MS = 500;
// Cap the honored Retry-After so a hostile/broken header can't stall a request
// for minutes inside a serverless invocation.
const MAX_RETRY_AFTER_MS = 5_000;

type FetchOptions = {
  method: "GET" | "POST";
  path: string; // e.g. "/api/v1/partner/quote"
  body?: unknown;
  // Extra headers (e.g. Idempotency-Key on create). X-API-Key is always added.
  headers?: Record<string, string>;
  timeoutMs?: number;
};

// Parse a Retry-After header (delta-seconds only — Tocxi documents seconds) into
// milliseconds, clamped to [0, MAX_RETRY_AFTER_MS]. Returns null when absent or
// unparseable so the caller falls back to exponential backoff.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
}

function backoffMs(attempt: number): number {
  // attempt is 0-based: 500ms, 1000ms, …
  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Pull Tocxi's machine error code out of a parsed error body. Tocxi returns
// `{ "code": "INVALID_API_KEY", ... }` on the auth surface; we also accept an
// `error` field as a fallback. Returns undefined when nothing usable is present.
function extractErrorCode(body: unknown): TocxiErrorCode | undefined {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.code === "string") return rec.code;
    if (typeof rec.error === "string") return rec.error;
  }
  return undefined;
}

// Perform one HTTP attempt. Returns the parsed JSON on 2xx, throws TocxiError on
// anything else (so the retry loop above it decides whether to try again).
async function attempt<T>(opts: FetchOptions): Promise<T> {
  const { apiKey, baseUrl } = getTocxiConfig();
  if (!apiKey) {
    // Guard here too (routes gate on isTocxiConfigured, but the client may be
    // called from a job): a missing key can never succeed, so fail fast and
    // un-retryably rather than sending an unauthenticated request.
    throw new TocxiError("missing TOCXI_API_KEY", { code: "MISSING_API_KEY" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${opts.path}`, {
      method: opts.method,
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new TocxiError(aborted ? "request timed out" : "network error", {
      timeout: aborted,
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Read the body once, as text, then try JSON — so an HTML/text error page is
  // preserved on the error rather than throwing an opaque parse failure.
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const err = new TocxiError(
      `HTTP ${res.status} on ${opts.method} ${opts.path}`,
      {
        httpStatus: res.status,
        code: extractErrorCode(parsed),
        responseBody: parsed,
      }
    );
    // Stash the parsed Retry-After on the throw so the retry loop can honor it
    // without re-reading headers off a consumed response.
    (err as TocxiError & { retryAfterMs?: number | null }).retryAfterMs =
      parseRetryAfterMs(retryAfter);
    throw err;
  }

  return parsed as T;
}

// The public entry point: one attempt plus bounded retries for transient
// failures. Retries 429/5xx/timeout only — a 4xx (validation, auth, not-found)
// is surfaced immediately since retrying it is pointless.
async function tocxiFetch<T>(opts: FetchOptions): Promise<T> {
  let lastError: TocxiError | undefined;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await attempt<T>(opts);
    } catch (err) {
      if (!(err instanceof TocxiError)) throw err;
      lastError = err;
      // Un-retryable (4xx other than 429, or a missing-key guard) → give up now.
      if (!err.retryable()) throw err;
      // Out of attempts → surface the last error.
      if (i === MAX_RETRIES) throw err;
      const honored = (err as TocxiError & { retryAfterMs?: number | null })
        .retryAfterMs;
      await sleep(honored ?? backoffMs(i));
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the type.
  throw lastError ?? new TocxiError("exhausted retries");
}

// ---------------------------------------------------------------------------
// Public endpoints.
// ---------------------------------------------------------------------------

const PARTNER = "/api/v1/partner";

// Coverage check + price. `serviceability` and `quote` take the SAME body and
// return the SAME response; use serviceability as a boolean coverage gate and
// quote when you want to show the price. Both are POSTs.
export async function serviceability(
  input: QuoteRequest
): Promise<QuoteResponse> {
  return tocxiFetch<QuoteResponse>({
    method: "POST",
    path: `${PARTNER}/serviceability`,
    body: input,
  });
}

export async function quote(input: QuoteRequest): Promise<QuoteResponse> {
  return tocxiFetch<QuoteResponse>({
    method: "POST",
    path: `${PARTNER}/quote`,
    body: input,
  });
}

// Book a shipment. The `idempotencyKey` (the order id) is sent as the
// Idempotency-Key header so a retry with the same key returns the SAME shipment
// rather than double-booking — Tocxi keys the create on it. Falls back to
// partnerReference when a key isn't passed explicitly.
export async function createShipment(
  input: CreateShipmentRequest,
  idempotencyKey?: string
): Promise<ShipmentResponse> {
  const key = idempotencyKey ?? input.partnerReference;
  if (!key) {
    // Without an idempotency key a retry could double-book — refuse rather than
    // risk it. Callers always have an order id to pass.
    throw new TocxiError("createShipment requires an Idempotency-Key", {
      code: "MISSING_IDEMPOTENCY_KEY",
    });
  }
  return tocxiFetch<ShipmentResponse>({
    method: "POST",
    path: `${PARTNER}/shipments`,
    body: input,
    headers: { "Idempotency-Key": key },
  });
}

export async function getShipment(
  shipmentId: string
): Promise<ShipmentResponse> {
  return tocxiFetch<ShipmentResponse>({
    method: "GET",
    path: `${PARTNER}/shipments/${encodeURIComponent(shipmentId)}`,
  });
}

export async function listShipments(
  page = 0,
  size = 20
): Promise<ShipmentListResponse> {
  return tocxiFetch<ShipmentListResponse>({
    method: "GET",
    path: `${PARTNER}/shipments?page=${page}&size=${size}`,
  });
}

// Cancel a shipment — only valid BEFORE pickup. Tocxi returns the updated
// shipment (or an error if it's too late), which we surface to the caller.
export async function cancelShipment(
  shipmentId: string,
  reason: string
): Promise<ShipmentResponse> {
  return tocxiFetch<ShipmentResponse>({
    method: "POST",
    path: `${PARTNER}/shipments/${encodeURIComponent(shipmentId)}/cancel`,
    body: { reason },
  });
}

// Lightweight auth/health check — GET /me returns the partner account when the
// key is valid. Handy for a "is our key live?" probe.
export async function me(): Promise<unknown> {
  return tocxiFetch<unknown>({ method: "GET", path: `${PARTNER}/me` });
}
