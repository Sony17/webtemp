// ONDC BAP persistence — JSON snapshot backend.
//
// The five inbound callbacks (on_search / on_select / on_init / on_confirm /
// on_status / …) verify + validate their payload and then need somewhere to
// put the result so the request-side flow (and a human/UI) can read it back
// later. Each route already has a `persistOnXxx` seam for exactly this; this
// module is one of the two backends store.ts dispatches to (the other is
// store-db.ts, used when DATABASE_URL is set).
//
// Backend: an in-memory source of truth (Maps) with a write-through JSON
// snapshot for durability, behind the same `useBlob` switch as
// src/lib/deployments.ts — local `data/ondc/store.json` in dev, a single JSON
// blob at `system/ondc/store.json` in prod. It is NOT a database: no indexes
// beyond what we build by hand, no transactions across keys, last-write-wins
// on re-sends. The Postgres backend (store-db.ts) is the production graduation
// path for that.
//
// Uses node:fs (+ @vercel/blob), so it must never run on the client. `import
// "server-only"` turns an accidental client import into a build error,
// mirroring config/context/auth/client.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";
import type {
  CatalogRecord,
  OrderRecord,
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
import { OndcStoreError } from "@/lib/ondc/store-types";

// Record types, save inputs, and OndcStoreError moved to store-types.ts when
// the Postgres backend (store-db.ts) joined this one behind the store.ts
// dispatcher — so both backends share one source of truth and callsites keep
// writing `import type { CatalogRecord } from "@/lib/ondc/store"`.

// ---------------------------------------------------------------------------
// Backend — Maps as source of truth, write-through JSON snapshot for durability.
// ---------------------------------------------------------------------------

// Bumped 1 → 2 when the standalone `supports` collection was added, 2 → 3 when
// the standalone `ratings` collection was added, 3 → 4 when the standalone
// `issues` (IGM v2.0.0) collection was added. Old snapshots remain readable:
// the defensive reader defaults any missing collection to empty, so an older
// file simply loads with no supports/ratings/issues (backward compatible).
const SNAPSHOT_VERSION = 4 as const;

// On Vercel (and most serverless platforms) the function bundle directory is
// READ-ONLY; only `/tmp` is writable per invocation. Without this branch a
// deployment that hasn't provisioned BLOB_READ_WRITE_TOKEN crashes every
// callback with EROFS on the first `fs.writeFile`. `/tmp` is ephemeral
// across cold starts — production deployments should still wire Blob (or set
// DATABASE_URL to switch to the Postgres backend) — but this lets traffic
// flow with at-least-in-process durability instead of NACKing every callback.
const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "ondc", "store.json")
  : path.join(process.cwd(), "data", "ondc", "store.json");
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
  issues: IssueRecord[];
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
  issues: Map<string, IssueRecord>; // key: txn|issueId
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
      issues: new Map(),
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
    issues: [],
  };
}

// IGM issues are keyed by (transactionId, issueId) — a single transaction may
// open multiple grievances (rare, but the spec allows it), and an issueId is
// unique within a transaction.
function issueKey(transactionId: string, issueId: string): string {
  return `${transactionId}|${issueId}`;
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
    // Absent in v1/v2/v3 snapshots → defaults to empty (backward compatible).
    issues: Array.isArray(snap?.issues) ? snap!.issues : [],
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
  for (const i of snap.issues) {
    s.issues.set(issueKey(i.transactionId, i.issueId), i);
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
    issues: [...s.issues.values()],
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
      payments: existing?.payments,
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
      payments: existing?.payments,
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
      payments: existing?.payments,
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
      payments: existing?.payments,
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

// IGM v2.0.0 issue: upsert keyed by (txn, issueId). Used by BOTH sides — the
// outbound /issue route (actor=complainant) and the inbound /on_issue callback
// (actor=respondent). New action entries are APPENDED to the existing
// history rather than replacing; status / resolution / messageId always reflect
// the latest write. Same (txn, issueId) → continues the lifecycle; different
// issueId on the same txn → starts a new grievance side-by-side.
export async function saveIssue(input: SaveIssueInput): Promise<void> {
  await ensureHydrated();
  await enqueuePersist(() => {
    const s = getState();
    const key = issueKey(input.transactionId, input.issueId);
    const existing = s.issues.get(key);
    const ts = now();
    const mergedActions: IssueActionEntry[] = [
      ...(existing?.actions ?? []),
      ...input.newActions,
    ];
    s.issues.set(key, {
      transactionId: input.transactionId,
      bppId: input.bppId,
      bppUri: input.bppUri,
      messageId: input.messageId,
      issueId: input.issueId,
      category: input.category ?? existing?.category,
      subCategory: input.subCategory ?? existing?.subCategory,
      orderId: input.orderId ?? existing?.orderId,
      status: input.status,
      lastTouchedBy: input.lastTouchedBy,
      actions: mergedActions,
      resolution: input.resolution ?? existing?.resolution,
      resolutionProvider: input.resolutionProvider ?? existing?.resolutionProvider,
      resolutions: input.resolutions ?? existing?.resolutions,
      resolverIds: input.resolverIds ?? existing?.resolverIds,
      issue: input.issue,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
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

// An IGM issue with full action history, or null. Used by the outbound /issue
// route to find an existing issue when the client passes its issueId (for
// INFO_PROVIDED / RESOLUTION_ACCEPT / CLOSE), and by the GET-issue inspection
// endpoint to surface the lifecycle to humans.
export async function getIssue(
  transactionId: string,
  issueId: string
): Promise<IssueRecord | null> {
  await ensureHydrated();
  return getState().issues.get(issueKey(transactionId, issueId)) ?? null;
}

// All issues for a transaction. A buyer UI lists these to show every grievance
// opened against one order (typically zero or one, but the spec allows more).
export async function getIssuesByTransaction(
  transactionId: string
): Promise<IssueRecord[]> {
  await ensureHydrated();
  const out: IssueRecord[] = [];
  for (const rec of getState().issues.values()) {
    if (rec.transactionId === transactionId) out.push(rec);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Admin dashboard reads — cross-transaction lists + counts. (On this JSON
// backend the lists only reflect THIS instance's /tmp snapshot; Postgres is
// what makes them complete — see store-db.ts.)
// ---------------------------------------------------------------------------

export async function listOrders(): Promise<OrderRecord[]> {
  await ensureHydrated();
  return [...getState().orders.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listIssues(): Promise<IssueRecord[]> {
  await ensureHydrated();
  return [...getState().issues.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function countTransactions(): Promise<number> {
  await ensureHydrated();
  const s = getState();
  const txns = new Set<string>();
  for (const c of s.catalogs.values()) txns.add(c.transactionId);
  for (const o of s.orders.values()) txns.add(o.transactionId);
  return txns.size;
}
