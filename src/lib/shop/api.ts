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

/* ── Discovery ────────────────────────────────────────────────────────────── */

export function search(body: {
  query?: string;
  category?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
  transactionId?: string;
  incremental?: boolean;
  targetUrl?: string;
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/search", body);
}

export function getState(transactionId: string): Promise<ShopState> {
  return getJSON<ShopState>(
    `/api/shop/state?transactionId=${encodeURIComponent(transactionId)}`
  );
}

// Imperatively poll getState until `predicate` is satisfied (the awaited ONDC
// callback has landed) or `maxMs` elapses. Returns the latest state either way
// — callers re-check the predicate to distinguish success from timeout. Used to
// sequence select → init → confirm, each of which completes asynchronously.
export async function waitFor(
  transactionId: string,
  predicate: (s: ShopState) => boolean,
  opts: { intervalMs?: number; maxMs?: number } = {}
): Promise<ShopState> {
  const { intervalMs = 2000, maxMs = 30_000 } = opts;
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let s: ShopState;
    try {
      s = await getState(transactionId);
    } catch {
      s = { transactionId, catalogs: [], bpps: [], issues: [] };
    }
    if (predicate(s)) return s;
    if (Date.now() - start > maxMs) return s;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ── Order lifecycle ──────────────────────────────────────────────────────── */

export type SelectItem = {
  id: string;
  quantity: number;
  locationId?: string;
};

export function select(body: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  providerId: string;
  items: SelectItem[];
  fulfillment?: {
    type?: "Delivery" | "Self-Pickup" | "Buyer-Delivery";
    gps?: string;
    areaCode?: string;
  };
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
  fulfillment?: {
    type?: "Delivery" | "Self-Pickup" | "Buyer-Delivery";
    gps?: string;
    areaCode?: string;
  };
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

/* ── IGM ──────────────────────────────────────────────────────────────────── */

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
}): Promise<AckEnvelope> {
  return postJSON<AckEnvelope>("/api/ondc/issue", body);
}

/* ── Payments (out-of-band settlement) ────────────────────────────────────── */

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
