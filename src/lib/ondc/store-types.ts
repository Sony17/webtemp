// ONDC BAP persistence — shared types.
//
// One source of truth for the persistence layer's PUBLIC shape. Both backends
// (the JSON snapshot in store-json.ts and the Postgres one in store-db.ts)
// import from here, so the dispatcher in store.ts can re-export these types
// regardless of which backend ends up running, and a callback route's
// `import type { CatalogRecord } from "@/lib/ondc/store"` stays valid either
// way.
//
// Server-only: keeps these next to the routes' callsites without risk of
// leaking the persistence error class into a client bundle by accident.
import "server-only";

// ---------------------------------------------------------------------------
// Error type — named, like OndcConfigError / OndcClientError.
// ---------------------------------------------------------------------------

// A persistence-layer failure (couldn't write the snapshot or commit a
// transaction). Thrown from the save* functions so the calling route's
// try/catch downgrades to a NACK 500 rather than silently dropping a
// callback. A *read* miss is NOT an error — it returns null/[] (the data
// simply hasn't arrived yet).
export class OndcStoreError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(`ONDC store error: ${message}`, { cause: options.cause });
    this.name = "OndcStoreError";
  }
}

// ---------------------------------------------------------------------------
// Record types (internal, camelCase — the wire is snake_case, the routes have
// already lifted these out into camelCase Extracted* structs).
// ---------------------------------------------------------------------------

// One catalog slice from one BPP for one discovery session. `search` is a
// broadcast, so a single transactionId fans out to N BPPs; a BPP may also send
// incremental refreshes (distinct messageId). We therefore retain every slice
// keyed by (transactionId, bppId, messageId) and accumulate.
export type CatalogRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  catalog: unknown; // opaque ONDC catalog
  receivedAt: number;
};

// The priced quote a BPP returned for a `select`. One per (transactionId,
// bppId); a re-quote replaces it (last-write-wins).
export type QuoteRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  quote: unknown;
  fulfillments: unknown;
  receivedAt: number;
};

// Which lifecycle stage last touched an OrderRecord.
export type OrderStage =
  | "init"
  | "confirm"
  | "status"
  | "track"
  | "cancel"
  | "update";

// One milestone from an on_status callback (packed → picked → delivered …),
// accumulated so the order's progression stays observable.
export type OrderStatusSnapshot = {
  state: unknown;
  messageId: string;
  at: number;
};

// The order, modeled as ONE record per (transactionId, bppId) progressively
// enriched across the lifecycle. See store-json.ts / store-db.ts for the per-
// callback merge rules (last-write-wins on most fields, append-only on
// statusHistory, carry-forward when a later callback doesn't restate a value).
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
  stage: OrderStage;
  messageId: string;
  statusHistory: OrderStatusSnapshot[];
  createdAt: number;
  updatedAt: number;
};

export type SupportRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  phone?: string;
  email?: string;
  uri?: string;
  refId?: string;
  support: unknown;
  receivedAt: number;
};

export type RatingRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  feedbackForm?: unknown;
  feedbackFormUrl?: string;
  feedbackFormMimeType?: string;
  feedbackRequired?: boolean;
  feedbackAck?: boolean;
  ratingAck?: boolean;
  feedback: unknown;
  receivedAt: number;
};

// IGM v2.0.0. One IssueRecord per issue.id, keyed first by (transactionId,
// issueId). The action history (complainant + respondent) is append-only so
// the full lifecycle — OPEN → PROCESSING → NEED_MORE_INFO → INFO_PROVIDED →
// RESOLUTION → RESOLUTION_ACCEPT → RESOLVED → CLOSE — is observable end-to-end.
export type IssueActionEntry = {
  // Whose side took the action.
  actor: "complainant" | "respondent";
  // The wire action code, kept as a free string because IGM keeps adding codes:
  // OPEN, INFO_PROVIDED, ESCALATE, RESOLUTION_ACCEPT, RESOLUTION_REJECT, CLOSE,
  // REOPEN (complainant) — PROCESSING, NEED_MORE_INFO, RESOLUTION_PROPOSED,
  // RESOLVED, CASCADED (respondent).
  action: string;
  shortDesc?: string;
  updatedAt: string;
  // Whole action object retained so any extra fields (updated_by, images,
  // additional_desc) are not lost.
  raw: unknown;
};

export type IssueRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  // Last messageId that touched this issue — outbound (issue) or inbound
  // (on_issue). Always the freshest one seen.
  messageId: string;
  issueId: string;
  category?: string;
  subCategory?: string;
  // Order snapshot at the time of OPEN (carried forward across updates).
  orderId?: string;
  // Last seen status as the BPP reported it (or "OPEN" before any reply).
  status: string;
  // Whether this BAP or the BPP last touched the issue.
  lastTouchedBy?: "complainant" | "respondent";
  // Full action history (chronological).
  actions: IssueActionEntry[];
  // Resolution proposed by the BPP (if any).
  resolution?: unknown;
  // Resolution provider details from on_issue (IGM 2.0: carries GRO info,
  // resolution support contact, and the actual resolution data).
  resolutionProvider?: unknown;
  // IGM v2.0.0: the full array of resolution options from the BPP's on_issue
  // (plural — issue.resolutions[]), carried forward verbatim in buyer's
  // subsequent issue calls (QA: "Resolution attribute is missing").
  resolutions?: unknown[];
  // IGM v2.0.0: resolver participant ids from the BPP's on_issue.
  resolverIds?: string[];
  // Full last opaque issue object retained for debugging.
  issue: unknown;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Save inputs — one per callback, matching the route's Extracted* struct.
// ---------------------------------------------------------------------------

export type SaveCatalogInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  catalog: unknown;
};

export type SaveQuoteInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  quote: unknown;
  fulfillments: unknown;
};

export type SaveInitOrderInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  order: unknown;
  quote: unknown;
  fulfillments: unknown;
};

export type SaveConfirmOrderInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  quote?: unknown;
  fulfillments: unknown;
};

export type SaveStatusUpdateInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  fulfillments: unknown;
};

export type SaveTrackingInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  tracking: unknown;
};

export type SaveCancelInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  cancellation: unknown;
  fulfillments: unknown;
};

export type SaveUpdateOrderInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  payments?: unknown;
  fulfillments: unknown;
};

export type SaveSupportInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  phone?: string;
  email?: string;
  uri?: string;
  refId?: string;
  support: unknown;
};

export type SaveRatingInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  feedbackForm?: unknown;
  feedbackFormUrl?: string;
  feedbackFormMimeType?: string;
  feedbackRequired?: boolean;
  feedbackAck?: boolean;
  ratingAck?: boolean;
  feedback: unknown;
};

// Upsert/extend an IGM issue. Both outbound (/issue, complainant side) and
// inbound (/on_issue, respondent side) callsites use this — the actor field
// disambiguates. New action entries are appended, never replace.
export type SaveIssueInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  issueId: string;
  category?: string;
  subCategory?: string;
  orderId?: string;
  status: string;
  lastTouchedBy: "complainant" | "respondent";
  newActions: IssueActionEntry[];
  resolution?: unknown;
  resolutionProvider?: unknown;
  resolutions?: unknown[];
  resolverIds?: string[];
  issue: unknown;
};
