// ONDC inbound-callback audit log.
//
// Workbench/Pramaan reviewers ask for the raw trace of a transaction — what
// they sent, what we replied, exactly. The store records the *outcome* (the
// catalog / quote / order) but discards the wire bytes; this module records the
// wire bytes themselves, one JSONL line per inbound callback.
//
// Storage mirrors store.ts: in-memory ring (for hot reads + dev) backed by a
// JSONL file in dev or a single blob in prod (toggled by BLOB_READ_WRITE_TOKEN).
// Writes are fire-and-forget — an audit-write failure must never NACK a real
// callback. Reads are token-gated via the /api/ondc/audit endpoint.
//
// Server-only (touches fs + @vercel/blob, like store/config/auth).
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";

// One inbound callback event. Fields are populated incrementally by the route:
//   beginAuditTrace seeds action + requestHeaders + startedAt
//   annotateTrace fills rawBody / transactionId / messageId / bppId as they are
//     extracted from the verified payload
//   finalizeAuditTrace stamps responseStatus / responseBody / ackStatus /
//     errorCode at the moment the handler decides its reply
// Anything still unset on finalize means the handler exited before that field
// could be determined (e.g. a 400 on invalid JSON has no transactionId).
export type AuditEvent = {
  // Wall-clock receive time, ISO-8601. The eyeball-friendly index field.
  ts: string;
  // ONDC action this row corresponds to (route name without the "on_" prefix
  // dropped — kept as-is so logs grep cleanly).
  action: string;
  // Receive-to-respond latency in ms. Useful for spotting persistence-stalls.
  durationMs: number;
  // Subset of inbound HTTP headers (case-folded). authorization is RECORDED
  // verbatim — workbench tests signature shape, and a redacted header is
  // useless for debugging. Treat this file as secret accordingly.
  requestHeaders: Record<string, string>;
  // The exact bytes we received, as a string. Empty if the handler exited
  // before reading the body.
  rawBody: string;
  // Lifted from the verified context once extractAndValidate succeeds.
  transactionId?: string;
  messageId?: string;
  bppId?: string;
  // What we replied with. responseBody is the ack/nack envelope object (not
  // re-serialised — kept structured so the audit reader can filter on code).
  responseStatus: number;
  responseBody: unknown;
  // Convenience lifts off responseBody — saved for cheap filtering / counts.
  ackStatus?: "ACK" | "NACK";
  errorCode?: string;
};

// Fields the route owns at handler entry, before reading the body.
export type AuditSeed = {
  action: string;
  requestHeaders: Record<string, string>;
};

// The mutable trace handle threaded through a request. Routes annotate it as
// they extract IDs; finalize stamps the response and writes the event.
export type AuditTrace = {
  action: string;
  startedAt: number;
  requestHeaders: Record<string, string>;
  rawBody: string;
  transactionId?: string;
  messageId?: string;
  bppId?: string;
};

// ---------------------------------------------------------------------------
// Backend — JSONL file (dev) or single blob (prod).
// ---------------------------------------------------------------------------

// Vercel's project filesystem is READ-ONLY at runtime — only /tmp is writable
// per invocation. Match store-json.ts's pattern: /tmp on Vercel, project-rooted
// `data/` locally. /tmp is ephemeral per cold-start, so for durable audit you
// must set BLOB_READ_WRITE_TOKEN on Vercel — that flips to blob persistence.
const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "ondc", "audit.jsonl")
  : path.join(process.cwd(), "data", "ondc", "audit.jsonl");
const BLOB_KEY = "system/ondc/audit.jsonl";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// Cap the in-memory buffer so a long-lived dev process doesn't grow without
// bound. The on-disk JSONL file is the durable record; in-memory is just for
// fast reads and so the audit endpoint can serve recent events without re-
// parsing the whole file every call.
const RING_CAPACITY = 2000;

type AuditState = {
  ring: AuditEvent[];
  hydration: Promise<void> | null;
  writeQueue: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __ondcAudit__: AuditState | undefined;
}

function getState(): AuditState {
  if (!globalThis.__ondcAudit__) {
    globalThis.__ondcAudit__ = {
      ring: [],
      hydration: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalThis.__ondcAudit__;
}

async function readPersistedJsonl(): Promise<string> {
  if (useBlob) {
    try {
      const meta = await head(BLOB_KEY);
      if (!meta?.url) return "";
      const res = await fetch(meta.url, { cache: "no-store" });
      return res.ok ? await res.text() : "";
    } catch {
      return "";
    }
  }
  try {
    return await fs.readFile(DATA_FILE, "utf-8");
  } catch {
    return "";
  }
}

async function writePersistedJsonl(content: string): Promise<void> {
  if (useBlob) {
    await put(BLOB_KEY, content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/x-ndjson",
      cacheControlMaxAge: 0,
    });
    return;
  }
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, content);
}

