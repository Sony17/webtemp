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
export type OrderStage = "init" | "confirm" | "status";

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
  fulfillments: unknown; // latest assigned agent / tracking / delivery state
  stage: OrderStage;
  messageId: string; // messageId of the latest callback that touched this
  statusHistory: OrderStatusSnapshot[];
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
  // on_confirm carries the final quote inside the opaque order; pass it through
  // when the route has it, otherwise the prior (init) quote is retained.
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

// ---------------------------------------------------------------------------
// Backend — Maps as source of truth, write-through JSON snapshot for durability.
// ---------------------------------------------------------------------------

const SNAPSHOT_VERSION = 1 as const;

const DATA_FILE = path.join(process.cwd(), "data", "ondc", "store.json");
const BLOB_KEY = "system/ondc/store.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// The on-disk / on-blob shape. The orderId index is derived on load, not stored.
type StoreSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  catalogs: CatalogRecord[];
  quotes: QuoteRecord[];
  orders: OrderRecord[];
};

// In-memory state. Held on a globalThis singleton so Next dev's HMR (which re-
// evaluates modules) doesn't wipe accumulated catalogs/orders mid-flow.
type StoreState = {
  catalogs: Map<string, CatalogRecord>; // key: txn|bpp|messageId
  quotes: Map<string, QuoteRecord>; // key: txn|bpp
  orders: Map<string, OrderRecord>; // key: txn|bpp
  orderIndex: Map<string, string>; // orderId -> txn|bpp
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
  return { version: SNAPSHOT_VERSION, catalogs: [], quotes: [], orders: [] };
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
      fulfillments: input.fulfillments,
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
      fulfillments: input.fulfillments,
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
      fulfillments: input.fulfillments,
      stage: "status",
      messageId: input.messageId,
      statusHistory,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    s.orderIndex.set(input.orderId, key);
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
