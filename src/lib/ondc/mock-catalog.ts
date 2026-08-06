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

// The three seller SLOTS every profile reuses. `offset` nudges each seller a few
// hundred metres off the buyer's gps in a DIFFERENT direction, so the stores land
// at distinct nearby coordinates — the "nearest first" distance sort on the
// browse-sellers screen then actually orders them instead of showing one identical
// distance for every store. ~0.009° ≈ 1 km, so these are all well within ~2 km.
// `priceFactor` spreads each seller's prices around the base so the seller-compare
// screen (offersForProduct) and the price sort both have something to show. The
// per-slot bppId is shared across domains (a real seller can serve many domains);
// providerId/name come from the per-domain profile below.
const SELLER_SLOTS = [
  { bppId: "mock-seller-1.openidea.co.in", priceFactor: 1.0, offset: { dLat: 0.004, dLng: 0.006 } },
  { bppId: "mock-seller-2.openidea.co.in", priceFactor: 0.9, offset: { dLat: -0.01, dLng: 0.007 } },
  { bppId: "mock-seller-3.openidea.co.in", priceFactor: 1.12, offset: { dLat: 0.013, dLng: -0.009 } },
] as const;

// An item variant. The names embed the searched term so the buyer app's
// client-side query filter (filterByQuery) always matches what the user typed —
// a search for anything returns a populated grid. basePrice < mrp for every
// variant, so after scaling the selling price stays below the MRP and the card
// shows a sensible discount.
type Variant = { suffix: string; basePrice: number; mrp: number };

// One domain's mock storefront: the three sellers (names) and the item variants
// they stock, priced for that category. Keyed by ONDC retail domain so a fashion
// (RET12) search yields fashion-shaped sellers/prices, an electronics (RET14)
// search yields electronics, etc. — not grocery names on every search.
type DomainProfile = {
  category: string; // fallback category label when the search carries none
  sellers: [string, string, string]; // provider names, one per SELLER_SLOT
  variants: Variant[];
};

const PROFILES: Record<string, DomainProfile> = {
  // Grocery (RET10) — UNCHANGED from the original mock (same seller names, price
  // points and variants) so the grocery dev experience and its tests are stable.
  "ONDC:RET10": {
    category: "Grocery",
    sellers: ["Green Basket Store", "Daily Mart", "FreshCart Express"],
    variants: [
      { suffix: "Premium", basePrice: 185, mrp: 220 },
      { suffix: "Value Pack", basePrice: 330, mrp: 415 },
      { suffix: "Organic", basePrice: 250, mrp: 300 },
      { suffix: "Everyday", basePrice: 99, mrp: 130 },
    ],
  },
  // Fashion (RET12)
  "ONDC:RET12": {
    category: "Fashion",
    sellers: ["Urban Threads", "StyleHub", "The Wardrobe Co."],
    variants: [
      { suffix: "Cotton", basePrice: 799, mrp: 1299 },
      { suffix: "Slim Fit", basePrice: 1199, mrp: 1999 },
      { suffix: "Premium", basePrice: 1699, mrp: 2499 },
      { suffix: "Everyday", basePrice: 499, mrp: 899 },
    ],
  },
  // Beauty & Personal Care (RET13)
  "ONDC:RET13": {
    category: "Beauty & Personal Care",
    sellers: ["Glow & Co.", "PureSkin", "Bloom Beauty"],
    variants: [
      { suffix: "Radiance", basePrice: 349, mrp: 499 },
      { suffix: "Daily Care", basePrice: 249, mrp: 349 },
      { suffix: "Pro", basePrice: 649, mrp: 899 },
      { suffix: "Essentials", basePrice: 199, mrp: 299 },
    ],
  },
  // Electronics (RET14)
  "ONDC:RET14": {
    category: "Electronics",
    sellers: ["TechNest", "GadgetHub", "VoltEdge"],
    variants: [
      { suffix: "Standard", basePrice: 1499, mrp: 1999 },
      { suffix: "Pro", basePrice: 3499, mrp: 4499 },
      { suffix: "Wireless", basePrice: 2299, mrp: 2999 },
      { suffix: "Lite", basePrice: 999, mrp: 1499 },
    ],
  },
};

// Resolve the profile for a domain; grocery is the default for any unknown/absent
// domain so the mock never returns an empty catalog.
function profileFor(domain?: string): DomainProfile {
  return (domain && PROFILES[domain]) || PROFILES["ONDC:RET10"];
}

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
  // ONDC retail domain the search targeted (e.g. "ONDC:RET12" for fashion).
  // Selects the seller names / prices / default category so results look like the
  // category the buyer searched. Defaults to grocery (RET10) when absent.
  domain?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
  deliveryCity?: string;
  deliveryLocality?: string;
  deliveryState?: string;
}): MockCatalogSlice[] {
  const profile = profileFor(input.domain);
  const term = titleCase(input.query || input.category || profile.category);
  const categoryId = input.category?.trim() || profile.category;

  // The buyer's own coordinate — the anchor every seller is placed around. When
  // absent/malformed the sellers carry no gps (distance sort falls back to a name
  // sort); we do NOT invent a default city's coordinate.
  const origin = parseGps(input.deliveryGps);

  return SELLER_SLOTS.map((slot, slotIndex) => {
    const providerName = profile.sellers[slotIndex];
    // Stable per-seller providerId derived from the seller name, so a re-search
    // in the same domain keeps identity stable (and distinct across sellers).
    const providerId = `P-${providerName.replace(/[^a-z0-9]+/gi, "").toUpperCase().slice(0, 12)}`;
    const seller = {
      ...slot,
      bppUri: `https://${slot.bppId}/ondc`,
      providerId,
      providerName,
    };
    const items = profile.variants.map((v, i) => {
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
