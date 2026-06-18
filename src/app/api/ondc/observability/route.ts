// ONDC transaction observability view — READ-ONLY, per-transaction.
//
// Two separate records describe the life of one ONDC transaction, and they
// answer different questions:
//   - the AUDIT log (see ../audit/route.ts, @/lib/ondc/audit) holds the verbatim
//     wire trace: every inbound callback, what we replied, how long it took,
//     ACK/NACK, error codes. It is the "what happened, in order" record.
//   - the STORE projection (see ../reconcile/route.ts) holds the derived
//     artifacts: which BPPs left a catalog, quote, order, support or rating, and
//     how far each order progressed. It is the "what do we actually hold" record.
//
// A triage usually needs BOTH at once: the timeline tells you a callback NACK'd
// at 14:02, the reconciliation tells you that BPP never produced an order. This
// route stitches the two into a single payload so an operator does not have to
// poll /audit and /reconcile separately and correlate by hand.
//
//   GET /api/ondc/observability?transactionId=<id>
//
// It is a pure projection: it READS the audit log and the store, derives a
// summary + ordered timeline, and never mutates either. No persistence changes,
// no schema changes, no writes.
//
// Mirrors the conventions of the other ONDC routes: `NextResponse`,
// `runtime = "nodejs"`, a 400 guard on the required input.
import { NextResponse } from "next/server";
import { readAuditEvents } from "@/lib/ondc/audit";
// Read through the @/lib/ondc/store DISPATCHER — the SAME backend the write
// path uses (on_select → saveQuote → store.ts → dbBackend when
// isDatabaseConfigured(), else jsonBackend). Reading store-json directly here
// silently diverged from writes in DB mode: persisted quotes/orders landed in
// Postgres while this projection read the empty JSON snapshot, reporting
// totalEvents:0. store.ts is already statically imported by every write route,
// so this adds no new dependency.
import * as store from "@/lib/ondc/store";

// The audit log and the ondc/* store stack are both `import "server-only"` and
// touch node:fs / @vercel/blob, so this handler must run on the Node runtime,
// not Edge — the same choice as every other route in this app.
export const runtime = "nodejs";

// Per-BPP reconciliation row: a presence flag per artifact kind, plus the
// order's last lifecycle stage when an order exists. Shape mirrors the
// BppReconciliation type in ../reconcile/route.ts verbatim so the two endpoints
// stay interchangeable for clients.
type BppReconciliation = {
  bppId: string;
  bppUri: string;
  catalog: boolean;
  quote: boolean;
  order: boolean;
  orderStage?: string;
  support: boolean;
  rating: boolean;
};

// The reconciliation block — identical projection to ../reconcile/route.ts's
// response body. Factored into this helper (rather than imported) because that
// route keeps its logic inline in its GET handler and must not be modified.
type Reconciliation = {
  transactionId: string;
  catalogCount: number;
  bpps: BppReconciliation[];
};

// Build the store-derived reconciliation for one transaction. This is a faithful
// copy of the body of ../reconcile/route.ts's GET handler (minus the HTTP
// shell): collapse the catalog footprint to the unique set of BPPs, then read
// each BPP's post-discovery artifacts and derive presence from existence.
async function buildReconciliation(
  transactionId: string
): Promise<Reconciliation> {
  // Catalogs are the discovery footprint: every BPP that responded to on_search
  // left at least one catalog slice keyed by (txn, bpp, messageId). Multiple
  // slices can share a bppId, so collapse to the unique set of BPPs — that is
  // the population we reconcile against. We keep each BPP's bppUri (consistent
  // across its slices) for the response.
  const catalogs = await store.getCatalogs(transactionId);
  const bppUriById = new Map<string, string>();
  for (const c of catalogs) {
    if (!bppUriById.has(c.bppId)) bppUriById.set(c.bppId, c.bppUri);
  }

  // For each unique BPP, read its post-discovery artifacts and derive presence
  // from existence (a store miss returns null — the artifact simply hasn't
  // arrived). getOrder also gives us the order's last lifecycle stage.
  const bpps: BppReconciliation[] = await Promise.all(
    [...bppUriById.entries()].map(async ([bppId, bppUri]) => {
      const [quote, order, support, rating] = await Promise.all([
        store.getQuote(transactionId, bppId),
        store.getOrder(transactionId, bppId),
        store.getSupport(transactionId, bppId),
        store.getRating(transactionId, bppId),
      ]);

      return {
        bppId,
        bppUri,
        catalog: true, // by construction — bppId came from a catalog slice
        quote: quote !== null,
        order: order !== null,
        // Only meaningful when an order exists; omit it otherwise so the
        // absence of an order reads unambiguously.
        ...(order ? { orderStage: order.stage } : {}),
        support: support !== null,
        rating: rating !== null,
      };
    })
  );

  return {
    transactionId,
    catalogCount: catalogs.length,
    bpps,
  };
}

// One row of the ordered timeline. A lossy, eyeball-friendly slice of AuditEvent
// — the fields a triage scans for, without the verbatim headers / raw body the
// /audit endpoint serves for deep forensic dives.
type TimelineItem = {
  ts: string;
  action: string;
  durationMs: number;
  ackStatus?: "ACK" | "NACK";
  responseStatus: number;
  transactionId?: string;
  messageId?: string;
  bppId?: string;
  errorCode?: string;
};

// Roll-up of the audit trace: counts plus the most-recent action/timestamp.
type ObservabilitySummary = {
  totalEvents: number;
  acks: number;
  nacks: number;
  lastAction?: string;
  lastSeenAt?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();

  // transaction_id is the only key into both the audit log and the store for
  // this view — without it there is nothing to observe. Fail fast with a 400.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // Pull the full audit trace for this transaction. readAuditEvents returns
  // most-recent-first and caps at the in-memory ring (RING_CAPACITY = 2000), so
  // 2000 is the most we can ever get back — i.e. "everything we still hold".
  const events = await readAuditEvents({
    transactionId,
    limit: 2000,
  });

  // The reconciliation projection (store-derived) is independent of the audit
  // trace, so fetch it in parallel with no ordering dependency.
  const reconciliation = await buildReconciliation(transactionId);

  // Sort oldest → newest for the timeline. ts is ISO-8601, so lexicographic
  // comparison is chronological. Copy first — never mutate the array we got
  // back from the audit layer. With ascending order, the newest event is last.
  const ordered = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const newest = ordered.length ? ordered[ordered.length - 1] : undefined;

  const summary: ObservabilitySummary = {
    totalEvents: ordered.length,
    acks: ordered.filter((e) => e.ackStatus === "ACK").length,
    nacks: ordered.filter((e) => e.ackStatus === "NACK").length,
    lastAction: newest?.action,
    lastSeenAt: newest?.ts,
  };

  const timeline: TimelineItem[] = ordered.map((e) => ({
    ts: e.ts,
    action: e.action,
    durationMs: e.durationMs,
    ackStatus: e.ackStatus,
    responseStatus: e.responseStatus,
    transactionId: e.transactionId,
    messageId: e.messageId,
    bppId: e.bppId,
    errorCode: e.errorCode,
  }));

  return NextResponse.json(
    {
      transactionId,
      summary,
      timeline,
      reconciliation,
    },
    { status: 200 }
  );
}
