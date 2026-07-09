// Payment ledger — backend dispatcher (mirrors src/lib/ondc/store.ts).
//
// Routes import createPayment / getPayment / listPayments / … from HERE. The
// actual implementation is picked ONCE at module load based on whether
// DATABASE_URL is set:
//   * store-db.ts   → Postgres (shared across serverless instances) — the
//     production path, and what makes the admin reconcile console's payment
//     list complete + consistent.
//   * store-json.ts → per-instance /tmp JSON snapshot — the fallback when no
//     database is configured (local dev / unconfigured deploys).
import "server-only";

export type {
  PaymentRecord,
  CreatePaymentInput,
  UpdatePaymentStatusInput,
} from "@/lib/payments/store-json";
export { PaymentStoreError, paymentReferenceFor } from "@/lib/payments/store-json";

import { isDatabaseConfigured } from "@/lib/db";
import * as jsonBackend from "@/lib/payments/store-json";
import * as dbBackend from "@/lib/payments/store-db";

// One-shot selection at module load — same rationale as the ONDC store: zero
// per-call overhead and no risk of flipping backends mid-process.
const backend = isDatabaseConfigured() ? dbBackend : jsonBackend;

export const createPayment = backend.createPayment;
export const updatePaymentStatus = backend.updatePaymentStatus;
export const getPayment = backend.getPayment;
export const getPaymentByReference = backend.getPaymentByReference;
export const listPayments = backend.listPayments;
