// Buyer-app domain types + ONDC catalog parsing.
//
// The backend stores opaque ONDC payloads; the UI needs flat, display-friendly
// shapes. This module owns BOTH the wire-ish types we read from
// /api/shop/state AND the parser that flattens an ONDC catalog into Product[]
// the cards render. Keeping the parsing here means every screen reads the same
// normalized shape.

/* -- Normalized display types ----------------------------------------------- */

export type Product = {
  // Identity needed to drive select → init → confirm against the right BPP.
  bppId: string;
  bppUri: string;
  providerId: string;
  providerName: string;
  itemId: string;
  locationId?: string;
  // ONDC retail domain this item was discovered in (e.g. fashion "ONDC:RET12").
  // Stamped from the active search domain when added to cart, so the order
  // lifecycle (select→confirm, track, cancel) routes on the same domain. Absent →
  // the app's primary/grocery domain.
  domain?: string;

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

/* -- /api/shop/state response shape ----------------------------------------- */

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
  shortDesc?: string;
  longDesc?: string;
  actions: {
    actor: "complainant" | "respondent";
    action: string;
    shortDesc?: string;
    updatedAt: string;
    images?: { url: string; size_type?: string }[];
    raw: unknown;
  }[];
  resolution?: unknown;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  processingStartedAt?: number;
  resolutionProposedAt?: number;
};

export type ShopState = {
  transactionId: string;
  catalogs: CatalogRecord[];
  bpps: BppState[];
  issues: IssueRecord[];
};

