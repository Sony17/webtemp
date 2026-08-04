// ONDC admin — one seller's detail, aggregated across every stored search.
//
//   GET /api/shop/admin/sellers/{bppId}/{providerId}
//     → { seller, items: Product[], transactions: string[], itemCount }
//     → 404 { error } when no stored catalog slice carries this provider.
//
// A seller has no single "profile" on the network — its identity and catalog
// arrive scattered across the on_search slices of many discovery sessions. This
// folds every slice from the seller's BPP into one view: identity + location
// (parseProviders / findSeller), full item list (parseCatalogs → itemsForProvider),
// and the set of transactions the provider actually appeared in. Complete across
// instances on Postgres; the JSON backend reflects only the serving snapshot.
//
// Ungated server-side, matching the app's admin posture — /shop/admin guards
// client-side via the admin login.
import { NextResponse } from "next/server";
import * as store from "@/lib/ondc/store";
import {
  findSeller,
  parseCatalogs,
  parseProviders,
  itemsForProvider,
} from "@/lib/shop/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bppId: string; providerId: string }> }
) {
  const { bppId: rawBpp, providerId: rawProvider } = await params;
  const bppId = decodeURIComponent(rawBpp);
  const providerId = decodeURIComponent(rawProvider);

  // Narrow to this BPP's slices up front — a seller's catalog only ever arrives
  // from its own bpp_id, so this bounds the parse without dropping any data.
  const forBpp = (await store.listCatalogs()).filter((c) => c.bppId === bppId);

  const seller = findSeller(forBpp, bppId, providerId);
  if (!seller) {
    return NextResponse.json(
      { error: "Seller not found in any stored catalog." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // forBpp is newest-first (listCatalogs sorts by receivedAt desc), so folding
  // by itemId and keeping the first occurrence dedupes the same item repeated
  // across many search sessions down to its most-recent catalog entry.
  const byItemId = new Map<string, ReturnType<typeof parseCatalogs>[number]>();
  for (const p of itemsForProvider(parseCatalogs(forBpp), bppId, providerId)) {
    if (!byItemId.has(p.itemId)) byItemId.set(p.itemId, p);
  }
  const items = [...byItemId.values()];

  // Distinct discovery sessions where this provider actually appeared (a BPP can
  // carry several providers, so filter per slice rather than trusting bpp match).
  const transactions = [
    ...new Set(
      forBpp
        .filter((c) => parseProviders([c]).some((s) => s.providerId === providerId))
        .map((c) => c.transactionId)
    ),
  ];

  return NextResponse.json(
    { seller, items, transactions, itemCount: items.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
