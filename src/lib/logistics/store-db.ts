// Logistics shipment ledger — Postgres backend (Prisma), used when DATABASE_URL
// is set.
//
// The dispatcher (store.ts) picks this over store-json when a database is
// configured, so shipments — like payments and the ONDC store — are SHARED across
// serverless instances (a per-instance /tmp ledger can't back an admin ops
// console that must list every shipment consistently, nor receive a webhook on
// one instance and be read on another). Mirrors the JSON store's function surface
// and idempotency semantics exactly; maps the `logistics_shipment` row's JSON /
// DateTime columns back to the epoch-ms ShipmentRecord shape callers expect.
import "server-only";
import { getPrisma } from "@/lib/db";
import {
  ShipmentStoreError,
  shouldAdvanceStatus,
  type ShipmentRecord,
  type ShipmentStatusEvent,
  type CreateShipmentInput,
  type UpdateShipmentStatusInput,
} from "@/lib/logistics/store-json";
import type {
  Address,
  ParcelSize,
  QuoteResponse,
  ShipmentStatus,
} from "@/lib/logistics/types";
import { isShipmentStatus } from "@/lib/logistics/types";

// Re-export the pure helpers/types so callers can import everything from one
// backend, exactly like payments/store-db re-exports paymentReferenceFor.
export { ShipmentStoreError, shouldAdvanceStatus };
export type {
  ShipmentRecord,
  ShipmentStatusEvent,
  CreateShipmentInput,
  UpdateShipmentStatusInput,
};

