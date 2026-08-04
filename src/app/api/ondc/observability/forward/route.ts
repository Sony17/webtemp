// ONDC Network Observability (NO) — forwarding status + manual log submission.
//
// Two verbs:
//   GET  → report whether NO forwarding is live and the running submission
//          counters. Leak-free: never returns the token or the full endpoint
//          URL (host only), so it is safe to leave ungated.
//   POST → manually (re-)submit the stored inbound transaction logs for one
//          transaction to the collector. This is the explicit "submit NO logs"
//          action you use to prove the integration works in PRE-PROD before it
//          runs continuously. Gated by ONDC_AUDIT_TOKEN (it triggers outbound
//          submissions and reads the audit store), reusing the same shared
//          secret and constant-time check as /api/ondc/audit.
//
// Real-time forwarding of every callback / outbound call happens automatically
// in responses.ts and client.ts; this route is the manual/diagnostic surface on
// top of that. See src/lib/ondc/network-observability.ts for the mechanism.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readAuditEvents, type AuditEvent } from "@/lib/ondc/audit";
import { readOndcScopedEnv } from "@/lib/ondc/config";
import {
  getObservabilityConfig,
  getObservabilityStats,
  submitObservabilityLogNow,
  type ObservabilityRecord,
} from "@/lib/ondc/network-observability";

// audit + NO are server-only (fs / secrets), so this runs on the Node runtime
// like every other ONDC route.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET — status (safe to expose; no secrets).
// ---------------------------------------------------------------------------

export async function GET() {
  const cfg = getObservabilityConfig();

  // Derive display fields without leaking the token or full URL (which may carry
  // a path secret). When disabled, still surface WHICH pieces are missing so the
  // operator can tell "no URL" from "no token" from "kill switch on".
  let host: string | null = null;
  if (cfg) {
    try {
      host = new URL(cfg.url).host;
    } catch {
      host = null;
    }
  }

  return NextResponse.json(
    {
      enabled: cfg !== null,
      environment: cfg?.environment ?? null,
      subscriberId: cfg?.subscriberId ?? null,
      endpoint: {
        // Check both our name and ONDC's own ONDC_NO_ENDPOINT alias, each via
        // the ONDC_ENV-scoped resolver — the config resolver accepts all of
        // these, so the display must too.
        configured: !!(
          readOndcScopedEnv("ONDC_OBSERVABILITY_URL") ||
          readOndcScopedEnv("ONDC_NO_ENDPOINT")
        ),
        host,
      },
      tokenConfigured: !!(
        readOndcScopedEnv("ONDC_OBSERVABILITY_TOKEN") ||
        readOndcScopedEnv("ONDC_NO_TOKEN")
      ),
      killSwitch: readOndcScopedEnv("ONDC_OBSERVABILITY_ENABLED") === "0",
      stats: getObservabilityStats(),
    },
    { status: 200 }
  );
}

// ---------------------------------------------------------------------------
// POST — manual replay of one transaction's stored inbound logs.
// ---------------------------------------------------------------------------

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

// Map a stored inbound audit event to the NO record shape.
function recordFromAuditEvent(ev: AuditEvent): ObservabilityRecord {
  return {
    direction: "inbound",
    action: ev.action,
    transactionId: ev.transactionId,
    messageId: ev.messageId,
    bppId: ev.bppId,
    requestBody: ev.rawBody,
    responseBody: ev.responseBody,
    httpStatus: ev.responseStatus,
    ackStatus: ev.ackStatus,
    recordedAt: ev.ts,
  };
}

export async function POST(req: Request) {
  const url = new URL(req.url);

  // Same fail-closed token gate as the audit reader: without ONDC_AUDIT_TOKEN
  // set, the endpoint is off (it triggers outbound submissions from the store).
  const expected = process.env.ONDC_AUDIT_TOKEN;
  if (!expected || expected.length === 0) {
    return NextResponse.json(
      { error: "ONDC_AUDIT_TOKEN is not set on this server." },
      { status: 503 }
    );
  }
  const provided = extractToken(req, url);
  if (!provided || !tokensMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!getObservabilityConfig()) {
    return NextResponse.json(
      {
        error:
          "Network Observability is not configured. Set ONDC_OBSERVABILITY_URL " +
          "and ONDC_OBSERVABILITY_TOKEN (and don't set ONDC_OBSERVABILITY_ENABLED=0).",
      },
      { status: 409 }
    );
  }

  // transaction_id scopes the replay. Accept it from the query or a JSON body.
  let transactionId = url.searchParams.get("transactionId")?.trim() || undefined;
  if (!transactionId) {
    try {
      const body = (await req.json()) as { transactionId?: unknown };
      if (typeof body?.transactionId === "string") {
        transactionId = body.transactionId.trim() || undefined;
      }
    } catch {
      // no/!json body — fall through to the 400 below
    }
  }
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (query param or JSON body)." },
      { status: 400 }
    );
  }

  const events = await readAuditEvents({ transactionId, limit: 2000 });

  // Only fully-extracted callbacks (txn + msg) are real transaction logs — the
  // same filter the automatic inbound path applies. Submit each and await the
  // outcome so the response reports true success/failure (and so the submissions
  // aren't cut short when this request returns on serverless).
  let submitted = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const ev of events) {
    if (!ev.transactionId || !ev.messageId) {
      skipped += 1;
      continue;
    }
    const result = await submitObservabilityLogNow(recordFromAuditEvent(ev));
    if (result.ok) submitted += 1;
    else {
      failed += 1;
      if (result.error && errors.length < 5) errors.push(result.error);
    }
  }

  return NextResponse.json(
    {
      transactionId,
      found: events.length,
      submitted,
      failed,
      skipped,
      ...(errors.length ? { errors } : {}),
      stats: getObservabilityStats(),
    },
    { status: failed > 0 ? 502 : 200 }
  );
}
