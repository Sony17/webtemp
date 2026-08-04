// ONDC admin — deduped seller (provider) directory for /shop/admin.
//
//   GET /api/shop/admin/sellers
//     → { sellers: [{ bppId, bppUri, providerId, name, image?, shortDesc?,
//                     rating?, locality?, city?, areaCode? }], count }
//
// There is no global seller registry on the ONDC network: a provider only
// becomes visible once it answers a `search` with an on_search catalog slice.
// This rolls up every stored slice (across all transactions) and folds it into
// one row per unique (bppId, providerId) via parseProviders — the same extractor
// the buyer app's seller pages use. Complete across instances on Postgres; on
// the JSON backend it reflects only the serving instance's snapshot.
//
// Ungated server-side, matching the app's existing admin posture — the
// /shop/admin page guards client-side via the admin login.
import { NextResponse } from "next/server";
import * as store from "@/lib/ondc/store";
import { parseProviders } from "@/lib/shop/types";

export const runtime = "nodejs";

export async function GET() {
  const catalogs = await store.listCatalogs();
  const sellers = parseProviders(catalogs).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return NextResponse.json(
    { sellers, count: sellers.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
