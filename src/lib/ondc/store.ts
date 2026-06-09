// ONDC BAP dummy persistence layer — where the async callbacks land.
//
// The five inbound callbacks (on_search / on_select / on_init / on_confirm /
// on_status) verify + validate their payload and then need somewhere to put the
// result so the request-side flow (and a human/UI) can read it back later. Each
// route already has a `persistOnXxx` seam for exactly this; this module is what
// those seams call.
//
// It is intentionally a DUMMY store: an in-memory source of truth (Maps) with a
// write-through JSON snapshot for durability, behind the same `useBlob` switch as
// src/lib/deployments.ts — local `data/ondc/store.json` in dev, a single JSON
// blob at `system/ondc/store.json` in prod. It is NOT a database: no indexes
// beyond what we build by hand, no transactions across keys, last-write-wins on
// re-sends. Graduating to a real DB/KV is a matter of swapping the read/write
// snapshot functions.
//
// Uses node:fs (+ @vercel/blob), so it must never run on the client. `import
// "server-only"` turns an accidental client import into a build error, mirroring
// config/context/auth/client.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";

// ---------------------------------------------------------------------------
// Error type — named, like OndcConfigError / OndcClientError.
// ---------------------------------------------------------------------------

// A persistence-layer failure (couldn't write the snapshot). Thrown from the
// save* functions so the calling route's try/catch downgrades to a NACK 500
// rather than silently dropping a callback. A *read* miss is NOT an error — it
// returns null/[] (the data simply hasn't arrived yet).
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
  quote: unknown; // opaque ONDC quote
  fulfillments: unknown; // serviceability / delivery options, when present
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
// enriched across the lifecycle:
//   on_init    → drafts it (final quote, firmed order), stage "init"
//   on_confirm → assigns orderId + initial state, stage "confirm"
//   on_status  → updates state + appends to statusHistory, stage "status"
//   on_track   → updates the latest tracking snapshot, stage "track"
//   on_cancel  → records the cancellation + terminal milestone, stage "cancel"
//   on_update  → applies the BPP's updated order (payments / fulfillments / state)
//                + appends a milestone, stage "update"
// orderId is absent until on_confirm; a secondary index (orderId → key) lets a
// future Status/Track API look the order up by order_id alone.
export type OrderRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId?: string; // BPP-assigned, present from on_confirm onward
  state?: unknown; // latest known order state (confirm/status)
  order: unknown; // latest opaque order payload
  quote: unknown; // latest known quote (init/confirm)
  // Latest known payment terms / status (collection, settlement, refunds). ONDC
  // spells this `payments` (an array) in 1.2.x. Carried forward across callbacks
  // and most relevant to on_update, which is how a BPP reports a payment-status
  // change (e.g. COD collected, refund settled). Opaque pass-through; absent
  // until a callback that carries it (on_update — or any future stage wired to
  // populate it). Last-write-wins.
  payments?: unknown;
  fulfillments: unknown; // latest assigned agent / tracking / delivery state
  // Latest tracking snapshot from on_track (url / live location / active|inactive
  // status / tags). Last-write-wins: on_track reports CURRENT tracking state, so
  // we keep only the most recent — not an accumulating trail. Absent until the
  // first on_track for this order.
  tracking?: unknown;
  // The cancellation block from on_cancel (cancelled_by / reason.id / …). Present
  // once the order is cancelled — by the buyer (after a /cancel) OR unsolicited
  // by the seller (force cancel). Last-write-wins. The terminal Cancelled state
  // also lands in `state` and is appended to statusHistory as a milestone.
  cancellation?: unknown;
  stage: OrderStage;
  messageId: string; // messageId of the latest callback that touched this
  statusHistory: OrderStatusSnapshot[];
  createdAt: number;
  updatedAt: number;
};

// The support contact channels a BPP returned for a `support` request. STANDALONE
// — deliberately NOT part of OrderRecord: a support request can be general (no
// order) and on_support carries no order/order_id, so it is keyed only by
// (transactionId, bppId), the same spine every directed action shares. One record
// per (transactionId, bppId); a re-issue replaces it (last-write-wins).
//
// The contact fields are opaque pass-through (ONDC 1.2.x sends flat phone/email/
// uri, some networks add GRO details) — we keep whatever the BPP sent under
// `support` and surface the common channels for convenience. `refId` is the
// request-side subject id (order_id / transaction_id) echoed back when present.
export type SupportRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  phone?: string;
  email?: string;
  uri?: string;
  refId?: string;
  support: unknown; // the full opaque on_support message
  receivedAt: number;
};