function ensureHydrated(): Promise<void> {
  const s = getState();
  if (!s.hydration) s.hydration = loadJsonl(s);
  return s.hydration;
}

async function loadJsonl(s: AuditState): Promise<void> {
  const content = await readPersistedJsonl();
  if (!content) return;
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  // Keep only the tail in memory; older lines remain on disk for forensic reads.
  for (const line of lines.slice(-RING_CAPACITY)) {
    try {
      const ev = JSON.parse(line) as AuditEvent;
      s.ring.push(ev);
    } catch {
      // Tolerate a partially-flushed last line — skip and move on.
    }
  }
}

// Append one event. Serializes writes via a queue so concurrent callbacks don't
// interleave bytes in the JSONL file. Read-modify-write because @vercel/blob
// doesn't expose an append primitive — fine at the volumes a single BAP sees.
async function appendEvent(ev: AuditEvent): Promise<void> {
  const s = getState();
  s.ring.push(ev);
  while (s.ring.length > RING_CAPACITY) s.ring.shift();

  const run = s.writeQueue.then(async () => {
    const prev = await readPersistedJsonl();
    const next = (prev.endsWith("\n") || prev === "" ? prev : prev + "\n") +
      JSON.stringify(ev) +
      "\n";
    await writePersistedJsonl(next);
  });
  s.writeQueue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Public trace API — called by the on_* handlers.
// ---------------------------------------------------------------------------

// Build a fresh trace at handler entry. Copies headers eagerly so a later
// header read in the handler can't mutate what we record.
export function beginAuditTrace(seed: AuditSeed): AuditTrace {
  return {
    action: seed.action,
    startedAt: Date.now(),
    requestHeaders: { ...seed.requestHeaders },
    rawBody: "",
  };
}

// Patch fields onto the trace as they become known (rawBody after req.text(),
// transactionId/messageId/bppId after extractAndValidate succeeds).
export function annotateTrace(
  trace: AuditTrace,
  patch: Partial<Pick<AuditTrace, "rawBody" | "transactionId" | "messageId" | "bppId">>
): void {
  if (patch.rawBody !== undefined) trace.rawBody = patch.rawBody;
  if (patch.transactionId !== undefined) trace.transactionId = patch.transactionId;
  if (patch.messageId !== undefined) trace.messageId = patch.messageId;
  if (patch.bppId !== undefined) trace.bppId = patch.bppId;
}

// Stamp the response on the trace and fire-and-forget the JSONL write. Returns
// nothing — any write failure is logged and swallowed. CALLERS MUST NOT AWAIT
// IN THE HOT PATH: pass `void finalizeAuditTrace(...)` so a slow blob write
// can't delay the ACK we owe the counterparty.
export function finalizeAuditTrace(
  trace: AuditTrace,
  response: { status: number; body: unknown }
): void {
  const body = response.body as
    | { message?: { ack?: { status?: "ACK" | "NACK" } }; error?: { code?: string } }
    | null
    | undefined;
  const ev: AuditEvent = {
    ts: new Date(trace.startedAt).toISOString(),
    action: trace.action,
    durationMs: Date.now() - trace.startedAt,
    requestHeaders: trace.requestHeaders,
    rawBody: trace.rawBody,
    transactionId: trace.transactionId,
    messageId: trace.messageId,
    bppId: trace.bppId,
    responseStatus: response.status,
    responseBody: response.body,
    ackStatus: body?.message?.ack?.status,
    errorCode: body?.error?.code,
  };
  void (async () => {
    try {
      await ensureHydrated();
      await appendEvent(ev);
    } catch (err) {
      console.warn("ondc.audit write failed", {
        action: trace.action,
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// Read API — backs the /api/ondc/audit endpoint.
// ---------------------------------------------------------------------------

export type AuditFilter = {
  transactionId?: string;
  action?: string;
  limit?: number;
};

// Most-recent-first, filtered by (transactionId, action). Reads from the
// in-memory ring (already capped at RING_CAPACITY). For forensic dives older
// than the ring, read the JSONL file/blob directly.
export async function readAuditEvents(
  filter: AuditFilter = {}
): Promise<AuditEvent[]> {
  await ensureHydrated();
  const limit = Math.max(1, Math.min(filter.limit ?? 200, RING_CAPACITY));
  const out: AuditEvent[] = [];
  const s = getState();
  for (let i = s.ring.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = s.ring[i];
    if (filter.transactionId && ev.transactionId !== filter.transactionId) continue;
    if (filter.action && ev.action !== filter.action) continue;
    out.push(ev);
  }
  return out;
}
