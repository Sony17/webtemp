// Logistics shipment ledger — JSON snapshot backend.
//
// We keep our OWN row per shipment so the shop and admin never have to hit Tocxi
// to render status, and so inbound webhook updates have somewhere to land. Tocxi
// is the delivery network; this is our source of truth for "what did we book for
// this order and where is it now."
//
// A shipment is created when an order is booked (status from Tocxi's 201, usually
// PENDING) and advanced by webhooks / cancel calls through the lifecycle
// (CONFIRMED → PICKED_UP → … → DELIVERED, or a terminal CANCELLED / FAILED).
// Create is IDEMPOTENT on `partnerReference` (the order id): re-booking the same
// order returns the existing record instead of minting a second shipment.
//
// Backend mirrors src/lib/payments/store-json.ts exactly: an in-memory Map source
// of truth with a write-through JSON snapshot for durability, behind the same
// `useBlob` switch — local `data/logistics/store.json` in dev, a single JSON blob
// at `system/logistics/store.json` in prod. It is NOT a database: last-write-wins
// on re-sends, no cross-key transactions.
//
// Uses node:fs (+ @vercel/blob), so it must never run on the client. `import
// "server-only"` turns an accidental client import into a build error, mirroring
// the payments/ondc stacks.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";
import type {
  ParcelSize,
  ShipmentStatus,
  Address,
  QuoteResponse,
} from "@/lib/logistics/types";
import { SHIPMENT_STATUS_ORDER, TERMINAL_STATUSES } from "@/lib/logistics/types";

// One status transition in a shipment's history — appended every time the status
// advances. `at` is epoch-ms (when WE recorded it); `eventTimestamp` is Tocxi's
// own ISO timestamp from the webhook, when present, so out-of-order events can be
// detected against the source's clock, not ours.
export type ShipmentStatusEvent = {
  status: ShipmentStatus;
  at: number;
  eventTimestamp?: string;
};

// One tracked shipment, keyed by `partnerReference` (our order id — one shipment
// per order for the pilot). `shipmentId` is Tocxi's id, indexed so webhooks (which
// carry both) and admin lookups can resolve either way.
export type ShipmentRecord = {
  // Our order id — the spine that joins a shop order to its Tocxi shipment. This
  // is the Map key and the Idempotency-Key used on create.
  partnerReference: string;
  // Tocxi's shipment id (PRCL-…), assigned on create. The webhook and GET/cancel
  // calls reference it.
  shipmentId: string;
  // Optional ONDC transaction id, when the booking originates from an ONDC order
  // — lets a buyer's order page find its shipment without a second lookup table.
  transactionId?: string;
  status: ShipmentStatus;
  pickup: Address;
  drop: Address;
  parcelSize?: ParcelSize;
  weightKg?: number;
  cod: boolean;
  codAmount?: number;
  // The quote captured at booking (price / distance / eta), for display.
  quote?: QuoteResponse;
  estimatedPrice?: number;
  trackingUrl?: string;
  awbNo?: string;
  // Append-only progression, oldest first. Backs a buyer/admin timeline.
  statusHistory: ShipmentStatusEvent[];
  // Epoch-ms of the last status-changing event we applied (webhook or cancel).
  lastEventAt?: number;
  createdAt: number;
  updatedAt: number;
};

// Raised when the snapshot can't be persisted, so the route can surface a 500
// rather than silently dropping the write. Mirrors PaymentStoreError.
export class ShipmentStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ShipmentStoreError";
  }
}

// ---------------------------------------------------------------------------
// Status-progression helper — shared by both backends so idempotent, out-of-order
// webhook handling behaves identically on JSON and Postgres.
// ---------------------------------------------------------------------------

// Rank of a status on the happy path; terminal exceptions rank above the whole
// path so they always win, and DELIVERED (also terminal) sits at the path's end.
function statusRank(status: ShipmentStatus): number {
  const i = SHIPMENT_STATUS_ORDER.indexOf(status);
  if (i >= 0) return i;
  // CANCELLED / FAILED — terminal exceptions. Rank them at the top so they can
  // land from any prior state and are never overwritten by a stale in-flight
  // event, but never let them supersede a DELIVERED (already terminal-success).
  return SHIPMENT_STATUS_ORDER.length; // one past OUT_FOR_DELIVERY/DELIVERED
}