// The feedback the BPP returned for a `rating` submission. STANDALONE — like
// SupportRecord, and for the same reason: on_rating carries NO order and NO
// order_id, only a `feedback_form` (an optional follow-up form the buyer MAY
// fill in) and/or ack flags. So it is keyed only by (transactionId, bppId), the
// lifecycle spine every directed action shares. One record per (transactionId,
// bppId); a re-submitted rating replaces it (last-write-wins).
//
// The contact with the wire is opaque pass-through: on_rating's `feedback_form`
// is `{ form: { url, mime_type }, required }` in the common case, but networks
// vary (some return only `feedback_ack` / `rating_ack`). We keep the whole
// message under `feedback` and lift the common fields out for convenience.
export type RatingRecord = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  messageId: string;
  // The feedback_form object as received (opaque), when present.
  feedbackForm?: unknown;
  // Convenience-lifted common fields off feedback_form / message.
  feedbackFormUrl?: string; // feedback_form.form.url
  feedbackFormMimeType?: string; // feedback_form.form.mime_type
  feedbackRequired?: boolean; // feedback_form.required
  feedbackAck?: boolean; // message.feedback_ack
  ratingAck?: boolean; // message.rating_ack
  feedback: unknown; // the full opaque on_rating message
  receivedAt: number;
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
  payments?: unknown;
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
  // on_confirm carries the final quote inside the opaque order; pass it through
  // when the route has it, otherwise the prior (init) quote is retained.
  quote?: unknown;
  payments?: unknown;
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
  payments?: unknown;
  fulfillments: unknown;
};

// on_track carries a `tracking` object but NO order / order_id — the callback is
// correlated to its order purely by (transactionId, bppId), the lifecycle spine.
// So, unlike the status input, there is no orderId here: we resolve the existing
// OrderRecord by composite key and enrich it.
export type SaveTrackingInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  tracking: unknown;
};

// on_cancel carries the full updated order (state "Cancelled") plus a
// `cancellation` block (cancelled_by / reason.id). Like on_status it has an
// orderId (order.id) so we re-assert the secondary index; unlike a poll it is a
// TERMINAL state transition — the caller appends it to statusHistory too.
// on_cancel may be UNSOLICITED (seller force-cancel) so this can arrive with no
// prior /cancel; the writer creates the record defensively when needed.
export type SaveCancelInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  cancellation: unknown;
  payments?: unknown;
  fulfillments: unknown;
};

// on_update carries the full updated order (its `id`, possibly a new `state`, and
// whichever facets the update touched — typically `payments` and/or
// `fulfillments`). Like on_status/on_cancel it has an orderId (order.id) so we
// re-assert the secondary index; like them it can represent a state transition,
// so the caller appends it to statusHistory. `update` is GENERIC: we do not model
// returns/replacements specially — the order is passed through opaquely and the
// updated payments/fulfillments are persisted as-is. on_update may arrive without
// a preceding BAP /update (a BPP can push an unsolicited update), so the writer
// creates the record defensively when needed.
export type SaveUpdateOrderInput = {
  transactionId: string;
  messageId: string;
  bppId: string;
  bppUri: string;
  orderId: string;
  state: unknown;
  order: unknown;
  // The updated payment terms / status from the on_update order. Persisted to the
  // OrderRecord's `payments`; when the update didn't restate payments, the prior
  // value is retained.
  payments?: unknown;
  fulfillments: unknown;
};

// on_support carries the contact channels (phone / email / uri) and no order. We
// key it by (transactionId, bppId) only — there is no order_id to index. The
// common channels are lifted out for convenience; the full message is retained
// opaquely under `support`.
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

// on_rating carries the feedback_form (and/or ack flags) and no order. We key it
// by (transactionId, bppId) only — there is no order_id to index. The common
// feedback_form fields are lifted out for convenience; the full message is
// retained opaquely under `feedback`.
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

