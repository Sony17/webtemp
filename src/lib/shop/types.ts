// Buyer-app domain types + ONDC catalog parsing.
//
// The backend stores opaque ONDC payloads; the UI needs flat, display-friendly
// shapes. This module owns BOTH the wire-ish types we read from
// /api/shop/state AND the parser that flattens an ONDC catalog into Product[]
// the cards render. Keeping the parsing here means every screen reads the same
// normalized shape.

/* ── Normalized display types ─────────────────────────────────────────────── */

export type Product = {
  // Identity needed to drive select → init → confirm against the right BPP.
  bppId: string;
  bppUri: string;
  providerId: string;
  providerName: string;
  itemId: string;
  locationId?: string;

  name: string;
  description?: string;
  image?: string;
  categoryId?: string;

  price: number; // selling price
  maxPrice?: number; // MRP (price.maximum_value)
  currency: string;
  unit?: string; // e.g. "1 kg", "500 g"
  available?: boolean;
  rating?: number;
};

// A seller (provider) offering an item — used on the seller-selection screen
// where the same item can come from multiple BPPs/providers at different prices.
export type SellerOffer = {
  bppId: string;
  bppUri: string;
  providerId: string;
  providerName: string;
  itemId: string;
  locationId?: string;
  price: number;
  maxPrice?: number;
  currency: string;
  rating?: number;
};

/* ── /api/shop/state response shape ───────────────────────────────────────── */

export type CatalogRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  catalog: unknown;
  receivedAt: number;
};

export type BppState = {
  bppId: string;
  bppUri: string;
  quote: unknown | null;
  order: OrderRecord | null;
  support: unknown | null;
  rating: unknown | null;
};

export type OrderRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId?: string;
  state?: unknown;
  order: unknown;
  quote: unknown;
  payments?: unknown;
  fulfillments: unknown;
  tracking?: unknown;
  cancellation?: unknown;
  stage: "init" | "confirm" | "status" | "track" | "cancel" | "update";
  messageId: string;
  statusHistory: { state: unknown; messageId: string; at: number }[];
  createdAt: number;
  updatedAt: number;
};

export type IssueRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  issueId: string;
  category?: string;
  subCategory?: string;
  orderId?: string;
  status: string;
  actions: {
    actor: "complainant" | "respondent";
    action: string;
    shortDesc?: string;
    updatedAt: string;
    raw: unknown;
  }[];
  resolution?: unknown;
  createdAt: number;
  updatedAt: number;
};

export type ShopState = {
  transactionId: string;
  catalogs: CatalogRecord[];
  bpps: BppState[];
  issues: IssueRecord[];
};

/* ── Catalog parsing ──────────────────────────────────────────────────────── */

