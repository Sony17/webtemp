// ONDC transport layer — the one place a BAP action becomes a signed HTTP call.
//
// Every BAP-initiated ONDC action (search/select/init/confirm/status/…) is the
// same wire shape: POST a JSON `{ context, message }` body to a target URL with
// an `Authorization` header proving who sent it, then read back a tiny
// synchronous ACK/NACK (the real payload arrives later on the BAP's callback
// URL). This module captures that shape once so callers only supply what
// differs — the URL, the context envelope, and the message — and never re-
// implement serialize → sign → fetch → parse.
//
// It composes the lower layers and adds nothing protocol-specific of its own:
//   context.ts  → the `context` envelope (snake_case, ready to serialize)
//   auth.ts     → signRequest(rawBody) → Authorization header over the body
//   config.ts   → identity + signing keys (read indirectly, via signRequest)
//
// signRequest reads private key material from getOndcConfig(), so anything that
// calls it transitively touches secrets. `import "server-only"` turns an
// accidental client import into a build error, mirroring config/context/auth.
import "server-only";
import { signRequest } from "@/lib/ondc/auth";
import type { OndcAction, OndcContext } from "@/lib/ondc/context";

// A transport-level failure: timeout, network error, a non-JSON response, or a
// response we can't read an ACK/NACK out of. Mirrors the named-error pattern in
// config.ts/auth.ts so callers can tell transport faults apart from signing
// (OndcAuthError) and configuration (OndcConfigError) faults.
//
// A protocol NACK is NOT one of these — it's a valid outcome returned as data
// (see OndcResponse). This is thrown only when the exchange itself failed.
export class OndcClientError extends Error {
  // The action being sent, for log/error correlation.
  readonly action?: OndcAction;
  // HTTP status, when the failure happened after a response was received.
  readonly httpStatus?: number;
  // True when the request was aborted by our own timeout (vs. a network error
  // or caller cancellation), so callers can retry timeouts specifically.
  readonly timeout: boolean;
  // The raw (text or parsed) response body, when we got one but couldn't use
  // it — invaluable when a gateway returns an HTML error page or odd JSON.
  readonly responseBody?: unknown;
  // DEBUG (temporary): response headers when we got a response but couldn't use
  // it. Lets us see Workbench's 428 reason headers. Safe to remove.
  readonly responseHeaders?: Record<string, string>;

  constructor(
    message: string,
    options: {
      action?: OndcAction;
      httpStatus?: number;
      timeout?: boolean;
      responseBody?: unknown;
      responseHeaders?: Record<string, string>;
      cause?: unknown;
    } = {}
  ) {
    super(`ONDC transport error: ${message}`, { cause: options.cause });
    this.name = "OndcClientError";
    this.action = options.action;
    this.httpStatus = options.httpStatus;
    this.timeout = options.timeout ?? false;
    this.responseBody = options.responseBody;
    this.responseHeaders = options.responseHeaders;
  }
}

// ---------------------------------------------------------------------------
// Wire + result types
// ---------------------------------------------------------------------------

export type OndcAckStatus = "ACK" | "NACK";

// ONDC's synchronous error block, present on a NACK (and sometimes alongside an
// ACK as a warning). All fields are optional — networks are inconsistent about
// which they populate, so we never assume a shape beyond "object with strings".
export type OndcError = {
  type?: string; // e.g. "CONTEXT-ERROR", "DOMAIN-ERROR"
  code?: string; // ONDC error code, e.g. "30001"
  path?: string; // JSON path of the offending field, when given
  message?: string;
};

// The exact synchronous body ONDC returns to a BAP request, in its snake_case
// wire shape. Everything is optional because a malformed/empty body is exactly
// the case we must detect rather than crash on.
export type OndcAckResponse = {
  message?: { ack?: { status?: OndcAckStatus } };
  error?: OndcError;
};

// What sendOndcRequest resolves to on a completed exchange (ACK *or* NACK).
// Discriminated on `status` so callers get a type-safe NACK branch:
//   const res = await sendOndcRequest(...);
//   if (res.status === "NACK") handle(res.error);
export type OndcResponse = {
  status: OndcAckStatus;
  httpStatus: number;
  // The parsed ACK/NACK body, for callers that want the raw envelope.
  body: OndcAckResponse;
  // Present on a NACK (and surfaced verbatim from the body when ONDC sends it).
  error?: OndcError;
  // The signature freshness window actually used, for logging / debugging.
  created: number;
  expires: number;
};

