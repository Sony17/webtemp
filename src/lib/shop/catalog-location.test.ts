// parseCatalogs — provider serving-location resolution.
//
// Pins the checkout root cause behind a production `select` 422 (seller NACK):
// an incremental on_search can split a provider's `locations` into a DIFFERENT
// message than its `items`. If location only resolved within the item's own
// slice, those items parsed with no locationId — and checkout then had no real
// serving location to put on `select`, so the route fell back to a placeholder
// id the seller rejects (an ORDER_PROVIDER_LOCATIONS_ID-class NACK). Location
// must resolve against the UNION of a provider's slices.
import { describe, expect, it } from "vitest";
import { parseCatalogs, type CatalogRecord } from "@/lib/shop/types";

function slice(catalog: unknown): CatalogRecord {
  return {
    transactionId: "t1",
    bppId: "seller.easypay.co.in",
    bppUri: "https://seller.easypay.co.in/ecommerce/ondc/seller",
    messageId: "m",
    catalog,
    receivedAt: 0,
  };
}

describe("parseCatalogs — cross-slice provider location", () => {
  it("resolves an item's locationId from a location that arrived in a different on_search slice", () => {
    // Slice A: provider P1 carries an item but NO locations (incremental split).
    const a = slice({
      "bpp/providers": [
        {
          id: "P1",
          items: [
            { id: "I1", descriptor: { name: "Rice" }, price: { value: "100" } },
          ],
        },
      ],
    });
    // Slice B: the SAME provider P1 carrying its serving location, no items.
    const b = slice({
      "bpp/providers": [{ id: "P1", locations: [{ id: "L-EASYPAY-42" }] }],
    });

    const products = parseCatalogs([a, b]);
    expect(products).toHaveLength(1);
    expect(products[0].itemId).toBe("I1");
    // The real serving location must attach even though it lived in slice B —
    // otherwise checkout can only send a placeholder the seller NACKs.
    expect(products[0].locationId).toBe("L-EASYPAY-42");
  });

  it("resolves regardless of slice order (location slice first)", () => {
    const loc = slice({
      "bpp/providers": [{ id: "P1", locations: [{ id: "L-EASYPAY-42" }] }],
    });
    const items = slice({
      "bpp/providers": [
        {
          id: "P1",
          items: [
            { id: "I1", descriptor: { name: "Rice" }, price: { value: "100" } },
          ],
        },
      ],
    });
    const products = parseCatalogs([loc, items]);
    expect(products[0].locationId).toBe("L-EASYPAY-42");
  });

  it("prefers an item's own location_id over the provider fallback", () => {
    const a = slice({
      "bpp/providers": [
        {
          id: "P1",
          locations: [{ id: "L-DEFAULT" }],
          items: [
            {
              id: "I1",
              location_id: "L-ITEM",
              descriptor: { name: "Rice" },
              price: { value: "100" },
            },
          ],
        },
      ],
    });
    expect(parseCatalogs([a])[0].locationId).toBe("L-ITEM");
  });

  it("leaves locationId undefined when the provider truly has no location anywhere", () => {
    const a = slice({
      "bpp/providers": [
        {
          id: "P1",
          items: [
            { id: "I1", descriptor: { name: "Rice" }, price: { value: "100" } },
          ],
        },
      ],
    });
    expect(parseCatalogs([a])[0].locationId).toBeUndefined();
  });
});
