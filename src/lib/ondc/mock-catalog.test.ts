// buildMockCatalog — location-aware synthetic sellers.
//
// The dev mock exists to give a localhost buyer app real-feeling results. Its one
// job that a buyer will actually notice: the synthetic sellers must sit in the
// BUYER'S city, not a hardcoded one. This pins the "Noida buyer sees Noida
// sellers, not Bengaluru" contract, plus the distinct-coordinates property the
// browse-sellers distance sort depends on.
import { describe, expect, it } from "vitest";
import { buildMockCatalog } from "@/lib/ondc/mock-catalog";
import { parseCatalogs, parseProviders, type CatalogRecord } from "@/lib/shop/types";

// Turn the mock slices into the same CatalogRecord[] the store yields, so we can
// read them back through the very parser the seller screens use.
function asRecords(
  slices: ReturnType<typeof buildMockCatalog>
): CatalogRecord[] {
  return slices.map((s) => ({
    transactionId: "t1",
    bppId: s.bppId,
    bppUri: s.bppUri,
    messageId: s.messageId,
    catalog: s.catalog,
    receivedAt: 0,
  }));
}

// Noida — a buyer far from the staging default (Bengaluru).
const NOIDA = {
  query: "milk",
  deliveryGps: "28.535500,77.391000",
  deliveryAreaCode: "201301",
  deliveryCity: "Noida",
  deliveryLocality: "Sector 18",
  deliveryState: "Uttar Pradesh",
};

describe("buildMockCatalog — buyer-located sellers", () => {
  it("stamps the buyer's city on every seller (never a hardcoded Bengaluru)", () => {
    const sellers = parseProviders(asRecords(buildMockCatalog(NOIDA)));
    expect(sellers.length).toBeGreaterThan(1);
    for (const s of sellers) {
      expect(s.city).toBe("Noida");
      expect(s.locality).toBe("Sector 18");
      expect(s.areaCode).toBe("201301");
    }
    // The old bug: the fixed-Bengaluru serialization. Guard against a regression.
    expect(JSON.stringify(sellers)).not.toMatch(/bengaluru|karnataka/i);
  });

  it("places sellers at DISTINCT coordinates near the buyer (so distance sort orders them)", () => {
    const sellers = parseProviders(asRecords(buildMockCatalog(NOIDA)));
    const coords = sellers.map((s) => s.gps);
    // Every seller carries a gps, and no two share one — otherwise the browse
    // screen shows one identical distance for the whole list.
    expect(coords.every(Boolean)).toBe(true);
    expect(new Set(coords).size).toBe(coords.length);
    // …and each sits within a delivery-scale hop of the buyer (< ~3 km ≈ 0.03°).
    for (const gps of coords) {
      const [lat, lng] = gps!.split(",").map(Number);
      expect(Math.abs(lat - 28.5355)).toBeLessThan(0.03);
      expect(Math.abs(lng - 77.391)).toBeLessThan(0.03);
    }
  });

  it("emits a stable messageId per seller so a refresh replaces, not duplicates", () => {
    const a = buildMockCatalog(NOIDA).map((s) => s.messageId);
    const b = buildMockCatalog(NOIDA).map((s) => s.messageId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // one per seller
  });

  it("omits gps and city entirely when the buyer has no location (no invented default)", () => {
    const sellers = parseProviders(asRecords(buildMockCatalog({ query: "rice" })));
    for (const s of sellers) {
      expect(s.gps).toBeUndefined();
      expect(s.city).toBeUndefined();
    }
    expect(JSON.stringify(sellers)).not.toMatch(/bengaluru|karnataka/i);
  });
});

describe("buildMockCatalog — domain-aware storefronts (fashion discovery)", () => {
  it("a fashion (RET12) search yields fashion sellers, not grocery", () => {
    const sellers = parseProviders(
      asRecords(buildMockCatalog({ query: "shirt", domain: "ONDC:RET12" }))
    );
    const names = sellers.map((s) => s.name);
    // Fashion profile sellers — and none of the grocery seller names leak in.
    expect(names).toEqual(
      expect.arrayContaining(["Urban Threads", "StyleHub", "The Wardrobe Co."])
    );
    expect(JSON.stringify(names)).not.toMatch(/green basket|daily mart|freshcart/i);
  });

  it("stamps the searched fashion category on items and keeps the query term", () => {
    const products = parseCatalogs(
      asRecords(buildMockCatalog({ query: "shirt", domain: "ONDC:RET12" }))
    );
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.name.toLowerCase()).toContain("shirt");
      expect(p.categoryId).toBe("Fashion");
    }
  });

  it("defaults to the grocery profile when no domain is given (unchanged behaviour)", () => {
    const sellers = parseProviders(asRecords(buildMockCatalog({ query: "rice" })));
    const names = sellers.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["Green Basket Store", "Daily Mart", "FreshCart Express"])
    );
  });

  it("gives distinct sellers/message ids for every supported domain", () => {
    for (const domain of ["ONDC:RET10", "ONDC:RET12", "ONDC:RET13", "ONDC:RET14"]) {
      const slices = buildMockCatalog({ query: "item", domain });
      const ids = slices.map((s) => s.messageId);
      expect(ids.length).toBeGreaterThan(1);
      expect(new Set(ids).size).toBe(ids.length); // one slice per seller, all unique
    }
  });
});
