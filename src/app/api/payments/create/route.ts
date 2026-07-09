// Payment create endpoint — open a PENDING payment for an ONDC transaction.
//
// This is the BAP's own money-tracking seam, NOT a payment gateway. ONDC settles
// out-of-band; here we simply record that "this transaction is expected to be
// paid" and hand back a stable reference the buyer (and a later bank
// reconciliation) can quote. No funds move, no PSP is called.
//
//   POST /api/payments/create
//   {
//     "transactionId": "uuid",   // REQUIRED — the ONDC transaction this pays for
//     "orderId":       "O123",   // optional — BPP order id, once on_confirm has one
//     "amount":        499.0     // optional — order amount, once the quote is firm
//   }
//
// The paymentReference is derived DETERMINISTICALLY from transactionId, so this
// route is idempotent: re-posting the same transactionId returns the same
// reference and never resets a payment that has already been marked PAID.
//
// Mirrors the conventions of the other routes in this app: `NextResponse`,
// `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import { createPayment, PaymentStoreError } from "@/lib/payments/store";

// The payment store is `import "server-only"` and touches node:fs / node:crypto
// / @vercel/blob, so this handler must run on the Node runtime, not Edge — the
// same choice as every other API route in this app.
export const runtime = "nodejs";

type CreateRequestBody = {
  transactionId?: string;
  orderId?: string;
  amount?: number;
};

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple.
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = (raw ?? {}) as CreateRequestBody;
  const transactionId = str(body.transactionId);
  const orderId = str(body.orderId);

  // transactionId is the key the whole payment hangs off — without it there is
  // nothing to track. Fail fast with a 400.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // amount is optional, but if present it must be a real, finite, non-negative
  // number — reject garbage up-front rather than persisting it.
  let amount: number | undefined;
  if (body.amount !== undefined && body.amount !== null) {
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
      return NextResponse.json(
        { error: "'amount' must be a non-negative finite number." },
        { status: 400 }
      );
    }
    amount = body.amount;
  }

  try {
    const record = await createPayment({ transactionId, orderId, amount });

    // Documented response shape. status is the record's current status — on a
    // fresh create that is always "PENDING"; on an idempotent re-create of an
    // already-settled payment we report its true status rather than lie.
    return NextResponse.json(
      {
        transactionId: record.transactionId,
        paymentReference: record.paymentReference,
        status: record.status,
      },
      { status: 200 }
    );
  } catch (err) {
    // The only expected failure is a snapshot-persist fault — a real server-side
    // problem the operator must fix.
    const msg =
      err instanceof PaymentStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    console.error("payments.create fault", { transactionId, message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
