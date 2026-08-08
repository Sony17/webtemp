// Serviceability parsing + ranking — built from REAL shapes seen on the prod
// network (2026-08-09 Noida search): a Shegaon pickle seller declaring a
// 4,999 km radius, a Chennai seller declaring country-wide via tag type 12, a
// Pune hyperlocal with a 5 km circle, and a Gurgaon provider with zero items.
import { describe, expect, it } from "vitest";
import {
  normalizeCity,
  parseProviders,
  rankByServiceability,
  sellerServes,
  sortSellersByDistance,
  type CatalogRecord,
} from "./types";

function record(providers: unknown[]): CatalogRecord {
  return {
    transactionId: "t1",
    bppId: "bpp.example",
    bppUri: "https://bpp.example",
    messageId: "m1",
    catalog: { "bpp/providers": providers },
    receivedAt: 1,
  } as CatalogRecord;
}

const ITEM = { id: "sku-1", descriptor: { name: "Thing" }, price: { value: "10" } };

describe("parseReach via parseProviders", () => {
  it("treats a country-unit serviceability tag as pan-India", () => {
    const [s] = parseProviders([
      record([
        {
          id: "P1",
          descriptor: { name: "Veganator" },
          items: [ITEM],
          tags: [
            {
              code: "serviceability",
              list: [
                { code: "type", value: "12" },
                { code: "val", value: "IND" },
                { code: "unit", value: "country" },
              ],
            },
          ],
          locations: [{ id: "L1", gps: "13.08,80.27" }],
        },
      ]),
    ]);
    expect(s.panIndia).toBe(true);
  });

  it("treats an effectively-national radius (4999 km) as pan-India", () => {
    const [s] = parseProviders([
      record([
        {
          id: "P2",
          descriptor: { name: "Spinetra" },
          items: [ITEM],
          locations: [
            {
              id: "L1",
              gps: "20.79,76.69",
              circle: { gps: "20.79,76.69", radius: { unit: "km", value: "4999" } },
            },
          ],
        },
      ]),
    ]);
    expect(s.panIndia).toBe(true);
    expect(s.serviceRadiusKm).toBe(4999);
  });

  it("keeps a hyperlocal radius local and takes the largest declared", () => {
    const [s] = parseProviders([
      record([
        {
          id: "P3",
          descriptor: { name: "Pune Milk" },
          items: [ITEM],
          tags: [
            {
              code: "serviceability",
              list: [
                { code: "type", value: "10" },
                { code: "val", value: "3" },
                { code: "unit", value: "km" },
              ],
            },
          ],
          locations: [
            {
              id: "L1",
              gps: "18.51,73.81",
              circle: { gps: "18.51,73.81", radius: { unit: "km", value: "5" } },
            },
          ],
        },
      ]),
    ]);
    expect(s.panIndia).toBeUndefined();
    expect(s.serviceRadiusKm).toBe(5);
  });

  it("counts items and accumulates across slices", () => {
    const sellers = parseProviders([
      record([{ id: "P4", descriptor: { name: "A" }, items: [ITEM] }]),
      record([{ id: "P4", descriptor: { name: "A" }, items: [ITEM, ITEM] }]),
      record([{ id: "P5", descriptor: { name: "Empty" }, items: [] }]),
    ]);
    const a = sellers.find((s) => s.providerId === "P4");
    const empty = sellers.find((s) => s.providerId === "P5");
    expect(a?.itemCount).toBe(3);
    expect(empty?.itemCount).toBe(0);
  });
});

describe("sellerServes + rankByServiceability", () => {
  // Buyer in Noida; Pune hyperlocal (~1,200 km away, 5 km radius) vs pan-India.
  const NOIDA = "28.5355,77.3910";
  const catalogs = [
    record([
      {
        id: "local-pune",
        descriptor: { name: "Pune Milk" },
        items: [ITEM],
        locations: [
          {
            id: "L1",
            gps: "18.51,73.81",
            circle: { gps: "18.51,73.81", radius: { unit: "km", value: "5" } },
          },
        ],
      },
      {
        id: "pan-india",
        descriptor: { name: "Spinetra" },
        items: [ITEM],
        locations: [
          {
            id: "L2",
            gps: "20.79,76.69",
            circle: { gps: "20.79,76.69", radius: { unit: "km", value: "4999" } },
          },
        ],
      },
      {
        id: "unknown-reach",
        descriptor: { name: "Mystery" },
        items: [ITEM],
        locations: [{ id: "L3", gps: "12.97,77.59" }],
      },
    ]),
  ];

  it("classifies serving / out-of-range / unknown correctly", () => {
    const ranked = sortSellersByDistance(parseProviders(catalogs), NOIDA);
    const byId = new Map(ranked.map((s) => [s.providerId, s]));
    expect(sellerServes(byId.get("pan-india")!)).toBe(true);
    expect(sellerServes(byId.get("local-pune")!)).toBe(false);
    expect(sellerServes(byId.get("unknown-reach")!)).toBeUndefined();
  });

  it("sinks out-of-range sellers to the end without penalizing unknown", () => {
    const ranked = rankByServiceability(
      sortSellersByDistance(parseProviders(catalogs), NOIDA)
    );
    expect(ranked[ranked.length - 1].providerId).toBe("local-pune");
    // Unknown-reach seller must NOT be last — unknown is not a verdict.
    expect(
      ranked.findIndex((s) => s.providerId === "unknown-reach")
    ).toBeLessThan(ranked.length - 1);
  });
});

describe("normalizeCity pincode suffix", () => {
  it('strips a trailing 6-digit pincode ("Chennai 600040" → "Chennai")', () => {
    expect(normalizeCity("Chennai 600040")).toBe("Chennai");
    expect(normalizeCity("PUNE")).toBe("Pune");
    expect(normalizeCity("Navi Mumbai")).toBe("Navi Mumbai");
  });
});
