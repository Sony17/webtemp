// ONDC inbound-callback audit reader — token-gated.
//
// The on_* routes record one JSONL event per inbound callback via
// src/lib/ondc/audit.ts (raw bytes + headers + ack/nack reply). This route
// reads them back so you (or a workbench reviewer) can answer "what did they
// send for transaction X, what did we reply, and why."
//
// The events contain the verbatim Authorization header and request body, so
// access is gated by ONDC_AUDIT_TOKEN — a shared secret set in env. Constant-
// time-ish comparison is used to avoid leaking the token via timing.
//
// Query params:
//   txn=<transactionId>     filter to one transaction
//   action=on_search        filter to one ONDC action
//   limit=<n>               cap results (default 200, max 2000)
//
// Auth: pass the token via `?token=...` OR `Authorization: Bearer <token>`.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readAuditEvents } from "@/lib/ondc/audit";

export const runtime = "nodejs";

function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function extractToken(req: Request, url: URL): string | null {
  const q = url.searchParams.get("token");
  if (q) return q;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return null;
}

export async function GET(req: Request) {
  const expected = process.env.ONDC_AUDIT_TOKEN;
  if (!expected || expected.length === 0) {
    // Fail closed: without a token set, the endpoint is off. Anything else would
    // leak the audit log to unauthenticated callers.
    return NextResponse.json(
      { error: "ONDC_AUDIT_TOKEN is not set on this server." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const provided = extractToken(req, url);
  if (!provided || !tokensMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const transactionId = url.searchParams.get("txn") ?? undefined;
  const action = url.searchParams.get("action") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const events = await readAuditEvents({
    transactionId,
    action,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json(
    {
      count: events.length,
      filter: { transactionId, action, limit },
      events,
    },
    { status: 200 }
  );
}