// Decide whether `next` should replace `current` as the shipment's status. The
// rule protects against Tocxi's at-least-once, possibly-out-of-order delivery:
//   * never move backwards along the happy path (a late PICKED_UP after
//     IN_TRANSIT is ignored);
//   * a terminal success (DELIVERED) is final — nothing supersedes it;
//   * a terminal exception (CANCELLED/FAILED) wins over any non-terminal state.
// Equal status is not an advance (duplicate event) → false.
export function shouldAdvanceStatus(
  current: ShipmentStatus,
  next: ShipmentStatus
): boolean {
  if (current === next) return false;
  // DELIVERED is absorbing — a delivered shipment stays delivered.
  if (current === "DELIVERED") return false;
  // A terminal exception overrides any non-terminal current state.
  const nextTerminal = (TERMINAL_STATUSES as readonly ShipmentStatus[]).includes(
    next
  );
  const currentTerminal = (
    TERMINAL_STATUSES as readonly ShipmentStatus[]
  ).includes(current);
  if (nextTerminal && !currentTerminal) return true;
  if (currentTerminal) return false; // already CANCELLED/FAILED — stay put
  // Both on the happy path — only advance forward.
  return statusRank(next) > statusRank(current);
}

// ---------------------------------------------------------------------------
// Backend — a Map as source of truth, write-through JSON snapshot for durability.
// ---------------------------------------------------------------------------

const SNAPSHOT_VERSION = 1 as const;

// On Vercel the bundle directory is READ-ONLY; only `/tmp` is writable per
// invocation. Same branch as payments/store-json.ts.
const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "logistics", "store.json")
  : path.join(process.cwd(), "data", "logistics", "store.json");
const BLOB_KEY = "system/logistics/store.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

type StoreSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  shipments: ShipmentRecord[];
};

// In-memory state on a globalThis singleton so Next dev's HMR doesn't wipe
// accumulated shipments mid-flow. Mirrors payments/store-json.ts's StoreState.
type StoreState = {
  shipments: Map<string, ShipmentRecord>; // key: partnerReference
  hydration: Promise<void> | null;
  writeQueue: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __shipmentStore__: StoreState | undefined;
}

function getState(): StoreState {
  if (!globalThis.__shipmentStore__) {
    globalThis.__shipmentStore__ = {
      shipments: new Map(),
      hydration: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalThis.__shipmentStore__;
}

// ---------------------------------------------------------------------------
// Snapshot I/O — the only place that touches disk/blob.
// ---------------------------------------------------------------------------

function emptySnapshot(): StoreSnapshot {
  return { version: SNAPSHOT_VERSION, shipments: [] };
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
      return emptySnapshot();
    }
  } else {
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      parsed = JSON.parse(buf);
    } catch {
      return emptySnapshot();
    }
  }

  const snap = parsed as Partial<StoreSnapshot> | null;
  return {
    version: SNAPSHOT_VERSION,
    shipments: Array.isArray(snap?.shipments) ? snap!.shipments : [],
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

function ensureHydrated(): Promise<void> {
  const s = getState();
  if (!s.hydration) s.hydration = loadSnapshot(s);
  return s.hydration;
}

async function loadSnapshot(s: StoreState): Promise<void> {
  const snap = await readSnapshot();
  for (const rec of snap.shipments) {
    s.shipments.set(rec.partnerReference, rec);
  }
}

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
    shipments: [...s.shipments.values()],
  };
  try {
    await writeSnapshot(snapshot);
  } catch (err) {
    throw new ShipmentStoreError("failed to persist snapshot", { cause: err });
  }
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

export type CreateShipmentInput = {
  partnerReference: string;
  shipmentId: string;
  transactionId?: string;
  status: ShipmentStatus;
  pickup: Address;
  drop: Address;
  parcelSize?: ParcelSize;
  weightKg?: number;
  cod: boolean;
  codAmount?: number;
  quote?: QuoteResponse;
  estimatedPrice?: number;
  trackingUrl?: string;
  awbNo?: string;
};