// ---------------------------------------------------------------------------
// Structured logging hooks
// ---------------------------------------------------------------------------

// Logged at send time. Deliberately carries byte counts and ids only — NEVER
// the Authorization header or body content — consistent with config.ts's
// redaction discipline around key material.
export type OndcRequestLog = {
  action: OndcAction;
  url: string;
  transactionId: string;
  messageId: string;
  bodyBytes: number;
  created: number;
  expires: number;
};

// Logged after a completed exchange (ACK or NACK both count as success here —
// the HTTP round-trip worked).
export type OndcResponseLog = {
  action: OndcAction;
  url: string;
  transactionId: string;
  messageId: string;
  httpStatus: number;
  status: OndcAckStatus;
  durationMs: number;
};

// Logged when the exchange itself failed (the OndcClientError about to throw).
export type OndcErrorLog = {
  action: OndcAction;
  url: string;
  transactionId: string;
  messageId: string;
  durationMs: number;
  error: OndcClientError;
};

// All hooks optional; a partial logger is fine. Hooks must not throw — they run
// inside the request path and a throwing logger would mask the real outcome
// (we still guard with safeLog defensively).
export type OndcLogger = {
  onRequest?(log: OndcRequestLog): void;
  onResponse?(log: OndcResponseLog): void;
  onError?(log: OndcErrorLog): void;
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

// Default request timeout. ONDC ttls are short (PT30S-ish); 30s is a safe upper
// bound for the synchronous ACK, which networks return near-immediately.
export const DEFAULT_TIMEOUT_MS = 30_000;

export type SendOndcRequestParams<TMessage = unknown> = {
  // Full target URL. The caller owns routing: the gateway's `/search` for a
  // broadcast search, or `${bpp_uri}/${action}` for a directed action. The
  // transport stays dumb about it (context.ts already encodes the distinction).
  url: string;

  // The action, used for log correlation and validated against context.action.
  // Passing it explicitly keeps the call site self-documenting and catches a
  // context built for the wrong action before it goes on the wire.
  action: OndcAction;

  // The context envelope from buildContext().
  context: OndcContext;

  // The action-specific message payload (e.g. `{ intent: {...} }` for search).
  message: TMessage;

  // Per-request overrides.
  timeoutMs?: number; // defaults to DEFAULT_TIMEOUT_MS
  ttl?: string; // ISO-8601 duration forwarded to signRequest; defaults to config.ttl
  signal?: AbortSignal; // caller cancellation, combined with the timeout
  sendDigestHeader?: boolean; // also send the `Digest` header (verifiers recompute it)
  logger?: OndcLogger;
};

// ---------------------------------------------------------------------------
// Pure helpers — no clock, no I/O, no key material.
// ---------------------------------------------------------------------------

// Pull the ACK/NACK status out of a parsed body, returning null when the
// envelope is missing/garbled so the caller can raise a precise transport
// error rather than guessing.
export function extractAckStatus(body: unknown): OndcAckStatus | null {
  const status = (body as OndcAckResponse | null)?.message?.ack?.status;
  return status === "ACK" || status === "NACK" ? status : null;
}

// Best-effort logging — a throwing hook must never change the request outcome.
function safeLog(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // Swallowed on purpose: logging is a side channel, not part of the contract.
  }
}

// ---------------------------------------------------------------------------
// High-level entry point — serialize once → sign → fetch → parse ACK/NACK.
// ---------------------------------------------------------------------------

