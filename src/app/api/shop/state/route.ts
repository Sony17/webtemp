// Buyer-app transaction STATE projection — READ-ONLY.
//
// The existing /api/ondc/observability and /reconcile endpoints answer the
// operator question ("did a catalog/quote/order arrive?") with presence
// booleans. The buyer app needs the opposite: the actual stored PAYLOADS so it
// can render catalogs, quote breakdowns, order details and tracking.
//
// This route is purely additive — it reads the SAME store dispatcher the
// callbacks write through (so it sees Postgres or JSON, whichever is active)
// and returns the raw records. It never mutates anything and does not touch the
// existing ONDC routes.
//
//   GET /api/shop/state?transactionId=<id>
//     → { transactionId, catalogs[], bpps: [{ bppId, bppUri, quote, order,
//         support, rating }], issues[] }
//
// The buyer-app polls this on an interval after each ONDC action because the
// real data arrives asynchronously via on_* callbacks.
import { NextResponse } from "next/server";
import * as store from "@/lib/ondc/store";

// The ondc/* store stack is `import "server-only"` and touches node:fs /
// @vercel/blob / Prisma, so this must run on the Node runtime.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();

  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // Catalogs define the BPP footprint for this transaction (every BPP that
  // answered on_search left at least one slice). Collapse to the unique BPP
  // set, then read each BPP's downstream artifacts (quote/order/support/rating)
  // by the same (transactionId, bppId) key.
  const catalogs = await store.getCatalogs(transactionId);

  const bppIds = new Map<string, string>();
  for (const c of catalogs) {
    if (!bppIds.has(c.bppId)) bppIds.set(c.bppId, c.bppUri);
  }

  // A quote/order/support can exist for a bpp we never saw a catalog slice for
  // — e.g. a checkout resumed after the discovery catalogs aged out, or the
  // JSON `/tmp` store fragmented and this instance holds the order but not the
  // catalog. The caller (which always knows its bpp post-select) can hint it so
  // that bpp's downstream records are still surfaced.
  const bppIdHint = url.searchParams.get("bppId")?.trim();
  const bppUriHint = url.searchParams.get("bppUri")?.trim();
  if (bppIdHint && !bppIds.has(bppIdHint)) {
    bppIds.set(bppIdHint, bppUriHint ?? "");
  }

  const bpps = await Promise.all(
    [...bppIds.entries()].map(async ([bppId, bppUri]) => {
      const [quote, order, support, rating] = await Promise.all([
        store.getQuote(transactionId, bppId),
        store.getOrder(transactionId, bppId),
        store.getSupport(transactionId, bppId),
        store.getRating(transactionId, bppId),
      ]);
      // Prefer the catalog/hint bppUri, but fall back to whatever a stored
      // record carries so a hinted-only bpp still routes for later actions.
      const resolvedBppUri =
        bppUri || order?.bppUri || quote?.bppUri || support?.bppUri || "";
      return { bppId, bppUri: resolvedBppUri, quote, order, support, rating };
    })
  );

  // A quote/order can also exist for a BPP that we never saw a catalog slice
  // for (e.g. a flow resumed mid-lifecycle). The catalog footprint covers the
  // normal case; issues are read by transaction regardless.
  const issues = await store.getIssuesByTransaction(transactionId);

  return NextResponse.json(
    { transactionId, catalogs, bpps, issues },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
