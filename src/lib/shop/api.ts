// Buyer-app ONDC API client (browser side).
//
// Thin typed wrappers over the same-origin backend routes. Every buyer action
// POSTs an ergonomic JSON body and gets back an ACK/NACK envelope; the real
// data arrives asynchronously and is read via getState() polling.
import type { ShopState } from "@/lib/shop/types";

export type AckEnvelope = {
  status: "ACK" | "NACK";
  transactionId: string;
  messageId: string;
  error?: { type?: string; code?: string; message?: string; path?: string };
  [k: string]: unknown;
};

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok && !(data as { status?: string }).status) {
    const msg =
      (data as { error?: { message?: string } | string })?.error;
    throw new Error(
      typeof msg === "string"
        ? msg
        : (msg as { message?: string })?.message ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/* -- Discovery -------------------------------------------------------------- */

export function search(body: {
  query?: string;
  category?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
  // Buyer's reverse-geocoded place — carried only so the dev mock catalog can
  // locate its synthetic sellers in the buyer's city (not sent to the network).
  deliveryCity?: string;
  deliveryLocality?: string;
  deliveryState?: string;
  transactionId?: string;
  incremental?: boolean;
  incrementalMode?: "start" | "stop" | "pull";
  targetUrl?: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/search", body);
}

// Optional hint so the read model surfaces THIS bpp's quote/order/support even
// when no on_search catalog slice for it is visible on the serving instance
// (the JSON `/tmp` store fragments across serverless instances). Every post-
// select screen already knows the bpp it cares about, so it passes it here.
export type StateHint = { bppId?: string; bppUri?: string };

export function getState(
  transactionId: string,
  hint: StateHint = {}
): Promise<ShopState> {
  const q = new URLSearchParams({ transactionId });
  if (hint.bppId) q.set("bppId", hint.bppId);
  if (hint.bppUri) q.set("bppUri", hint.bppUri);
  return getJSON<ShopState>(`/api/shop/state?${q.toString()}`);
}

// Imperatively poll getState until `predicate` is satisfied (the awaited ONDC
// callback has landed) or `maxMs` elapses. Returns the latest state either way
// — callers re-check the predicate to distinguish success from timeout. Used to
// sequence select → init → confirm, each of which completes asynchronously.
export async function waitFor(
  transactionId: string,
  predicate: (s: ShopState) => boolean,
  opts: { intervalMs?: number; maxMs?: number } & StateHint = {}
): Promise<ShopState> {
  const { intervalMs = 2000, maxMs = 30_000, bppId, bppUri } = opts;
  const start = Date.now();
  for (;;) {
    let s: ShopState;
    try {
      s = await getState(transactionId, { bppId, bppUri });
    } catch {
      s = { transactionId, catalogs: [], bpps: [], issues: [] };
    }
    if (predicate(s)) return s;
    if (Date.now() - start > maxMs) return s;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* -- Order lifecycle -------------------------------------------------------- */

export type SelectItem = {
  id: string;
  quantity: number;
  locationId?: string;
};

export type FulfillmentInput = {
  // Pin the fulfillment id chosen from the on_select quote (Self-Pickup /
  // Buyer-Delivery / a specific delivery slot bind to a fixed id).
  id?: string;
  type?: "Delivery" | "Self-Pickup" | "Buyer-Delivery";
  gps?: string;
  areaCode?: string;
};

export function select(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  providerId: string;
  items: SelectItem[];
  fulfillment?: FulfillmentInput;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/select", body);
}

export type Billing = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  building?: string;
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
  areaCode?: string;
};

export function init(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  providerId: string;
  items: SelectItem[];
  billing: Billing;
  fulfillment?: FulfillmentInput;
  // Buyer delivery instructions. Threaded through the existing init route in a
  // forward-compatible way (the route ignores unknown fields today); the buyer
  // app also persists/displays it locally. No new endpoint is invented.
  instructions?: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/init", body);
}

export function confirm(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  order?: unknown;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/confirm", body);
}

export function status(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/status", body);
}

export function track(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/track", body);
}

export function cancel(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  cancellationReasonId: string;
  force?: boolean;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/cancel", body);
}

// /update has three ergonomic modes (refund / return / replacement).
export function update(
  body:
    | {
        transactionId: string;
        bppId: string;
        bppUri: string;
        return: {
          orderId: string;
          fulfillmentId?: string;
          itemId?: string;
          quantity?: number;
          reasonId?: string;
          category?: string;
          subCategory?: string;
          images?: string[];
        };
      }
    | {
        transactionId: string;
        bppId: string;
        bppUri: string;
        replacement: {
          orderId: string;
          fulfillmentId?: string;
          itemId?: string;
          quantity?: number;
          reasonId?: string;
          category?: string;
          subCategory?: string;
        };
      }
    | {
        transactionId: string;
        bppId: string;
        bppUri: string;
        refund: { orderId: string };
      }
): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/update", body);
}

export function support(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  refId: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/support", body);
}

export function rating(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  ratings: { id: string; ratingCategory: string; value: number }[];
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/rating", body);
}

/* -- IGM -------------------------------------------------------------------- */

export function openIssue(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  category: string;
  subCategory: string;
  shortDesc: string;
  longDesc: string;
  complainant: { name?: string; phone: string; email?: string };
  images?: { url: string; size_type?: string }[];
}): Promise<AckEnvelope & { issueId?: string }> {
  return postJSON("/api/ondc/issue", body);
}

export function issueAction(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  issueId: string;
  complainantAction:
    | "INFO_PROVIDED"
    | "ESCALATE"
    | "RESOLUTION_ACCEPT"
    | "RESOLUTION_REJECT"
    | "CLOSE";
  actionDesc?: string;
  images?: { url: string; size_type?: string }[];
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/issue", body);
}

/* -- Payments (out-of-band settlement) -------------------------------------- */

export function createPayment(body: {
  transactionId: string;
  orderId?: string;
  amount?: number;
}): Promise<{ transactionId: string; paymentReference: string; status: string }> {
  return postJSON("/api/payments/create", body);
}

export function paymentInstructions(transactionId: string): Promise<{
  transactionId: string;
  paymentReference: string;
  amount?: number;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
  qrCodeUrl?: string;
}> {
  return getJSON(
    `/api/payments/instructions?transactionId=${encodeURIComponent(transactionId)}`
  );
}

export function paymentStatus(transactionId: string): Promise<{
  transactionId: string;
  paymentReference: string;
  status: "PENDING" | "PAID";
  amount?: number;
}> {
  return getJSON(
    `/api/payments/status?transactionId=${encodeURIComponent(transactionId)}`
  );
}