// ---------------------------------------------------------------------------
// Backend — Maps as source of truth, write-through JSON snapshot for durability.
// ---------------------------------------------------------------------------

// Bumped 1 → 2 when the standalone `supports` collection was added, 2 → 3 when
// the standalone `ratings` collection was added. Old (v1/v2) snapshots remain
// readable: the defensive reader defaults any missing collection to empty, so an
// older file simply loads with no supports/ratings (backward compatible).
const SNAPSHOT_VERSION = 3 as const;

const DATA_FILE = path.join(process.cwd(), "data", "ondc", "store.json");
const BLOB_KEY = "system/ondc/store.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// The on-disk / on-blob shape. The orderId index is derived on load, not stored.
type StoreSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  catalogs: CatalogRecord[];
  quotes: QuoteRecord[];
  orders: OrderRecord[];
  supports: SupportRecord[];
  ratings: RatingRecord[];
};

// In-memory state. Held on a globalThis singleton so Next dev's HMR (which re-
// evaluates modules) doesn't wipe accumulated catalogs/orders mid-flow.
type StoreState = {
  catalogs: Map<string, CatalogRecord>; // key: txn|bpp|messageId
  quotes: Map<string, QuoteRecord>; // key: txn|bpp
  orders: Map<string, OrderRecord>; // key: txn|bpp
  orderIndex: Map<string, string>; // orderId -> txn|bpp
  supports: Map<string, SupportRecord>; // key: txn|bpp
  ratings: Map<string, RatingRecord>; // key: txn|bpp
  hydration: Promise<void> | null; // memoized one-time load from disk/blob
  writeQueue: Promise<void>; // serializes read-modify-write persists
};

declare global {
  // eslint-disable-next-line no-var
  var __ondcStore__: StoreState | undefined;
}

function getState(): StoreState {
  if (!globalThis.__ondcStore__) {
    globalThis.__ondcStore__ = {
      catalogs: new Map(),
      quotes: new Map(),
      orders: new Map(),
      orderIndex: new Map(),
      supports: new Map(),
      ratings: new Map(),
      hydration: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalThis.__ondcStore__;
}

function compositeKey(transactionId: string, bppId: string): string {
  return `${transactionId}|${bppId}`;
}

function catalogKey(
  transactionId: string,
  bppId: string,
  messageId: string
): string {
  return `${transactionId}|${bppId}|${messageId}`;
}

// ---------------------------------------------------------------------------
// Snapshot I/O — the only place that touches disk/blob. Mirrors the defensive
// read-returns-empty / overwrite-on-write pattern of deployments.ts.
// ---------------------------------------------------------------------------

function emptySnapshot(): StoreSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    catalogs: [],
    quotes: [],
    orders: [],
    supports: [],
    ratings: [],
  };
}

async function readSnapshot(): Promise<StoreSnapshot> {
  let parsed: unknown;
  if (useBlob) {
    try {
      const meta = await head(BLOB_KEY);
      if (!meta?.url) return emptySnapshot();
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) return emptySnapshot();
      parsed = await res.json();
    } catch {
      // Blob missing or transient error — treat as empty.
      return emptySnapshot();
    }
  } else {
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      parsed = JSON.parse(buf);
    } catch {
      // File absent or unreadable — treat as empty.
      return emptySnapshot();
    }
  }

  // Be defensive about the shape: a partially-written or hand-edited file must
  // not crash the store. Anything missing/non-array falls back to empty.
  const snap = parsed as Partial<StoreSnapshot> | null;
  return {
    version: SNAPSHOT_VERSION,
    catalogs: Array.isArray(snap?.catalogs) ? snap!.catalogs : [],
    quotes: Array.isArray(snap?.quotes) ? snap!.quotes : [],
    orders: Array.isArray(snap?.orders) ? snap!.orders : [],
    // Absent in v1 snapshots → defaults to empty (backward compatible).
    supports: Array.isArray(snap?.supports) ? snap!.supports : [],
    // Absent in v1/v2 snapshots → defaults to empty (backward compatible).
    ratings: Array.isArray(snap?.ratings) ? snap!.ratings : [],
  };
}