/* -- Catalog parsing -------------------------------------------------------- */

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

  // Pre-index each provider's first serving location across ALL slices, keyed by
  // (bppId, providerId). An incremental on_search can split a provider's
  // `locations` into a DIFFERENT message than its `items` (parseProviders already
  // merges providers across slices this way). Resolving location only within the
  // slice an item arrives in would leave items from a locations-less slice with
  // no locationId — and checkout then has no real serving location to send on
  // `select`, so the route falls back to a placeholder id the seller rejects
  // (an ORDER_PROVIDER_LOCATIONS_ID-class NACK → the checkout dead-end). Indexing
  // over the union of a provider's slices keeps the real location id attached.
  const providerLocation = new Map<string, string>();
  for (const rec of catalogs) {
    for (const pRaw of arr(obj(rec.catalog)["bpp/providers"])) {
      const p = obj(pRaw);
      const key = `${rec.bppId}|${str(p.id) ?? ""}`;
      if (providerLocation.has(key)) continue;
      const locId = str(arr(p.locations).map((l) => obj(l))[0]?.id);
      if (locId) providerLocation.set(key, locId);
    }
  }

  for (const rec of catalogs) {
    const cat = obj(rec.catalog);
    const providers = arr(cat["bpp/providers"]);

    for (const pRaw of providers) {
      const p = obj(pRaw);
      const providerId = str(p.id) ?? "";
      const providerName =
        str(obj(p.descriptor).name) ?? providerId ?? "Seller";

      // Resolve this provider's serving location: prefer a location present in
      // THIS slice, else one seen in any other slice of the same provider (the
      // cross-slice index above). Items still override with their own location_id.
      const locations = arr(p.locations).map((l) => obj(l));
      const firstLocationId =
        str(locations[0]?.id) ?? providerLocation.get(`${rec.bppId}|${providerId}`);

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

/* -- Quote + order parsing -------------------------------------------------- */

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

/* -- Search filters (client-side over the live catalog) --------------------- */

export type ShopSort = "relevance" | "price_low" | "price_high";
export type ShopFilters = { sort?: ShopSort; maxPrice?: number };

// Sensible upper bound for the price slider, derived from the live results.
export function priceCeiling(products: Product[]): number {
  const max = products.reduce((m, p) => Math.max(m, p.price), 0);
  return Math.max(100, Math.ceil(max / 50) * 50);
}

// Case-insensitive relevance match of the live catalog against the user's search
// query. ONDC sellers answer a `search` intent with their FULL catalog (the
// network doesn't guarantee item-level matching), so the buyer app narrows the
// results client-side. A product matches when EVERY query token appears (as a
// substring) somewhere across its searchable fields, so a multi-word query like
// "basmati rice" still matches "Rice — Basmati" regardless of word order.
// Matched on: product name + descriptor (primary), category id + seller/provider
// name (secondary). An empty query is a no-op (returns the input unchanged).
export function filterByQuery(products: Product[], query: string): Product[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return products;
  return products.filter((p) => {
    const haystack = [p.name, p.description, p.categoryId, p.providerName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

// Pure client-side filter + sort over the parsed ONDC catalog. No mock logic:
// it only uses fields ONDC reliably provides (price). "relevance" preserves the
// order sellers returned.
export function filterAndSortProducts(
  products: Product[],
  f: ShopFilters
): Product[] {
  let out = products;
  if (f.maxPrice != null) out = out.filter((p) => p.price <= f.maxPrice!);
  if (f.sort === "price_low") out = [...out].sort((a, b) => a.price - b.price);
  else if (f.sort === "price_high")
    out = [...out].sort((a, b) => b.price - a.price);
  return out;
}

export function activeFilterCount(f: ShopFilters): number {
  return (
    (f.maxPrice != null ? 1 : 0) +
    (f.sort && f.sort !== "relevance" ? 1 : 0)
  );
}

/* -- Fulfillment options (from the on_select quote) ------------------------- */

export type FulfillmentOption = {
  id: string;
  type: "Delivery" | "Self-Pickup" | "Buyer-Delivery" | string;
  // Human label for the option category (e.g. "Standard Delivery").
  category?: string;
  // Turn-around / promised time, ISO-8601 duration or text (e.g. "PT45M").
  tat?: string;
  // A delivery-slot label when the seller advertises scheduled windows
  // (Slotted Delivery). Empty for immediate/standard delivery.
  slotLabel?: string;
  // Whether this option carries a schedule (slotted) vs immediate.
  slotted: boolean;
};

const FULFILLMENT_TYPE_LABELS: Record<string, string> = {
  Delivery: "Home delivery",
  "Self-Pickup": "Self pickup",
  "Buyer-Delivery": "Self-arranged delivery",
};

// Humanize an ISO-8601 duration like "PT45M" / "P1D" into "45 min" / "1 day".
function humanizeTat(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(raw.trim());
  if (!m) return raw;
  const [, d, h, min] = m;
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === "1" ? "" : "s"}`);
  if (h) parts.push(`${h} hr`);
  if (min) parts.push(`${min} min`);
  return parts.length ? parts.join(" ") : raw;
}

// Read the seller's offered fulfillment options from the on_select quote record
// (or an order). Tolerant of the QuoteRecord wrapper ({fulfillments}), a raw
// order ({fulfillments}), or a bare array. Drives the checkout fulfillment
// chooser (Delivery / Self-Pickup / Buyer-Delivery) and Slotted Delivery.
export function parseFulfillmentOptions(source: unknown): FulfillmentOption[] {
  const root = obj(source);
  const list = Array.isArray(source)
    ? source
    : arr(root.fulfillments).length
      ? arr(root.fulfillments)
      : arr(obj(root.quote).fulfillments);

  const seen = new Set<string>();
  const out: FulfillmentOption[] = [];
  for (const fRaw of list) {
    const f = obj(fRaw);
    const id = str(f.id);
    const type = str(f.type) ?? "Delivery";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const time = obj(f.time);
    const schedule = obj(time.schedule);
    const tat = str(f["@ondc/org/TAT"]) ?? str(time.duration) ?? str(f.tat);
    // A scheduled window → slotted delivery. Surface the first range/time.
    const times = arr(schedule.times);
    const range = obj(time.range);
    const slotLabel =
      str(times[0]) ??
      (str(range.start) && str(range.end)
        ? `${str(range.start)} – ${str(range.end)}`
        : undefined);

    out.push({
      id,
      type,
      category:
        str(obj(f.descriptor).name) ?? FULFILLMENT_TYPE_LABELS[type] ?? type,
      tat: humanizeTat(tat),
      slotLabel,
      slotted: Boolean(slotLabel) || arr(schedule.times).length > 0,
    });
  }
  return out;
}

/* -- Payment terms (from the on_init order) --------------------------------- */

export type PaymentOption = {
  type: string; // PRE-FULFILLMENT | ON-FULFILLMENT | POST-FULFILLMENT | ON-ORDER
  collectedBy?: string; // BAP | BPP
  isCOD: boolean;
  label: string;
};

// Read payment terms the seller offered in on_init (order.payments[] / payment).
// COD = collected at/after fulfillment (ON-FULFILLMENT / POST-FULFILLMENT).
export function parsePaymentTerms(order: OrderRecord | null | undefined): PaymentOption[] {
  if (!order) return [];
  const o = obj(order.order);
  const list = arr(order.payments).length
    ? arr(order.payments)
    : arr(o.payments).length
      ? arr(o.payments)
      : o.payment
        ? [o.payment]
        : [];

  const out: PaymentOption[] = [];
  for (const pRaw of list) {
    const p = obj(pRaw);
    const type = str(p.type) ?? "ON-ORDER";
    const collectedBy = str(p.collected_by);
    const isCOD = type === "ON-FULFILLMENT" || type === "POST-FULFILLMENT";
    out.push({
      type,
      collectedBy,
      isCOD,
      label: isCOD ? "Cash on delivery" : "Pay now",
    });
  }
  return out;
}

/* -- Order fulfillments (multi-fulfillment + per-shipment tracking) ---------- */

export type OrderFulfillment = {
  id?: string;
  type?: string;
  state?: string;
  trackingUrl?: string;
  agentName?: string;
  isRTO: boolean;
};

const FULFILLMENT_STATE = (f: AnyObj): string | undefined => {
  const state = obj(f.state);
  return (
    str(obj(state.descriptor).name) ??
    str(state.descriptor && obj(state.descriptor).code) ??
    str(f.status)
  );
};

// Flatten an order's fulfillments for display (multi-fulfillment aware). Detects
// RTO fulfillments (type "RTO" or an RTO state) so the UI can label returns-to-
// origin distinctly.
export function parseOrderFulfillments(
  order: OrderRecord | null | undefined
): OrderFulfillment[] {
  if (!order) return [];
  const fromOrder = arr(obj(order.order).fulfillments);
  const list = arr(order.fulfillments).length ? arr(order.fulfillments) : fromOrder;
  return list.map((fRaw) => {
    const f = obj(fRaw);
    const type = str(f.type);
    const state = FULFILLMENT_STATE(f);
    const tracking = obj(f.tracking);
    const agent = obj(f.agent);
    return {
      id: str(f.id),
      type,
      state,
      trackingUrl: str(f["@ondc/org/tracking_url"]) ?? str(tracking.url),
      agentName: str(agent.name),
      isRTO: type === "RTO" || /rto|return to origin/i.test(state ?? ""),
    };
  });
}

/* -- Unified order timeline ------------------------------------------------- */

export type TimelineEvent = {
  label: string;
  sublabel?: string;
  at?: number;
  kind: "order" | "fulfillment" | "cancel" | "refund" | "return" | "replacement" | "rto";
  done: boolean;
};

const STATE_TO_LABEL = (s: string): string => {
  const map: Record<string, string> = {
    Created: "Order created",
    Accepted: "Accepted by seller",
    "In-progress": "Being prepared",
    Packed: "Packed",
    "Out-for-delivery": "Out for delivery",
    Completed: "Delivered",
    Delivered: "Delivered",
    Cancelled: "Cancelled",
  };
  return map[s] ?? s;
};

// Derive a human, chronological timeline from the order's statusHistory plus its
// fulfillment states, cancellation and refund (quote_trail). Defensive — returns
// whatever is reliably present; never throws.
export function buildOrderTimeline(
  order: OrderRecord | null | undefined
): TimelineEvent[] {
  if (!order) return [];
  const events: TimelineEvent[] = [];

  if (order.createdAt) {
    events.push({
      label: "Order placed",
      at: order.createdAt,
      kind: "order",
      done: true,
    });
  }

  for (const h of order.statusHistory ?? []) {
    const s = typeof h.state === "string" ? h.state : str(obj(h.state).descriptor && obj(obj(h.state).descriptor).name);
    if (!s) continue;
    events.push({
      label: STATE_TO_LABEL(s),
      at: h.at,
      kind: s === "Cancelled" ? "cancel" : "fulfillment",
      done: true,
    });
  }

  // RTO detection from fulfillments.
  for (const f of parseOrderFulfillments(order)) {
    if (f.isRTO) {
      events.push({
        label: "Return to origin (RTO)",
        sublabel: f.state,
        kind: "rto",
        done: true,
      });
    }
  }

  // Cancellation + refund.
  if (order.cancellation) {
    const c = obj(order.cancellation);
    events.push({
      label: "Cancellation processed",
      sublabel: str(obj(c.reason).descriptor && obj(obj(c.reason).descriptor).name),
      kind: "cancel",
      done: true,
    });
  }
  const refund = parseRefund(order);
  if (refund) {
    events.push({
      label: "Refund initiated",
      sublabel: refund.lines.length
        ? `${refund.lines.length} adjustment${refund.lines.length === 1 ? "" : "s"}`
        : undefined,
      kind: "refund",
      done: true,
    });
  }

  // De-dup consecutive same labels; keep chronological where `at` is present.
  const sorted = events.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return sorted.filter(
    (e, i) => i === 0 || e.label !== sorted[i - 1].label
  );
}

/* -- Refund (from on_cancel/on_update quote_trail) -------------------------- */

export type RefundLine = { title: string; amount: number; currency: string };
export type ParsedRefund = { total: number; currency: string; lines: RefundLine[] };

// Read refund/settlement adjustments from the order's quote_trail tags (ONDC
// emits these on on_cancel/on_update for RTO / part-cancel / return refunds).
export function parseRefund(order: OrderRecord | null | undefined): ParsedRefund | null {
  if (!order) return null;
  const o = obj(order.order);
  const quote = obj(order.quote || o.quote);
  // quote_trail lives in the order/fulfillment tags as a group with code
  // "quote_trail"; entries carry a title + price.
  const tagGroups = [
    ...arr(o.tags),
    ...arr(quote.tags),
    ...arr(obj(order.cancellation).tags),
  ].map(obj);
  const trail = tagGroups.find((g) => str(g.code) === "quote_trail");
  if (!trail) return null;

  const lines: RefundLine[] = [];
  let currency = "INR";
  for (const lRaw of arr(trail.list)) {
    const l = obj(lRaw);
    // quote_trail list entries are {code, value} pairs; the value is an amount.
    const code = str(l.code);
    const value = num(l.value);
    if (code && value != null && !/type|currency/i.test(code)) {
      lines.push({ title: code.replace(/_/g, " "), amount: value, currency });
    }
    if (str(l.code) === "currency" && str(l.value)) currency = str(l.value)!;
  }
  if (!lines.length) return null;
  return {
    total: lines.reduce((s, l) => s + l.amount, 0),
    currency,
    lines,
  };
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

/* -- Seller (provider) profile ---------------------------------------------- */

// A seller's storefront identity — richer than the per-Product `providerName`
// the cards carry. Sourced from the ONDC provider `descriptor` + first location
// so a seller profile page can render a header (logo, area, rating). Item lists
// come from Product[] (see itemsForProvider) — a seller answers `search` with
// their whole catalog, so every item is already present.
export type Seller = {
  bppId: string;
  bppUri: string;
  providerId: string;
  name: string;
  image?: string; // provider logo (descriptor.symbol / first image)
  shortDesc?: string;
  rating?: number;
  locality?: string; // human place label from the seller's first location
  city?: string;
  areaCode?: string;
  gps?: string; // "lat,long" of the seller's first location — drives distance sort
};

// Extract each seller (provider) once from the accumulated catalog slices,
// merging fields across slices (an incremental on_search can split a provider
// across messages). Keyed by (bppId, providerId).
export function parseProviders(catalogs: CatalogRecord[]): Seller[] {
  const byKey = new Map<string, Seller>();

  for (const rec of catalogs) {
    const cat = obj(rec.catalog);
    for (const pRaw of arr(cat["bpp/providers"])) {
      const p = obj(pRaw);
      const providerId = str(p.id) ?? "";
      const key = `${rec.bppId}|${providerId}`;

      const d = obj(p.descriptor);
      const images = arr(d.images);
      const image =
        str(d.symbol) ?? str(images[0]) ?? str(obj(images[0]).url);

      const loc = obj(arr(p.locations)[0]);
      const addr = obj(loc.address);

      const next: Seller = {
        bppId: rec.bppId,
        bppUri: rec.bppUri,
        providerId,
        name: str(d.name) ?? providerId ?? "Seller",
        image,
        shortDesc: str(d.short_desc) ?? str(d.long_desc),
        rating: num(p.rating),
        locality: str(addr.locality) ?? str(addr.street),
        city: str(addr.city) ?? str(addr.state_district),
        areaCode: str(addr.area_code) ?? str(loc.area_code),
        gps: str(loc.gps),
      };

      const prev = byKey.get(key);
      byKey.set(
        key,
        prev
          ? {
              ...prev,
              image: prev.image ?? next.image,
              shortDesc: prev.shortDesc ?? next.shortDesc,
              rating: prev.rating ?? next.rating,
              locality: prev.locality ?? next.locality,
              city: prev.city ?? next.city,
              areaCode: prev.areaCode ?? next.areaCode,
              gps: prev.gps ?? next.gps,
            }
          : next
      );
    }
  }

  return [...byKey.values()];
}

// Find a single seller by identity from the catalog slices.
export function findSeller(
  catalogs: CatalogRecord[],
  bppId: string,
  providerId: string
): Seller | undefined {
  return parseProviders(catalogs).find(
    (s) => s.bppId === bppId && s.providerId === providerId
  );
}

// Every product a given seller (provider) offers, from the parsed catalog.
export function itemsForProvider(
  products: Product[],
  bppId: string,
  providerId: string
): Product[] {
  return products.filter(
    (p) => p.bppId === bppId && p.providerId === providerId
  );
}

/* -- Distance (sort sellers by proximity) ----------------------------------- */

// Parse an ONDC "lat,long" gps string (the shape carried in fulfillment /
// location.gps) into a coordinate, or null when absent/malformed. Tolerates
// surrounding whitespace; rejects out-of-range values so a typo can't sort to
// the top.
export function parseGps(gps?: string): { lat: number; lng: number } | null {
  if (!gps) return null;
  const parts = gps.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Great-circle distance in km between two coordinates (haversine). Good enough
// for "nearest seller" ordering at city scale — we sort by it, not bill on it.
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371; // mean Earth radius, km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Distance from a reference gps to a seller's location, or undefined when either
// coordinate is missing/invalid. Used to sort a seller list nearest-first and to
// render a "x.y km away" chip.
export function sellerDistanceKm(
  seller: Pick<Seller, "gps">,
  fromGps?: string
): number | undefined {
  const from = parseGps(fromGps);
  const to = parseGps(seller.gps);
  if (!from || !to) return undefined;
  return haversineKm(from, to);
}

// A seller with its computed distance from the reference point (undefined when
// unknown), the shape the browse/list surfaces render.
export type SellerWithDistance = Seller & { distanceKm?: number };

// Order sellers nearest-first from a reference gps. Sellers whose distance can't
// be computed (no gps on either side) sink to the bottom, ordered by name so the
// list stays stable. With no reference point, falls back to a plain name sort —
// so the same function drives both "located" and "no location set" states.
export function sortSellersByDistance(
  sellers: Seller[],
  fromGps?: string
): SellerWithDistance[] {
  return sellers
    .map((s) => ({ ...s, distanceKm: sellerDistanceKm(s, fromGps) }))
    .sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) {
        return a.distanceKm - b.distanceKm || a.name.localeCompare(b.name);
      }
      if (a.distanceKm != null) return -1; // known distance sorts before unknown
      if (b.distanceKm != null) return 1;
      return a.name.localeCompare(b.name);
    });
}

// Compact "2.4 km" / "800 m" label for a distance chip, or undefined.
export function formatDistance(km?: number): string | undefined {
  if (km == null || !Number.isFinite(km)) return undefined;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