type AnyObj = Record<string, unknown>;
const obj = (v: unknown): AnyObj => (v && typeof v === "object" ? (v as AnyObj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// Flatten the ONDC catalog records (one per BPP slice) into Product[]. Tolerant
// of missing fields — ONDC catalogs vary by seller; we surface what's present.
export function parseCatalogs(catalogs: CatalogRecord[]): Product[] {
  const products: Product[] = [];

  for (const rec of catalogs) {
    const cat = obj(rec.catalog);
    const providers = arr(cat["bpp/providers"]);

    for (const pRaw of providers) {
      const p = obj(pRaw);
      const providerId = str(p.id) ?? "";
      const providerName =
        str(obj(p.descriptor).name) ?? providerId ?? "Seller";

      // Index provider locations so an item's location_id resolves to one.
      const locations = arr(p.locations).map((l) => obj(l));
      const firstLocationId = str(locations[0]?.id);

      for (const iRaw of arr(p.items)) {
        const it = obj(iRaw);
        const itemId = str(it.id);
        if (!itemId) continue;

        const desc = obj(it.descriptor);
        const price = obj(it.price);
        const qty = obj(it.quantity);
        const available = obj(qty.available);
        const unitized = obj(obj(qty.unitized).measure);

        const images = arr(desc.images);
        const image =
          str(desc.symbol) ??
          str(images[0]) ??
          str(obj(images[0]).url);

        products.push({
          bppId: rec.bppId,
          bppUri: rec.bppUri,
          providerId,
          providerName,
          itemId,
          locationId: str(it.location_id) ?? firstLocationId,
          name: str(desc.name) ?? itemId,
          description: str(desc.short_desc) ?? str(desc.long_desc),
          image,
          categoryId: str(it.category_id),
          price: num(price.value) ?? 0,
          maxPrice: num(price.maximum_value),
          currency: str(price.currency) ?? "INR",
          unit:
            num(unitized.value) != null
              ? `${num(unitized.value)} ${str(unitized.unit) ?? ""}`.trim()
              : str(available.count)
                ? undefined
                : undefined,
          available:
            num(available.count) != null ? num(available.count)! > 0 : undefined,
        });
      }
    }
  }

  return products;
}

/* ── Quote + order parsing ────────────────────────────────────────────────── */

export type QuoteBreakupLine = {
  title: string;
  price: number;
  currency: string;
  type?: string; // @ondc/org/title_type: item | tax | delivery | discount …
};

export type ParsedQuote = {
  total: number;
  currency: string;
  breakup: QuoteBreakupLine[];
};

// Parse an ONDC `quote` object (from on_select / on_init / order). Tolerant of
// the slightly different envelopes the callbacks store.
export function parseQuote(quote: unknown): ParsedQuote | null {
  if (!quote) return null;
  const root = obj(quote);
  // Some records nest the quote under `quote`; accept either.
  const q = root.price || root.breakup ? root : obj(root.quote);
  const price = obj(q.price);
  const total = num(price.value);
  const currency = str(price.currency) ?? "INR";
  const breakup: QuoteBreakupLine[] = arr(q.breakup).map((bRaw) => {
    const b = obj(bRaw);
    const bp = obj(b.price);
    return {
      title: str(b.title) ?? "—",
      price: num(bp.value) ?? 0,
      currency: str(bp.currency) ?? currency,
      type: str(b["@ondc/org/title_type"]),
    };
  });
  if (total == null && breakup.length === 0) return null;
  return {
    total: total ?? breakup.reduce((s, l) => s + l.price, 0),
    currency,
    breakup,
  };
}

// Extract a human order state ("Created", "Accepted", "In-progress",
// "Completed", "Cancelled") from an OrderRecord's opaque state/order.
export function orderState(order: OrderRecord | null | undefined): string {
  if (!order) return "Unknown";
  if (typeof order.state === "string") return order.state;
  const o = obj(order.order);
  return str(o.state) ?? str(obj(order.state).descriptor && obj(obj(order.state).descriptor).name) ?? "Created";
}

// Pull a tracking URL (if any) from an order's stored tracking payload.
export function trackingUrl(order: OrderRecord | null | undefined): string | undefined {
  if (!order?.tracking) return undefined;
  const t = obj(order.tracking);
  return str(t.url) ?? str(obj(t.location).gps);
}

// Group offers of the "same" item across sellers by item name (case-insensitive)
// so the seller-selection screen can compare prices. ONDC has no global SKU, so
// name-match is the pragmatic join key for a buyer app.
export function offersForProduct(
  products: Product[],
  product: Product
): SellerOffer[] {
  const key = product.name.trim().toLowerCase();
  return products
    .filter((p) => p.name.trim().toLowerCase() === key)
    .map((p) => ({
      bppId: p.bppId,
      bppUri: p.bppUri,
      providerId: p.providerId,
      providerName: p.providerName,
      itemId: p.itemId,
      locationId: p.locationId,
      price: p.price,
      maxPrice: p.maxPrice,
      currency: p.currency,
      rating: p.rating,
    }))
    .sort((a, b) => a.price - b.price);
}