type Row = {
  partnerReference: string;
  shipmentId: string;
  transactionId: string | null;
  status: string;
  pickup: unknown;
  drop: unknown;
  parcelSize: string | null;
  weightKg: number | null;
  cod: boolean;
  codAmount: number | null;
  quote: unknown;
  estimatedPrice: number | null;
  trackingUrl: string | null;
  awbNo: string | null;
  statusHistory: unknown;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function coerceStatus(v: string): ShipmentStatus {
  return isShipmentStatus(v) ? v : "PENDING";
}

// Map a Prisma row → the epoch-ms ShipmentRecord the routes/JSON store use. JSON
// columns come back as parsed values; we trust their shape (we control every
// write) but coerce the status enum defensively.
function toRecord(row: Row): ShipmentRecord {
  return {
    partnerReference: row.partnerReference,
    shipmentId: row.shipmentId,
    transactionId: row.transactionId ?? undefined,
    status: coerceStatus(row.status),
    pickup: row.pickup as Address,
    drop: row.drop as Address,
    parcelSize: (row.parcelSize as ParcelSize | null) ?? undefined,
    weightKg: row.weightKg ?? undefined,
    cod: row.cod,
    codAmount: row.codAmount ?? undefined,
    quote: (row.quote as QuoteResponse | null) ?? undefined,
    estimatedPrice: row.estimatedPrice ?? undefined,
    trackingUrl: row.trackingUrl ?? undefined,
    awbNo: row.awbNo ?? undefined,
    statusHistory: Array.isArray(row.statusHistory)
      ? (row.statusHistory as ShipmentStatusEvent[])
      : [],
    lastEventAt: row.lastEventAt ? row.lastEventAt.getTime() : undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// Record a booked shipment, or return the existing one — idempotent on the unique
// partnerReference. Enriches late-known fields (awbNo/trackingUrl/…) without
// resetting status/createdAt.
export async function createShipment(
  input: CreateShipmentInput
): Promise<ShipmentRecord> {
  const prisma = getPrisma();
  try {
    const existing = await prisma.shipment.findUnique({
      where: { partnerReference: input.partnerReference },
    });
    if (existing) {
      const row = existing as unknown as Row;
      const updated = await prisma.shipment.update({
        where: { partnerReference: input.partnerReference },
        data: {
          transactionId: row.transactionId ?? input.transactionId ?? null,
          awbNo: row.awbNo ?? input.awbNo ?? null,
          trackingUrl: row.trackingUrl ?? input.trackingUrl ?? null,
          estimatedPrice: row.estimatedPrice ?? input.estimatedPrice ?? null,
          quote:
            (row.quote as QuoteResponse | null) ?? input.quote ?? undefined,
        },
      });
      return toRecord(updated as unknown as Row);
    }
    const ts = new Date();
    const created = await prisma.shipment.create({
      data: {
        partnerReference: input.partnerReference,
        shipmentId: input.shipmentId,
        transactionId: input.transactionId ?? null,
        status: input.status,
        pickup: input.pickup as object,
        drop: input.drop as object,
        parcelSize: input.parcelSize ?? null,
        weightKg: input.weightKg ?? null,
        cod: input.cod,
        codAmount: input.codAmount ?? null,
        quote: (input.quote as object | undefined) ?? undefined,
        estimatedPrice: input.estimatedPrice ?? null,
        trackingUrl: input.trackingUrl ?? null,
        awbNo: input.awbNo ?? null,
        statusHistory: [
          { status: input.status, at: ts.getTime() },
        ] as object,
        lastEventAt: ts,
      },
    });
    return toRecord(created as unknown as Row);
  } catch (err) {
    // Concurrent create for the same order — re-fetch the winner.
    if (isUniqueViolation(err)) {
      const winner = await prisma.shipment.findUnique({
        where: { partnerReference: input.partnerReference },
      });
      if (winner) return toRecord(winner as unknown as Row);
    }
    throw new ShipmentStoreError("failed to persist shipment", { cause: err });
  }
}

// Advance a shipment's status idempotently. Returns null when no shipment matches
// either key. A duplicate/out-of-order event (shouldAdvanceStatus === false) is a
// no-op that does not append to statusHistory, so replaying leaves one entry.
export async function updateShipmentStatus(
  input: UpdateShipmentStatusInput
): Promise<ShipmentRecord | null> {
  const prisma = getPrisma();
  const existing = await resolveRow(
    input.partnerReference,
    input.shipmentId
  );
  if (!existing) return null;
  const current = toRecord(existing);
  const advance = shouldAdvanceStatus(current.status, input.status);
  const awbNo = current.awbNo ?? input.awbNo;

  if (!advance) {
    // Non-advancing: only touch the row if a newly-known awbNo warrants it.
    if (awbNo !== current.awbNo) {
      const patched = await prisma.shipment.update({
        where: { partnerReference: current.partnerReference },
        data: { awbNo: awbNo ?? null },
      });
      return toRecord(patched as unknown as Row);
    }
    return current;
  }

  const ts = new Date();
  const nextHistory: ShipmentStatusEvent[] = [
    ...current.statusHistory,
    { status: input.status, at: ts.getTime(), eventTimestamp: input.eventTimestamp },
  ];
  try {
    const updated = await prisma.shipment.update({
      where: { partnerReference: current.partnerReference },
      data: {
        status: input.status,
        awbNo: awbNo ?? null,
        statusHistory: nextHistory as object,
        lastEventAt: ts,
      },
    });
    return toRecord(updated as unknown as Row);
  } catch (err) {
    throw new ShipmentStoreError("failed to update shipment", { cause: err });
  }
}

// Resolve a row by partnerReference (preferred) or shipmentId (both @unique).
async function resolveRow(
  partnerReference?: string,
  shipmentId?: string
): Promise<Row | null> {
  const prisma = getPrisma();
  if (partnerReference) {
    const byRef = await prisma.shipment.findUnique({
      where: { partnerReference },
    });
    if (byRef) return byRef as unknown as Row;
  }
  if (shipmentId) {
    const byId = await prisma.shipment.findUnique({ where: { shipmentId } });
    if (byId) return byId as unknown as Row;
  }
  return null;
}

export async function getShipmentByReference(
  partnerReference: string
): Promise<ShipmentRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.shipment.findUnique({
    where: { partnerReference },
  });
  return row ? toRecord(row as unknown as Row) : null;
}

export async function getShipment(
  shipmentId: string
): Promise<ShipmentRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.shipment.findUnique({ where: { shipmentId } });
  return row ? toRecord(row as unknown as Row) : null;
}

export async function listShipments(opts?: {
  status?: ShipmentStatus;
  limit?: number;
}): Promise<ShipmentRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.shipment.findMany({
    where: opts?.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: opts?.limit,
  });
  return rows.map((r) => toRecord(r as unknown as Row));
}