// Send one signed ONDC request and return its synchronous ACK/NACK.
//
// Resolves with an OndcResponse for any completed exchange — including a NACK,
// which is a protocol outcome, not an error. Throws OndcClientError only when
// the exchange itself fails: timeout, network error, non-JSON body, or a
// response with no readable ACK/NACK.
export async function sendOndcRequest<TMessage = unknown>(
  params: SendOndcRequestParams<TMessage>
): Promise<OndcResponse> {
  const {
    url,
    action,
    context,
    message,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ttl,
    signal,
    sendDigestHeader = false,
    logger,
  } = params;

  // A context built for a different action would route/serialize wrong; fail
  // fast and loudly before signing or sending.
  if (context.action !== action) {
    throw new OndcClientError(
      `action "${action}" does not match context.action "${context.action}".`,
      { action }
    );
  }

  // Serialize EXACTLY ONCE. This same string is signed and sent — re-
  // serializing would change the bytes and break the receiver's digest check
  // (see auth.ts). Everything downstream operates on `rawBody`.
  const rawBody = JSON.stringify({ context, message });

  // Sign the body. Surface signing faults (OndcAuthError) untouched — they are
  // a distinct, already-named failure class; we only wrap transport faults.
  const signed = signRequest(rawBody, ttl ? { ttl } : {});

  const transactionId = context.transaction_id;
  const messageId = context.message_id;

  safeLog(() =>
    logger?.onRequest?.({
      action,
      url,
      transactionId,
      messageId,
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
      created: signed.created,
      expires: signed.expires,
    })
  );

  // Timeout via our own controller so we can tell a timeout apart from a
  // caller cancellation and from a network error. `timedOut` is flipped before
  // we abort, so the catch block can read it.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Combine an optional caller signal: if it aborts, we abort too. If it's
  // already aborted, abort immediately.
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: signed.authorization,
    };
    // Optional belt-and-suspenders: ONDC verifiers recompute the digest, so
    // this is informational, but some intermediaries log/inspect it.
    if (sendDigestHeader) headers.Digest = signed.digest;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });

    // Read the body as text first so a non-JSON error page (gateway 502s love
    // returning HTML) surfaces as a clear transport error with the body
    // attached, instead of an opaque JSON.parse stack.
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new OndcClientError(
        `response was not valid JSON (HTTP ${res.status}).`,
        {
          action,
          httpStatus: res.status,
          responseBody: text,
          // DEBUG (temporary): capture headers so we can read Workbench's 428
          // rejection reason. Safe to remove.
          responseHeaders: Object.fromEntries(res.headers.entries()),
        }
      );
    }

    const status = extractAckStatus(parsed);
    if (!status) {
      // No readable ACK/NACK. If the HTTP layer also failed, lead with that.
      const detail = res.ok
        ? "response had no message.ack.status (ACK/NACK)."
        : `request failed with HTTP ${res.status} and no ACK/NACK.`;
      throw new OndcClientError(detail, {
        action,
        httpStatus: res.status,
        responseBody: parsed,
      });
    }

    const body = parsed as OndcAckResponse;
    const response: OndcResponse = {
      status,
      httpStatus: res.status,
      body,
      error: body.error,
      created: signed.created,
      expires: signed.expires,
    };

    safeLog(() =>
      logger?.onResponse?.({
        action,
        url,
        transactionId,
        messageId,
        httpStatus: res.status,
        status,
        durationMs: Date.now() - startedAt,
      })
    );

    return response;
  } catch (err) {
    // Normalize everything thrown here into an OndcClientError so callers have
    // one transport failure type to catch. An OndcClientError we threw above
    // passes through unchanged (it already has the right context).
    let clientError: OndcClientError;
    if (err instanceof OndcClientError) {
      clientError = err;
    } else if (isAbortError(err)) {
      clientError = timedOut
        ? new OndcClientError(`request timed out after ${timeoutMs}ms.`, {
            action,
            timeout: true,
            cause: err,
          })
        : new OndcClientError("request was cancelled.", { action, cause: err });
    } else {
      const msg = err instanceof Error ? err.message : "unknown network error";
      clientError = new OndcClientError(msg, { action, cause: err });
    }

    safeLog(() =>
      logger?.onError?.({
        action,
        url,
        transactionId,
        messageId,
        durationMs: Date.now() - startedAt,
        error: clientError,
      })
    );

    throw clientError;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onCallerAbort);
  }
}

// fetch surfaces aborts as a DOMException named "AbortError" (and, on some
// runtimes, an Error with that name). Match by name to stay runtime-agnostic.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
