// Tocxi Partner API — wire contract types.
//
// These mirror the request/response shapes documented at
// https://www.tocxi.com/partner-api.html exactly (field names are the wire
// names — camelCase, as Tocxi sends/expects). Shared by the outbound client
// (src/lib/logistics/client.ts), the API routes, and the persistence layer so a
// single definition drives the whole module.

// Parcel size band. SMALL is the API default when omitted on create.
export type ParcelSize = "SMALL" | "MEDIUM" | "LARGE";

// The shipment lifecycle. The first six are the happy-path progression; the last
// two are terminal exceptions.
//
//   PENDING → CONFIRMED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
//   terminal exceptions: CANCELLED, FAILED
export type ShipmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

// The ordered happy path, used to reason about progression (e.g. ignore an
// out-of-order webhook that would move a shipment backwards). Terminal
// exceptions are deliberately NOT in this list — they can arrive from any state.
export const SHIPMENT_STATUS_ORDER: readonly ShipmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

// Terminal states — no further transitions are expected once here.
export const TERMINAL_STATUSES: readonly ShipmentStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "FAILED",
] as const;

// Every valid status value (happy path + terminal), for runtime validation of
// wire/webhook payloads.
const ALL_STATUSES: readonly string[] = [
  ...SHIPMENT_STATUS_ORDER,
  ...TERMINAL_STATUSES.filter((s) => s !== "DELIVERED"), // DELIVERED already in order
];

export function isShipmentStatus(v: unknown): v is ShipmentStatus {
  return typeof v === "string" && ALL_STATUSES.includes(v);
}

// ---------------------------------------------------------------------------
// Serviceability & quote — POST /serviceability and POST /quote share this shape.
// ---------------------------------------------------------------------------

export type QuoteRequest = {
  pickupLatitude: number;
  pickupLongitude: number;
  dropLatitude: number;
  dropLongitude: number;
  parcelSize?: ParcelSize;
  weightKg?: number;
  // COD is required for the pilot (COD orders only). codAmount is the amount the
  // rider collects on delivery.
  cod?: boolean;
  codAmount?: number;
};

export type QuoteResponse = {
  serviceable: boolean;
  totalPrice: number;
  codFee: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  currency: string; // "INR" for the pilot
};

// ---------------------------------------------------------------------------
// Create a shipment — POST /shipments (with an Idempotency-Key header).
// ---------------------------------------------------------------------------

// A pickup or drop endpoint. contactName, contactPhone, latitude and longitude
// are required by Tocxi; addressLine and pincode are recommended for the rider.
export type Address = {
  contactName: string;
  contactPhone: string;
  addressLine?: string;
  pincode?: string;
  latitude: number;
  longitude: number;
};

export type CreateShipmentRequest = {
  // Our order id — echoed back in the response and in every webhook. Also used
  // as the Idempotency-Key so a retry never double-books.
  partnerReference?: string;
  pickup: Address;
  drop: Address;
  packageDescription?: string;
  parcelSize?: ParcelSize;
  weightKg?: number;
  // A declared value marks the shipment insured.
  declaredValue?: number;
  // COD is required for the pilot.
  cod?: boolean;
  codAmount?: number;
};

// The 201 CREATED body Tocxi returns on a successful booking. status is always
// PENDING on a fresh create.
export type ShipmentResponse = {
  shipmentId: string;
  partnerReference?: string;
  status: ShipmentStatus;
  estimatedPrice?: number;
  trackingUrl?: string;
  // Air-waybill number, populated once the shipment is confirmed/picked up. Not
  // present on the initial create response but flows in via webhooks and GET.
  awbNo?: string;
};

// GET /shipments?page&size returns a paginated envelope. Tocxi's exact envelope
// shape isn't fully pinned in the guide, so we type the fields we rely on and
// keep the rest opaque.
export type ShipmentListResponse = {
  content: ShipmentResponse[];
  page?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
};

// ---------------------------------------------------------------------------
// Inbound webhook — POST to our registered URL on every status change.
// ---------------------------------------------------------------------------

export type WebhookEvent = {
  event: "shipment.status";
  shipmentId: string;
  partnerReference?: string;
  status: ShipmentStatus;
  awbNo?: string;
  // ISO-8601 timestamp of the status change, e.g. "2026-07-29T17:05:11".
  timestamp?: string;
};

// The auth error codes Tocxi returns on the /partner/** surface. Carried on
// TocxiError so callers can branch on the machine code, not the HTTP status
// alone.
export type TocxiErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "PARTNER_SUSPENDED"
  | "RATE_LIMITED"
  | string;
