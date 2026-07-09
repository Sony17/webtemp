// ONDC BAP persistence — backend dispatcher.
//
// The 10 on_* callback routes import `saveCatalog`, `getOrder`, … from THIS
// module. The actual implementation lives in one of two backends:
//
//   * store-json.ts → file/blob JSON snapshot. The original implementation;
//     still the default and the only path that runs without a database.
//   * store-db.ts   → Postgres via Prisma (4 tables: ondc_search,
//     ondc_search_result, ondc_order, ondc_event). The production target.
//
// The pick is made ONCE per process: at module load we read
// `isDatabaseConfigured()` (whether DATABASE_URL is set) and bind every
// exported function to that backend's implementation. There's no per-call
// branching — once chosen, the backend stays chosen for the process lifetime.
//
// Types live in store-types.ts and are re-exported here so callsites can
// continue writing `import type { CatalogRecord } from "@/lib/ondc/store"`
// regardless of backend.
import "server-only";

export type {
  CatalogRecord,
  OrderRecord,
  OrderStage,
  OrderStatusSnapshot,
  QuoteRecord,
  RatingRecord,
  SaveCancelInput,
  SaveCatalogInput,
  SaveConfirmOrderInput,
  SaveInitOrderInput,
  SaveQuoteInput,
  SaveRatingInput,
  SaveStatusUpdateInput,
  SaveSupportInput,
  SaveTrackingInput,
  SaveUpdateOrderInput,
  SupportRecord,
  IssueRecord,
  IssueActionEntry,
  SaveIssueInput,
} from "@/lib/ondc/store-types";
export { OndcStoreError } from "@/lib/ondc/store-types";

import { isDatabaseConfigured } from "@/lib/db";
import * as jsonBackend from "@/lib/ondc/store-json";
import * as dbBackend from "@/lib/ondc/store-db";

// One-shot backend selection. Captured at module load so the call sites have
// zero per-call overhead and so a misconfigured env can't flip backends
// mid-process (which would risk reading from one store and writing to
// another). Tests that need to switch backends restart the worker.
const backend = isDatabaseConfigured() ? dbBackend : jsonBackend;

// Writes ---------------------------------------------------------------------
export const saveCatalog = backend.saveCatalog;
export const saveQuote = backend.saveQuote;
export const saveInitOrder = backend.saveInitOrder;
export const saveConfirmOrder = backend.saveConfirmOrder;
export const saveStatusUpdate = backend.saveStatusUpdate;
export const saveTrackingUpdate = backend.saveTrackingUpdate;
export const saveCancelUpdate = backend.saveCancelUpdate;
export const saveUpdateOrder = backend.saveUpdateOrder;
export const saveSupport = backend.saveSupport;
export const saveRating = backend.saveRating;
export const saveIssue = backend.saveIssue;

// Reads ----------------------------------------------------------------------
export const getCatalogs = backend.getCatalogs;
export const getQuote = backend.getQuote;
export const getOrder = backend.getOrder;
export const getOrderById = backend.getOrderById;
export const getSupport = backend.getSupport;
export const getRating = backend.getRating;
export const getIssue = backend.getIssue;
export const getIssuesByTransaction = backend.getIssuesByTransaction;

// Admin dashboard: cross-transaction lists + counts.
export const listOrders = backend.listOrders;
export const listIssues = backend.listIssues;
export const countTransactions = backend.countTransactions;