// Record a booked shipment, or return the existing record unchanged if this
// order was already booked. IDEMPOTENT on partnerReference: a retry (the create
// route is safe to double-fire) never mints a second shipment. When the record
// already exists but the caller now knows a field it didn't before (awbNo,
// trackingUrl), those are filled in without clobbering existing values.
export async function createShipment(
  input: CreateShipmentInput
): Promise<ShipmentRecord> {
  await ensureHydrated();
  let result!: ShipmentRecord;
  await enqueuePersist(() => {
    const s = getState();
    const existing = s.shipments.get(input.partnerReference);
    const ts = now();
    if (existing) {
      const merged: ShipmentRecord = {
        ...existing,
        // Enrich late-arriving fields; never overwrite a known value with undefined.
        transactionId: existing.transactionId ?? input.transactionId,
        awbNo: existing.awbNo ?? input.awbNo,
        trackingUrl: existing.trackingUrl ?? input.trackingUrl,
        estimatedPrice: existing.estimatedPrice ?? input.estimatedPrice,
        quote: existing.quote ?? input.quote,
      };
      s.shipments.set(input.partnerReference, merged);
      result = merged;
      return;
    }
    const record: ShipmentRecord = {
      partnerReference: input.partnerReference,
      shipmentId: input.shipmentId,
      transactionId: input.transactionId,
      status: input.status,
      pickup: input.pickup,
      drop: input.drop,
      parcelSize: input.parcelSize,
      weightKg: input.weightKg,
      cod: input.cod,
      codAmount: input.codAmount,
      quote: input.quote,
      estimatedPrice: input.estimatedPrice,
      trackingUrl: input.trackingUrl,
      awbNo: input.awbNo,
      statusHistory: [{ status: input.status, at: ts }],
      lastEventAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    s.shipments.set(input.partnerReference, record);
    result = record;
  });
  return result;
}

export type UpdateShipmentStatusInput = {
  // Resolve the shipment by EITHER key — webhooks carry both; some callers only
  // have one. partnerReference is preferred (it's the Map key).
  partnerReference?: string;
  shipmentId?: string;
  status: ShipmentStatus;
  awbNo?: string;
  // Tocxi's own event timestamp (ISO), used for out-of-order detection.
  eventTimestamp?: string;
};

// Advance a shipment's status IDEMPOTENTLY. Returns null when no shipment matches
// (so the webhook route can 404/no-op rather than invent one). A duplicate or
// out-of-order event (see shouldAdvanceStatus) is accepted as a no-op: the record
// is returned unchanged and the status-history is NOT appended to, so replaying
// the same event twice leaves exactly one history entry. awbNo, when newly known,
// is filled in even on a no-op advance.
export async function updateShipmentStatus(
  input: UpdateShipmentStatusInput
): Promise<ShipmentRecord | null> {
  await ensureHydrated();
  let result: ShipmentRecord | null = null;
  await enqueuePersist(() => {
    const s = getState();
    const existing = resolve(s, input.partnerReference, input.shipmentId);
    if (!existing) return; // stays null
    const advance = shouldAdvanceStatus(existing.status, input.status);
    const ts = now();
    // Even a non-advancing event may carry a newly-known awbNo — fold it in.
    const awbNo = existing.awbNo ?? input.awbNo;
    if (!advance) {
      if (awbNo !== existing.awbNo) {
        const patched: ShipmentRecord = { ...existing, awbNo, updatedAt: ts };
        s.shipments.set(existing.partnerReference, patched);
        result = patched;
      } else {
        result = existing;
      }
      return;
    }
    const updated: ShipmentRecord = {
      ...existing,
      status: input.status,
      awbNo,
      statusHistory: [
        ...existing.statusHistory,
        {
          status: input.status,
          at: ts,
          eventTimestamp: input.eventTimestamp,
        },
      ],
      lastEventAt: ts,
      updatedAt: ts,
    };
    s.shipments.set(existing.partnerReference, updated);
    result = updated;
  });
  return result;
}

// Find a record by partnerReference (the key) or by shipmentId (a scan). Used by
// both the status update and the reads below.
function resolve(
  s: StoreState,
  partnerReference?: string,
  shipmentId?: string
): ShipmentRecord | undefined {
  if (partnerReference) {
    const byRef = s.shipments.get(partnerReference);
    if (byRef) return byRef;
  }
  if (shipmentId) {
    for (const rec of s.shipments.values()) {
      if (rec.shipmentId === shipmentId) return rec;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reads — a miss returns null, never throws.
// ---------------------------------------------------------------------------

export async function getShipmentByReference(
  partnerReference: string
): Promise<ShipmentRecord | null> {
  await ensureHydrated();
  return getState().shipments.get(partnerReference) ?? null;
}

export async function getShipment(
  shipmentId: string
): Promise<ShipmentRecord | null> {
  await ensureHydrated();
  for (const rec of getState().shipments.values()) {
    if (rec.shipmentId === shipmentId) return rec;
  }
  return null;
}

// Resolve a shipment by the ONDC transaction id it was booked against. Lets the
// buyer order page (which always has the txn in its URL) find its courier
// shipment without knowing the Tocxi id. Returns the NEWEST match when more than
// one shipment shares a transaction (rare — one per order in the pilot).
export async function getShipmentByTransaction(
  transactionId: string
): Promise<ShipmentRecord | null> {
  await ensureHydrated();
  let latest: ShipmentRecord | null = null;
  for (const rec of getState().shipments.values()) {
    if (rec.transactionId === transactionId) {
      if (!latest || rec.createdAt > latest.createdAt) latest = rec;
    }
  }
  return latest;
}

// All tracked shipments, newest first — optionally filtered by status. Backs the
// admin ops console. (On this JSON backend the list only reflects THIS instance's
// snapshot; the Postgres backend is what makes it complete — see store-db.ts.)
export async function listShipments(opts?: {
  status?: ShipmentStatus;
  limit?: number;
}): Promise<ShipmentRecord[]> {
  await ensureHydrated();
  const all = [...getState().shipments.values()];
  const filtered = opts?.status
    ? all.filter((r) => r.status === opts.status)
    : all;
  const sorted = filtered.sort((a, b) => b.createdAt - a.createdAt);
  return opts?.limit ? sorted.slice(0, opts.limit) : sorted;
}
