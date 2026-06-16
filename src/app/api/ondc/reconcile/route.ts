// ONDC transaction reconciliation reader — READ-ONLY, per-transaction.
//
// One ONDC transaction_id is the spine of a whole buyer session: a discovery
// (on_search) fans out to N BPPs, then each chosen BPP accumulates its own
// quote (on_select), order (on_init → on_confirm → on_status/track/cancel/
// update) and standalone support/rating records. Those artifacts land in the
// store under DIFFERENT keys — catalogs by (txn, bpp, messageId), everything
// else by (txn, bpp) — so there is no single place to glance at "what do we
// actually hold for this transaction, and for which sellers."
//
// This route assembles exactly that view. For support investigations and ONDC
// debugging it answers the first questions every triage starts with:
//   - which BPPs responded to this transaction at all (catalog present)?
//   - did a given BPP quote / get an order drafted / confirmed?
//   - how far did each order progress (its last lifecycle stage)?
//   - did the buyer ever raise support or submit a rating to that BPP?
// A gap here (e.g. quote present but no order, or an order stuck at "init")
// localizes a stalled flow to a specific (transaction, bpp) pair without
// trawling the raw callback audit log (see ../audit/route.ts for the verbatim
// per-callback events). This is a derived projection only — it READS the store
// and never mutates persistence.
//
//   GET /api/ondc/reconcile?transactionId=<id>
//
// Mirrors the conventions of the other ONDC routes: `NextResponse`,
// `runtime = "nodejs"`, a 400 guard on the required input.
import { NextResponse } from "next/server";
// Read straight from the JSON backend rather than the @/lib/ondc/store
// dispatcher. The dispatcher eagerly imports the Postgres backend (store-db.ts
// → @/lib/db → @prisma/adapter-pg), which isn't installed locally and isn't
// needed for reconciliation — importing store-json directly keeps that Prisma
// chain out of the bundle entirely.
import * as store from "@/lib/ondc/store-json";

// The ondc/* store stack is `import "server-only"` and touches node:fs /
// @vercel/blob, so this handler must run on the Node runtime, not Edge — the
// same choice as every other route in this app.
export const runtime = "nodejs";

// Per-BPP reconciliation row: a presence flag per artifact kind, plus the
// order's last lifecycle stage when an order exists.
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();

  // transaction_id is the only key into the store for this view — without it
  // there is nothing to reconcile. Fail fast with a 400 rather than scanning.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // Catalogs are the discovery footprint: every BPP that responded to on_search
  // left at least one catalog slice keyed by (txn, bpp, messageId). Multiple
  // slices can share a bppId (incremental on_search messages), so collapse to
  // the unique set of BPPs — that is the population we reconcile against. We
  // keep each BPP's bppUri (consistent across its slices) for the response.
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

  return NextResponse.json(
    {
      transactionId,
      catalogCount: catalogs.length,
      bpps,
    },
    { status: 200 }
  );
}
