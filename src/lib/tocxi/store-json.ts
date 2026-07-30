import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";

export type TocxiShipmentRecord = {
  shipmentId: string;
  partnerReference: string | null;
  status: string;
  estimatedPrice: number | null;
  trackingUrl: string | null;
  awbNo: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupAddressLine: string | null;
  pickupPincode: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropContactName: string | null;
  dropContactPhone: string | null;
  dropAddressLine: string | null;
  dropPincode: string | null;
  dropLatitude: number | null;
  dropLongitude: number | null;
  packageDescription: string | null;
  parcelSize: string | null;
  weightKg: number | null;
  declaredValue: number | null;
  cod: boolean;
  codAmount: number | null;
  estimatedDistanceKm: number | null;
  estimatedDurationMin: number | null;
  codFee: number | null;
  totalPrice: number | null;
  lastWebhookEvent: string | null;
  lastWebhookPayload: unknown;
  createdAt: number;
  updatedAt: number;
  cancelledAt: number | null;
};

const SNAPSHOT_VERSION = 1 as const;

const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "tocxi", "store.json")
  : path.join(process.cwd(), "data", "tocxi", "store.json");
const BLOB_KEY = "system/tocxi/store.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

type StoreSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  shipments: TocxiShipmentRecord[];
};

type StoreState = {
  shipments: Map<string, TocxiShipmentRecord>;
  hydration: Promise<void> | null;
  writeQueue: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __tocxiStore__: StoreState | undefined;
}

function getState(): StoreState {
  if (!globalThis.__tocxiStore__) {
    globalThis.__tocxiStore__ = {
      shipments: new Map(),
      hydration: null,
      writeQueue: Promise.resolve(),
    };
  }
  return globalThis.__tocxiStore__;
}

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
  for (const r of snap.shipments) {
    s.shipments.set(r.shipmentId, r);
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
  await writeSnapshot(snapshot);
}

function now(): number {
  return Date.now();
}

export async function upsertShipment(
  shipmentId: string,
  data: Record<string, unknown>
): Promise<TocxiShipmentRecord> {
  await ensureHydrated();
  let result!: TocxiShipmentRecord;
  await enqueuePersist(() => {
    const s = getState();
    const existing = s.shipments.get(shipmentId);
    const ts = now();
    if (existing) {
      const merged: TocxiShipmentRecord = {
        ...existing,
        ...data,
        shipmentId,
        updatedAt: ts,
      };
      s.shipments.set(shipmentId, merged);
      result = merged;
      return;
    }
    const record: TocxiShipmentRecord = {
      status: "PENDING",
      partnerReference: null,
      estimatedPrice: null,
      trackingUrl: null,
      awbNo: null,
      pickupContactName: null,
      pickupContactPhone: null,
      pickupAddressLine: null,
      pickupPincode: null,
      pickupLatitude: null,
      pickupLongitude: null,
      dropContactName: null,
      dropContactPhone: null,
      dropAddressLine: null,
      dropPincode: null,
      dropLatitude: null,
      dropLongitude: null,
      packageDescription: null,
      parcelSize: null,
      weightKg: null,
      declaredValue: null,
      cod: false,
      codAmount: null,
      estimatedDistanceKm: null,
      estimatedDurationMin: null,
      codFee: null,
      totalPrice: null,
      lastWebhookEvent: null,
      lastWebhookPayload: null,
      createdAt: ts,
      updatedAt: ts,
      cancelledAt: null,
      ...data,
      shipmentId,
    };
    s.shipments.set(shipmentId, record);
    result = record;
  });
  return result;
}

export async function getShipmentByShipmentId(
  shipmentId: string
): Promise<TocxiShipmentRecord | null> {
  await ensureHydrated();
  return getState().shipments.get(shipmentId) ?? null;
}

export async function getShipmentByPartnerReference(
  partnerReference: string
): Promise<TocxiShipmentRecord | null> {
  await ensureHydrated();
  for (const r of getState().shipments.values()) {
    if (r.partnerReference === partnerReference) return r;
  }
  return null;
}

export async function listShipments(options: {
  page?: number;
  size?: number;
  status?: string;
  search?: string;
} = {}): Promise<{ rows: TocxiShipmentRecord[]; total: number }> {
  await ensureHydrated();
  const all = [...getState().shipments.values()];
  let filtered = all;
  if (options.status) {
    filtered = filtered.filter(
      (r) => r.status.toUpperCase() === options.status!.toUpperCase()
    );
  }
  if (options.search) {
    const q = options.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.shipmentId.toLowerCase().includes(q) ||
        (r.partnerReference ?? "").toLowerCase().includes(q)
    );
  }
  const sorted = filtered.sort((a, b) => b.createdAt - a.createdAt);
  const page = options.page ?? 0;
  const size = options.size ?? 20;
  const start = page * size;
  return {
    rows: sorted.slice(start, start + size),
    total: sorted.length,
  };
}

export async function updateShipmentStatus(
  shipmentId: string,
  status: string,
  webhookPayload?: Record<string, unknown>
): Promise<TocxiShipmentRecord> {
  const data: Record<string, unknown> = { status };
  if (webhookPayload) {
    data.lastWebhookPayload = webhookPayload;
    data.lastWebhookEvent = webhookPayload.event as string;
  }
  return upsertShipment(shipmentId, data);
}
