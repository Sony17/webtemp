// Shared synchronous ACK/NACK response builders for inbound ONDC callbacks.
//
// Every `on_*` callback a BAP receives must answer with a synchronous Beckn
// envelope. ONDC's log validator (Workbench/Pramaan) expects that envelope to
// ECHO the inbound `context` object — a bare `{ message: { ack } }` is graded as
// "context missing in response". Each callback route previously rolled its own
// `ack()`/`nack()` that omitted context; these two builders centralise the wire
// shape so every route emits an identical, contract-correct response:
//
//   {
//     "context": { ...the inbound context, echoed verbatim... },
//     "message": { "ack": { "status": "ACK" | "NACK" } },
//     "error":   { ... }            // NACK only
//   }
//
// `context` is echoed as-is from the verified inbound payload. It is omitted only
// when we never got a parseable context (pre-parse auth/JSON failures) — there is
// nothing to echo there, and ONDC does not require context on those rejections.
//
// Touches audit (finalizeAuditTrace) which is server-only, so this stays
// server-only too.
import "server-only";
import { NextResponse } from "next/server";
import type { OndcError } from "@/lib/ondc/client";
import { finalizeAuditTrace, type AuditTrace } from "@/lib/ondc/audit";
import { forwardInboundCallbackLog } from "@/lib/ondc/network-observability";

// The callback response body. `context` is `unknown` because we echo whatever the
// (already signature-verified) sender sent, without re-shaping it. `extra` lets a
// route append diagnostic fields (e.g. on_search's temporary `debug_build`).
type CallbackResponseBody = {
  context?: unknown;
  message: { ack: { status: "ACK" | "NACK" } };
  error?: OndcError;
  [key: string]: unknown;
};

// Build an ACK (HTTP 200). Pass the inbound `context` to echo it; omit it for
// responses sent before a context could be parsed.
export function buildAck(opts?: {
  context?: unknown;
  trace?: AuditTrace;
  extra?: Record<string, unknown>;
}): NextResponse {
  const body: CallbackResponseBody = {
    ...(opts?.context ? { context: opts.context } : {}),
    message: { ack: { status: "ACK" } },
    ...(opts?.extra ?? {}),
  };
  if (opts?.trace) {
    finalizeAuditTrace(opts.trace, { status: 200, body });
    // Forward this inbound callback to ONDC Network Observability (no-op unless
    // NO is configured). Same seam, same fire-and-forget contract as audit.
    forwardInboundCallbackLog(opts.trace, { status: 200, body });
  }
  return NextResponse.json(body, { status: 200 });
}

// Build a NACK (caller chooses the non-2xx HTTP status). Carries the error block
// and — when available — the echoed inbound context.
export function buildNack(opts: {
  httpStatus: number;
  error: OndcError;
  context?: unknown;
  trace?: AuditTrace;
  extra?: Record<string, unknown>;
}): NextResponse {
  const body: CallbackResponseBody = {
    ...(opts.context ? { context: opts.context } : {}),
    message: { ack: { status: "NACK" } },
    error: opts.error,
    ...(opts.extra ?? {}),
  };
  if (opts.trace) {
    finalizeAuditTrace(opts.trace, { status: opts.httpStatus, body });
    forwardInboundCallbackLog(opts.trace, { status: opts.httpStatus, body });
  }
  return NextResponse.json(body, { status: opts.httpStatus });
}