async function writeSnapshot(snapshot: StoreSnapshot): Promise<void> {
  if (useBlob) {
    await put(BLOB_KEY, JSON.stringify(snapshot, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    return;
  }
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
}

// Hydrate the Maps from the snapshot exactly once per process. Memoized via a
// promise on the singleton so concurrent first-callers all await the same load.
function ensureHydrated(): Promise<void> {
  const s = getState();
  if (!s.hydration) s.hydration = loadSnapshot(s);
  return s.hydration;
}

async function loadSnapshot(s: StoreState): Promise<void> {
  const snap = await readSnapshot();
  for (const c of snap.catalogs) {
    s.catalogs.set(catalogKey(c.transactionId, c.bppId, c.messageId), c);
  }
  for (const q of snap.quotes) {
    s.quotes.set(compositeKey(q.transactionId, q.bppId), q);
  }
  for (const o of snap.orders) {
    const key = compositeKey(o.transactionId, o.bppId);
    s.orders.set(key, o);
    if (o.orderId) s.orderIndex.set(o.orderId, key);
  }
  for (const sup of snap.supports) {
    s.supports.set(compositeKey(sup.transactionId, sup.bppId), sup);
  }
  for (const r of snap.ratings) {
    s.ratings.set(compositeKey(r.transactionId, r.bppId), r);
  }
}

// Serialize a synchronous mutation of the Maps followed by a full-snapshot
// persist. Chaining off writeQueue means the N concurrent on_search callbacks
// for one transaction can't clobber each other's appends, and no two persists
// race to write a stale file. A persist failure surfaces to the caller (so the
// route NACKs) but does not poison the queue for later writes.
function enqueuePersist(mutate: () => void): Promise<void> {
  const s = getState();
  const run = s.writeQueue.then(async () => {
    mutate();
    await persist(s);
  });
  s.writeQueue = run.catch(() => {});
  return run;
}

async function persist(s: StoreState): Promise<void> {
  const snapshot: StoreSnapshot = {
    version: SNAPSHOT_VERSION,
    catalogs: [...s.catalogs.values()],
    quotes: [...s.quotes.values()],
    orders: [...s.orders.values()],
    supports: [...s.supports.values()],
    ratings: [...s.ratings.values()],
  };
  try {
    await writeSnapshot(snapshot);
  } catch (err) {
    throw new OndcStoreError("failed to persist snapshot", { cause: err });
  }
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Writes — called by the on_* callback persistence seams.
// ---------------------------------------------------------------------------

// on_search: accumulate one catalog slice. Same (txn, bpp, messageId) replaces
// (idempotent retry); a new messageId from the same BPP adds an incremental
// slice; a new bppId adds another provider's slice to the same transaction.
export async function saveCatalog(input: SaveCatalogInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    s.catalogs.set(
      catalogKey(input.transactionId, input.bppId, input.messageId),
      {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        catalog: input.catalog,
        receivedAt: now(),
      }
    );
  });
}

// on_select: upsert the quote for (txn, bpp). Last write wins (a re-quote
// replaces the prior one).
export async function saveQuote(input: SaveQuoteInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    s.quotes.set(compositeKey(input.transactionId, input.bppId), {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      messageId: input.messageId,
      quote: input.quote,
      fulfillments: input.fulfillments,
      receivedAt: now(),
    });
  });
}

// on_init: draft (or re-draft) the order for (txn, bpp) with the firmed-up
// quote. Preserves any orderId/state/history already present (defensive — init
// normally precedes confirm, but callbacks can race or replay).
export async function saveInitOrder(input: SaveInitOrderInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: existing?.orderId,
      state: existing?.state,
      order: input.order,
      quote: input.quote,
      payments: input.payments ?? existing?.payments,
      fulfillments: input.fulfillments,
      tracking: existing?.tracking,
      cancellation: existing?.cancellation,
      stage: "init",
      messageId: input.messageId,
      statusHistory: existing?.statusHistory ?? [],
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
  });
}

