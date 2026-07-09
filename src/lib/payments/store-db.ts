// Payment ledger — Postgres backend (Prisma), used when DATABASE_URL is set.
//
// The dispatcher (store.ts) picks this over store-json when a database is
// configured, so payments — like the ONDC store — are SHARED across serverless
// instances (a per-instance /tmp ledger can't back an admin reconcile console
// that must list every payment consistently). Mirrors the JSON store's function
// surface and idempotency semantics exactly; maps the `ondc_payment` row's
// DateTime columns back to the epoch-ms PaymentRecord shape callers expect.
import "server-only";
import { getPrisma } from "@/lib/db";
import {
  paymentReferenceFor,
  PaymentStoreError,
  type PaymentRecord,
  type CreatePaymentInput,
  type UpdatePaymentStatusInput,
} from "@/lib/payments/store-json";

// Re-export the pure helpers so callers can import everything from one backend.
export { paymentReferenceFor, PaymentStoreError };
export type { PaymentRecord, CreatePaymentInput, UpdatePaymentStatusInput };

type Row = {
  transactionId: string;
  orderId: string | null;
  amount: number | null;
  paymentReference: string;
  status: string;
  bankReference: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Map a Prisma row → the epoch-ms PaymentRecord the routes/JSON store use.
function toRecord(row: Row): PaymentRecord {
  return {
    transactionId: row.transactionId,
    orderId: row.orderId ?? undefined,
    amount: row.amount ?? undefined,
    paymentReference: row.paymentReference,
    status: row.status === "PAID" ? "PAID" : "PENDING",
    bankReference: row.bankReference ?? undefined,
    verifiedAt: row.verifiedAt ? row.verifiedAt.getTime() : undefined,
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

// Create the PENDING payment, or return the existing one — idempotent by the
// deterministic reference / unique transactionId. Enriches orderId/amount when
// newly known; never resets status/reference/createdAt.
export async function createPayment(
  input: CreatePaymentInput
): Promise<PaymentRecord> {
  const prisma = getPrisma();
  try {
    const existing = await prisma.payment.findUnique({
      where: { transactionId: input.transactionId },
    });
    if (existing) {
      // Nothing new to enrich → idempotent no-op (don't bump updatedAt).
      if (input.orderId === undefined && input.amount === undefined) {
        return toRecord(existing);
      }
      const updated = await prisma.payment.update({
        where: { transactionId: input.transactionId },
        data: {
          orderId: input.orderId ?? existing.orderId,
          amount: input.amount ?? existing.amount,
        },
      });
      return toRecord(updated);
    }
    const created = await prisma.payment.create({
      data: {
        transactionId: input.transactionId,
        orderId: input.orderId ?? null,
        amount: input.amount ?? null,
        paymentReference: paymentReferenceFor(input.transactionId),
        status: "PENDING",
      },
    });
    return toRecord(created);
  } catch (err) {
    // Concurrent create for the same transaction — re-fetch the winner.
    if (isUniqueViolation(err)) {
      const winner = await prisma.payment.findUnique({
        where: { transactionId: input.transactionId },
      });
      if (winner) return toRecord(winner);
    }
    throw new PaymentStoreError("failed to persist payment", { cause: err });
  }
}

// Flip status (the reconcile step) + record the bank reference. Returns null if
// no payment exists for the transaction (reconcile updates, never creates).
// verifiedAt is write-once: stamped the first time it becomes PAID, never after.
export async function updatePaymentStatus(
  input: UpdatePaymentStatusInput
): Promise<PaymentRecord | null> {
  const prisma = getPrisma();
  const existing = await prisma.payment.findUnique({
    where: { transactionId: input.transactionId },
  });
  if (!existing) return null;
  try {
    const updated = await prisma.payment.update({
      where: { transactionId: input.transactionId },
      data: {
        status: input.status,
        bankReference: input.bankReference ?? existing.bankReference,
        verifiedAt:
          input.status === "PAID"
            ? existing.verifiedAt ?? new Date()
            : existing.verifiedAt,
      },
    });
    return toRecord(updated);
  } catch (err) {
    throw new PaymentStoreError("failed to update payment", { cause: err });
  }
}

export async function getPayment(
  transactionId: string
): Promise<PaymentRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.payment.findUnique({ where: { transactionId } });
  return row ? toRecord(row) : null;
}

export async function getPaymentByReference(
  paymentReference: string
): Promise<PaymentRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.payment.findUnique({ where: { paymentReference } });
  return row ? toRecord(row) : null;
}

// List payments for the admin reconcile console, newest first. Optionally
// filter by status ("PENDING" to show what still needs reconciling).
export async function listPayments(opts?: {
  status?: "PENDING" | "PAID";
}): Promise<PaymentRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.payment.findMany({
    where: opts?.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRecord);
}
