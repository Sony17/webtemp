// Dev-only MOCK catalog generator for offline buyer-app development.
//
// ONDC discovery is asynchronous: a real `search` returns only an ACK, and the
// actual catalogs arrive LATER as `on_search` callbacks POSTed to our PUBLIC
// bap_uri — which a localhost dev server never receives. On top of that, the
// staging gateway NACKs a cold search (error 412: "No active expectation") when
// no Workbench test case is running, and the staging test sellers it *does*
// return are all pinned to one city (Bengaluru) — so a buyer in any other city
// can never see a local seller. On a developer machine there is simply no way to
// see real, location-relevant catalog data come back.
//
// When ONDC_MOCK_CATALOG=true, the /search route calls buildMockCatalog() to
// synthesize a small, realistic multi-seller catalog LOCATED AROUND THE BUYER
// (their reverse-geocoded city + gps) and writes it straight into the SAME store
// the buyer app polls (/api/shop/state) — so search → results renders end-to-end
// with no network at all, and a Noida buyer sees Noida sellers.
//
// This is a DEVELOPMENT AID ONLY. It fabricates catalog data, so it must never be
// enabled where real buyers are served; the env flag is unset (off) everywhere by
// default and this module only runs when it is explicitly turned on.
import "server-only";
import { parseGps } from "@/lib/shop/types";

// One BPP's slice of a discovery result — the exact shape the /on_search route
// hands to saveCatalog(), so the mock path and the real callback path store
// identical records.
export type MockCatalogSlice = {
  bppId: string;
  bppUri: string;
  messageId: string;
  catalog: unknown;
};

// Three fictional sellers. `priceFactor` spreads each seller's prices around the
// base so the seller-compare screen (offersForProduct) and the price sort both
// have something meaningful to show. `offset` nudges each seller a few hundred
// metres off the buyer's gps in a DIFFERENT direction, so the three stores land
// at distinct nearby coordinates — the "nearest first" distance sort on the
// browse-sellers screen then actually orders them instead of showing one identical
// distance for every store. ~0.009° ≈ 1 km, so these are all well within ~2 km.
const SELLERS = [
  {
    bppId: "mock-seller-1.openidea.co.in",
    bppUri: "https://mock-seller-1.openidea.co.in/ondc",
    providerId: "P-GREENBASKET",
    providerName: "Green Basket Store",
    priceFactor: 1.0,
    offset: { dLat: 0.004, dLng: 0.006 },
  },
  {
    bppId: "mock-seller-2.openidea.co.in",
    bppUri: "https://mock-seller-2.openidea.co.in/ondc",
    providerId: "P-DAILYMART",
    providerName: "Daily Mart",
    priceFactor: 0.9,
    offset: { dLat: -0.01, dLng: 0.007 },
  },
  {
    bppId: "mock-seller-3.openidea.co.in",
    bppUri: "https://mock-seller-3.openidea.co.in/ondc",
    providerId: "P-FRESHCART",
    providerName: "FreshCart Express",
    priceFactor: 1.12,
    offset: { dLat: 0.013, dLng: -0.009 },
  },
] as const;

// Item variants each seller stocks. The names embed the searched term so the
// buyer app's client-side query filter (filterByQuery) always matches what the
// user typed — a search for anything returns a populated grid. basePrice < mrp
// for every variant, so after scaling the selling price stays below the MRP and
// the card shows a sensible discount.
const VARIANTS = [
  { suffix: "Premium", basePrice: 185, mrp: 220 },
  { suffix: "Value Pack", basePrice: 330, mrp: 415 },
  { suffix: "Organic", basePrice: 250, mrp: 300 },
  { suffix: "Everyday", basePrice: 99, mrp: 130 },
] as const;

// Title-case the raw query for use in item names ("basmati rice" → "Basmati
// Rice"). Collapses internal whitespace so a sloppy query still reads cleanly.
function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ONDC prices are strings on the wire; parseCatalogs coerces them back to
// numbers. Round to whole rupees so the mock reads like real money.
function rupees(n: number): string {
  return String(Math.round(n));
}