// on_confirm: assign the BPP order id + initial state and register the secondary
// index. Carries over the init quote when the confirm callback doesn't restate
// it. Creates the record if no init was seen (defensive against out-of-order
// callbacks).
export async function saveConfirmOrder(
  input: SaveConfirmOrderInput
): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: input.orderId,
      state: input.state,
      order: input.order,
      quote: input.quote ?? existing?.quote,
      payments: input.payments ?? existing?.payments,
      fulfillments: input.fulfillments,
      tracking: existing?.tracking,
      cancellation: existing?.cancellation,
      stage: "confirm",
      messageId: input.messageId,
      statusHistory: existing?.statusHistory ?? [],
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    s.orderIndex.set(input.orderId, key);
  });
}

// on_status: update the order's current snapshot and append the milestone to
// statusHistory. Creates the record if confirm wasn't seen (defensive). Re-
// asserts the orderId index since on_status can arrive before/without confirm.
export async function saveStatusUpdate(
  input: SaveStatusUpdateInput
): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    const statusHistory = [
      ...(existing?.statusHistory ?? []),
      { state: input.state, messageId: input.messageId, at: ts },
    ];
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: input.orderId,
      state: input.state,
      order: input.order,
      quote: existing?.quote,
      payments: input.payments ?? existing?.payments,
      fulfillments: input.fulfillments,
      tracking: existing?.tracking,
      cancellation: existing?.cancellation,
      stage: "status",
      messageId: input.messageId,
      statusHistory,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    s.orderIndex.set(input.orderId, key);
  });
}

// on_track: refresh the order's latest tracking snapshot (last-write-wins) and
// mark stage "track". on_track carries NO order_id, so we correlate by
// (txn, bpp) and preserve everything else (orderId/state/order/quote/
// fulfillments/statusHistory). Creates a minimal record if track somehow
// precedes confirm (defensive against out-of-order / unsolicited callbacks);
// orderId stays undefined in that case until a later confirm/status fills it in.
export async function saveTrackingUpdate(
  input: SaveTrackingInput
): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: existing?.orderId,
      state: existing?.state,
      order: existing?.order,
      quote: existing?.quote,
      payments: existing?.payments,
      fulfillments: existing?.fulfillments,
      tracking: input.tracking,
      cancellation: existing?.cancellation,
      stage: "track",
      messageId: input.messageId,
      statusHistory: existing?.statusHistory ?? [],
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
  });
}

// on_cancel: record the cancellation on the order for (txn, bpp) and mark stage
// "cancel". Sets the dedicated `cancellation` block AND appends the terminal
// Cancelled milestone to statusHistory (a cancel is a state transition, like
// on_status). Preserves everything else (order/quote/tracking) and carries the
// init/confirm quote forward. Creates the record defensively if no prior
// init/confirm/cancel was seen — covering the UNSOLICITED seller force-cancel,
// where on_cancel is the first callback we see for this order. Re-asserts the
// orderId index since on_cancel can arrive before/without confirm.
export async function saveCancelUpdate(
  input: SaveCancelInput
): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    const statusHistory = [
      ...(existing?.statusHistory ?? []),
      { state: input.state, messageId: input.messageId, at: ts },
    ];
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: input.orderId,
      state: input.state,
      order: input.order,
      quote: existing?.quote,
      payments: input.payments ?? existing?.payments,
      fulfillments: input.fulfillments,
      tracking: existing?.tracking,
      cancellation: input.cancellation,
      stage: "cancel",
      messageId: input.messageId,
      statusHistory,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    s.orderIndex.set(input.orderId, key);
  });
}

// on_update: apply the BPP's updated order to (txn, bpp) and mark stage "update".
// GENERIC update — no special return/replacement handling: we persist the updated
// `payments` (falling back to the prior value when the update didn't restate
// them) and `fulfillments`, refresh the opaque `order`, update `state`, and append
// the milestone to statusHistory (an update can be a state transition). Preserves
// everything else (quote/tracking/cancellation) and carries the prior quote
// forward. Creates the record defensively if no prior callback was seen (an
// unsolicited BPP-pushed update). Re-asserts the orderId index since on_update can
// arrive before/without confirm.
export async function saveUpdateOrder(
  input: SaveUpdateOrderInput
): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = compositeKey(input.transactionId, input.bppId);
    const existing = s.orders.get(key);
    const ts = now();
    const statusHistory = [
      ...(existing?.statusHistory ?? []),
      { state: input.state, messageId: input.messageId, at: ts },
    ];
    s.orders.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      orderId: input.orderId,
      state: input.state,
      order: input.order,
      quote: existing?.quote,
      payments: input.payments ?? existing?.payments,
      fulfillments: input.fulfillments,
      tracking: existing?.tracking,
      cancellation: existing?.cancellation,
      stage: "update",
      messageId: input.messageId,
      statusHistory,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    s.orderIndex.set(input.orderId, key);
  });
}

