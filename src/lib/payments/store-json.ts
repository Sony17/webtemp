// Payment tracking persistence — JSON snapshot backend.
//
// ONDC settles money out-of-band: the protocol's `payment` block only DESCRIBES
// the terms (collected_by / amount / status) — it never moves funds. A BAP that
// collects on-order (collected_by = "BAP") therefore needs its OWN ledger of
// "did the buyer actually pay for this transaction yet, and what's the bank's
// reference for it." This module is that ledger.
//
// It is deliberately NOT wired to any payment gateway or bank API: a payment is
// created in PENDING, and an out-of-band reconciliation step (a webhook, an ops
// console, a manual settlement check) later flips it to PAID via /verify. The
// `paymentReference` is derived DETERMINISTICALLY from the transaction id, so
// the same transaction always maps to the same reference — which also makes
// create idempotent (a re-create never mints a second reference or resets a
// payment that is already PAID).
//
// Backend mirrors src/lib/ondc/store-json.ts exactly: an in-memory Map source of
// truth with a write-through JSON snapshot for durability, behind the same
// `useBlob` switch — local `data/payments/store.json` in dev, a single JSON blob
// at `system/payments/store.json` in prod. It is NOT a database: last-write-wins
// on re-sends, no cross-key transactions.
//
// Uses node:fs (+ @vercel/blob), so it must never run on the client. `import
// "server-only"` turns an accidental client import into a build error, mirroring
// the ondc/* stack.
import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";

// One tracked payment, keyed by ONDC transaction id (one payment per buyer
// transaction). `paymentReference` is derived from the transaction id (see
// paymentReferenceFor) so it is stable and unique without a separate counter.
export type PaymentRecord = {
  transactionId: string;
  // The BPP-assigned order id, once a confirm has happened. Optional because a
  // payment can be created at checkout intent, before on_confirm returns one.
  orderId?: string;
  // Order amount in the transaction currency. Optional — a payment can be
  // tracked before the final quote is firmed up.
  amount?: number;
  // Deterministic, stable handle for this payment (PAY-<hex>). Safe to surface
  // to the buyer and to quote back on a bank reconciliation.
  paymentReference: string;
  // PENDING on create; flipped to PAID by an out-of-band /verify call.
  status: "PENDING" | "PAID";
  // The bank/PSP settlement reference, recorded by /verify when known.
  bankReference?: string;
  createdAt: number;
  updatedAt: number;
  // The instant this payment FIRST transitioned to PAID. Distinct from
  // updatedAt (which moves on every mutation, including a re-verify or an
  // orderId/amount enrichment): verifiedAt is write-once and pins the moment
  // settlement was confirmed. It exists so a future bank-account reconciliation
  // can answer the audit questions updatedAt cannot — "when exactly was this
  // marked paid", "did it settle inside its SLA window", "match this PAID record
  // to the bank statement line dated T" — and so an audit trail of when money
  // was recognised survives later edits to the same record. Absent while PENDING.
  verifiedAt?: number;
};

// Raised when the snapshot can't be persisted, so the route can surface a 500
// rather than silently dropping the write. Mirrors OndcStoreError in store-types.
export class PaymentStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentStoreError";
  }
}

// ---------------------------------------------------------------------------
// Backend — a Map as source of truth, write-through JSON snapshot for durability.
// ---------------------------------------------------------------------------

const SNAPSHOT_VERSION = 1 as const;

// On Vercel the bundle directory is READ-ONLY; only `/tmp` is writable per
// invocation. Same branch as store-json.ts: `/tmp` on Vercel (ephemeral across
// cold starts — wire BLOB_READ_WRITE_TOKEN for durability), project-rooted
// `data/` locally.
const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "payments", "store.json")
  : path.join(process.cwd(), "data", "payments", "store.json");
const BLOB_KEY = "system/payments/store.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// The on-disk / on-blob shape.
type StoreSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  payments: PaymentRecord[];
};

// In-memory state on a globalThis singleton so Next dev's HMR doesn't wipe
// accumulated payments mid-flow. Mirrors store-json.ts's StoreState.
type StoreState = {
  payments: Map<string, PaymentRecord>; // key: transactionId
  hydration: Promise<void> | null; // memoized one-time load
  writeQueue: Promise<void>; // serializes read-modify-write persists
};

declare global {
  // eslint-disable-next-line no-var
  var __paymentStore__: StoreState | undefined;
}

