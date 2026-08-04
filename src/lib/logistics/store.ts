// Logistics shipment ledger — backend dispatcher (mirrors payments/store.ts).
//
// Routes import createShipment / updateShipmentStatus / getShipment / … from
// HERE. The actual implementation is picked ONCE at module load based on whether
// DATABASE_URL is set:
//   * store-db.ts   → Postgres (shared across serverless instances) — the
//     production path, and what makes the admin ops console's shipment list
//     complete + consistent, and lets a webhook received on one instance be read
//     on another.
//   * store-json.ts → per-instance /tmp JSON snapshot — the fallback when no
//     database is configured (local dev / unconfigured deploys).
import "server-only";

export type {
  ShipmentRecord,
  ShipmentStatusEvent,
  CreateShipmentInput,
  UpdateShipmentStatusInput,
} from "@/lib/logistics/store-json";
export {
  ShipmentStoreError,
  shouldAdvanceStatus,
} from "@/lib/logistics/store-json";

import { isDatabaseConfigured } from "@/lib/db";
import * as jsonBackend from "@/lib/logistics/store-json";
import * as dbBackend from "@/lib/logistics/store-db";

// One-shot selection at module load — same rationale as the payments/ONDC
// stores: zero per-call overhead and no risk of flipping backends mid-process.
const backend = isDatabaseConfigured() ? dbBackend : jsonBackend;

export const createShipment = backend.createShipment;
export const updateShipmentStatus = backend.updateShipmentStatus;
export const getShipment = backend.getShipment;
export const getShipmentByReference = backend.getShipmentByReference;
export const getShipmentByTransaction = backend.getShipmentByTransaction;
export const listShipments = backend.listShipments;