// on_support: upsert the support contact channels for (txn, bpp). STANDALONE —
// does NOT touch any OrderRecord. Last write wins (a re-issued on_support replaces
// the prior one). Keyed by (txn, bpp) only; there is no order_id to index.
export async function saveSupport(input: SaveSupportInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    s.supports.set(compositeKey(input.transactionId, input.bppId), {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      messageId: input.messageId,
      phone: input.phone,
      email: input.email,
      uri: input.uri,
      refId: input.refId,
      support: input.support,
      receivedAt: now(),
    });
  });
}

// on_rating: upsert the feedback for (txn, bpp). STANDALONE — does NOT touch any
// OrderRecord (on_rating carries no order/order_id). Last write wins (a re-issued
// on_rating replaces the prior one). Keyed by (txn, bpp) only; there is no
// order_id to index. Mirrors saveSupport exactly.
export async function saveRating(input: SaveRatingInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    s.ratings.set(compositeKey(input.transactionId, input.bppId), {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      messageId: input.messageId,
      feedbackForm: input.feedbackForm,
      feedbackFormUrl: input.feedbackFormUrl,
      feedbackFormMimeType: input.feedbackFormMimeType,
      feedbackRequired: input.feedbackRequired,
      feedbackAck: input.feedbackAck,
      ratingAck: input.ratingAck,
      feedback: input.feedback,
      receivedAt: now(),
    });
  });
}

// ---------------------------------------------------------------------------
// Reads — for the request-side routes (select/init/confirm/status) and any UI.
// A miss returns null/[] (data simply hasn't arrived), never throws.
// ---------------------------------------------------------------------------

// All catalog slices accumulated for a discovery session, across every BPP that
// responded, newest first. This is what a Select API reads to pick a provider.
export async function getCatalogs(
  transactionId: string
): Promise<CatalogRecord[]> {
  await ensureHydrated();
  const s = getState();
  const out: CatalogRecord[] = [];
  for (const rec of s.catalogs.values()) {
    if (rec.transactionId === transactionId) out.push(rec);
  }
  return out.sort((a, b) => b.receivedAt - a.receivedAt);
}

// The latest quote a given BPP returned for a select, or null.
export async function getQuote(
  transactionId: string,
  bppId: string
): Promise<QuoteRecord | null> {
  await ensureHydrated();
  return getState().quotes.get(compositeKey(transactionId, bppId)) ?? null;
}

// The order for (txn, bpp), at whatever stage it has reached, or null.
export async function getOrder(
  transactionId: string,
  bppId: string
): Promise<OrderRecord | null> {
  await ensureHydrated();
  return getState().orders.get(compositeKey(transactionId, bppId)) ?? null;
}

// The order by its BPP-assigned order id (via the secondary index), or null.
// This is what Status/Track reads, since post-confirm flows reference order_id.
export async function getOrderById(
  orderId: string
): Promise<OrderRecord | null> {
  await ensureHydrated();
  const s = getState();
  const key = s.orderIndex.get(orderId);
  return key ? s.orders.get(key) ?? null : null;
}

// The support contact channels a BPP returned for (txn, bpp), or null. This is
// what a buyer UI reads to show "contact the seller" details after on_support.
export async function getSupport(
  transactionId: string,
  bppId: string
): Promise<SupportRecord | null> {
  await ensureHydrated();
  return getState().supports.get(compositeKey(transactionId, bppId)) ?? null;
}

// The feedback a BPP returned for (txn, bpp) after a rating, or null. This is
// what a buyer UI reads to render an optional follow-up feedback form (or to
// confirm the rating was recorded) after on_rating.
export async function getRating(
  transactionId: string,
  bppId: string
): Promise<RatingRecord | null> {
  await ensureHydrated();
  return getState().ratings.get(compositeKey(transactionId, bppId)) ?? null;
}