function getState(): StoreState {
  if (!globalThis.__paymentStore__) {
    globalThis.__paymentStore__ = {
      payments: new Map(),
      hydration: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalThis.__paymentStore__;
}

// ---------------------------------------------------------------------------
// Deterministic payment reference.
// ---------------------------------------------------------------------------

// Derive a stable reference from the transaction id alone. SHA-256 → first 16
// hex chars, uppercased, prefixed. Deterministic: the same transaction always
// yields the same reference, which is what makes create idempotent.
export function paymentReferenceFor(transactionId: string): string {
  const hex = crypto
    .createHash("sha256")
    .update(transactionId)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `PAY-${hex}`;
}

// ---------------------------------------------------------------------------
// Snapshot I/O — the only place that touches disk/blob. Mirrors the defensive
// read-returns-empty / overwrite-on-write pattern of store-json.ts.
// ---------------------------------------------------------------------------

function emptySnapshot(): StoreSnapshot {
  return { version: SNAPSHOT_VERSION, payments: [] };
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
  // not crash the store. A missing/non-array collection falls back to empty.
  const snap = parsed as Partial<StoreSnapshot> | null;
  return {
    version: SNAPSHOT_VERSION,
    payments: Array.isArray(snap?.payments) ? snap!.payments : [],
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

// Hydrate the Map from the snapshot exactly once per process. Memoized via a
// promise on the singleton so concurrent first-callers all await the same load.
function ensureHydrated(): Promise<void> {
  const s = getState();
  if (!s.hydration) s.hydration = loadSnapshot(s);
  return s.hydration;
}

async function loadSnapshot(s: StoreState): Promise<void> {
  const snap = await readSnapshot();
  for (const p of snap.payments) {
    s.payments.set(p.transactionId, p);
  }
}

// Serialize a synchronous mutation of the Map followed by a full-snapshot
// persist. Chaining off writeQueue means concurrent create/verify calls can't
// clobber each other's writes. A persist failure surfaces to the caller (so the
// route can 500) but does not poison the queue for later writes.
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
    payments: [...s.payments.values()],
  };
  try {
    await writeSnapshot(snapshot);
  } catch (err) {
    throw new PaymentStoreError("failed to persist snapshot", { cause: err });
  }
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

export type CreatePaymentInput = {
  transactionId: string;
  orderId?: string;
  amount?: number;
};

// Create the PENDING payment for a transaction, or return the existing record
// unchanged if one is already tracked. IDEMPOTENT by design: the deterministic
// reference means a repeat create never mints a second payment, and an
// already-PAID payment is never reset to PENDING. When the record already exists
// but the caller now knows an orderId/amount it didn't before, those are filled
// in (never overwriting a value with undefined).
export async function createPayment(
  input: CreatePaymentInput
): Promise<PaymentRecord> {
  await ensureHydrated();
  let result!: PaymentRecord;
  await enqueuePersist(() => {
    const s = getState();
    const existing = s.payments.get(input.transactionId);
    const ts = now();
    if (existing) {
      // Idempotent: keep status/reference/createdAt; only enrich missing fields.
      const merged: PaymentRecord = {
        ...existing,
        orderId: input.orderId ?? existing.orderId,
        amount: input.amount ?? existing.amount,
        updatedAt:
          input.orderId !== undefined || input.amount !== undefined
            ? ts
            : existing.updatedAt,
      };
      s.payments.set(input.transactionId, merged);
      result = merged;
      return;
    }
    const record: PaymentRecord = {
      transactionId: input.transactionId,
      orderId: input.orderId,
      amount: input.amount,
      paymentReference: paymentReferenceFor(input.transactionId),
      status: "PENDING",
      createdAt: ts,
      updatedAt: ts,
    };
    s.payments.set(input.transactionId, record);
    result = record;
  });
  return result;
}

export type UpdatePaymentStatusInput = {
  transactionId: string;
  status: "PENDING" | "PAID";
  bankReference?: string;
};

// Flip a tracked payment's status (the out-of-band /verify step) and record the
// bank reference. Returns null if no payment was ever created for the
// transaction, so the route can answer 404 rather than inventing one — /verify
// reconciles an existing payment, it does not create.
export async function updatePaymentStatus(
  input: UpdatePaymentStatusInput
): Promise<PaymentRecord | null> {
  await ensureHydrated();
  let result: PaymentRecord | null = null;
  await enqueuePersist(() => {
    const s = getState();
    const existing = s.payments.get(input.transactionId);
    if (!existing) return; // result stays null
    const updated: PaymentRecord = {
      ...existing,
      status: input.status,
      bankReference: input.bankReference ?? existing.bankReference,
      updatedAt: now(),
      // Stamp verifiedAt the FIRST time this becomes PAID, and never again:
      // `existing.verifiedAt ?? now()` keeps the original timestamp if it was
      // already PAID (re-verifying an already-settled payment must not rewrite
      // history), and leaves it untouched on any non-PAID update. This write-once
      // semantics is what makes verifiedAt a trustworthy reconciliation anchor.
      verifiedAt:
        input.status === "PAID"
          ? existing.verifiedAt ?? now()
          : existing.verifiedAt,
    };
    s.payments.set(input.transactionId, updated);
    result = updated;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Reads — a miss returns null (the payment simply hasn't been created), never
// throws.
// ---------------------------------------------------------------------------

export async function getPayment(
  transactionId: string
): Promise<PaymentRecord | null> {
  await ensureHydrated();
  return getState().payments.get(transactionId) ?? null;
}

// Resolve a payment by its paymentReference. The reference is a one-way hash of
// transactionId (see paymentReferenceFor), so it can't be reversed to a key —
// /reconcile quotes the reference, not the transaction id, so we scan the values
// to find it. No second index / no duplicated data: payments are keyed by
// transactionId and this is a linear lookup over the same Map. Returns null on a
// miss, never throws.
export async function getPaymentByReference(
  paymentReference: string
): Promise<PaymentRecord | null> {
  await ensureHydrated();
  for (const rec of getState().payments.values()) {
    if (rec.paymentReference === paymentReference) return rec;
  }
  return null;
}