// Build the seller's ONDC location address from whatever the buyer's
// reverse-geocode surfaced. Every field is optional and OMITTED when absent —
// the mock must NEVER fall back to a fixed city (that is the "always Bengaluru"
// bug this generator exists to fix). An empty object is fine: parseProviders
// tolerates a location with no address.
function sellerAddress(input: {
  areaCode?: string;
  locality?: string;
  city?: string;
  state?: string;
}): Record<string, string> {
  const addr: Record<string, string> = {};
  if (input.areaCode) addr.area_code = input.areaCode;
  if (input.locality) addr.locality = input.locality;
  if (input.city) addr.city = input.city;
  if (input.state) addr.state = input.state;
  return addr;
}

// Build a full mock discovery result: one slice per fictional seller, each with a
// provider carrying the VARIANTS priced by that seller's factor and LOCATED near
// the buyer. Names/desc embed the search term so results are relevant to whatever
// the buyer searched for; the location (gps + city/locality/state/area_code) is
// derived from the buyer so the storefront and distance sort reflect where the
// buyer actually is — not a hardcoded city.
export function buildMockCatalog(input: {
  query?: string;
  category?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
  deliveryCity?: string;
  deliveryLocality?: string;
  deliveryState?: string;
}): MockCatalogSlice[] {
  const term = titleCase(input.query || input.category || "Item");
  const categoryId = input.category?.trim() || "Grocery";

  // The buyer's own coordinate — the anchor every seller is placed around. When
  // absent/malformed the sellers carry no gps (distance sort falls back to a name
  // sort); we do NOT invent a default city's coordinate.
  const origin = parseGps(input.deliveryGps);

  return SELLERS.map((seller) => {
    const items = VARIANTS.map((v, i) => {
      const price = Math.round(v.basePrice * seller.priceFactor);
      const mrp = Math.round(v.mrp * seller.priceFactor);
      return {
        id: `${seller.providerId}-I${i + 1}`,
        descriptor: {
          name: `${term} — ${v.suffix}`,
          short_desc: `${v.suffix} ${term.toLowerCase()} from ${seller.providerName}`,
          long_desc: `${term} (${v.suffix}) offered by ${seller.providerName}. Mock catalog item for local development.`,
        },
        category_id: categoryId,
        location_id: "L1",
        price: {
          currency: "INR",
          value: rupees(price),
          maximum_value: rupees(mrp),
        },
        quantity: { available: { count: "50" } },
      };
    });

    // Place this seller a short, distinct hop off the buyer's coordinate so the
    // three stores sort by distance meaningfully. No buyer gps → no seller gps.
    const gps = origin
      ? `${(origin.lat + seller.offset.dLat).toFixed(6)},${(
          origin.lng + seller.offset.dLng
        ).toFixed(6)}`
      : undefined;

    return {
      bppId: seller.bppId,
      bppUri: seller.bppUri,
      // Stable per-seller messageId (not a random uuid): a repeat/refresh search
      // on the SAME transaction then REPLACES this seller's slice (saveCatalog is
      // keyed on txn+bpp+messageId) instead of appending a duplicate store.
      messageId: `mock-${seller.providerId}`,
      catalog: {
        "bpp/descriptor": { name: seller.providerName },
        "bpp/providers": [
          {
            id: seller.providerId,
            descriptor: { name: seller.providerName },
            locations: [
              {
                id: "L1",
                ...(gps ? { gps } : {}),
                address: sellerAddress({
                  areaCode: input.deliveryAreaCode?.trim(),
                  locality: input.deliveryLocality?.trim(),
                  city: input.deliveryCity?.trim(),
                  state: input.deliveryState?.trim(),
                }),
              },
            ],
            items,
          },
        ],
      },
    };
  });
}
