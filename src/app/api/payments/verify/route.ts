// Payment verify endpoint — reconcile a tracked payment's status out-of-band.
//
// This is the manual/webhook settlement seam: a payment opened in PENDING by
// /create is flipped here once an out-of-band signal (a bank statement, a PSP
// webhook, an ops check) confirms the money landed. There is NO bank/PSP call in
// this route — it only records the outcome the caller already knows, along with
// the bank reference for the audit trail.
//
//   POST /api/payments/verify
//   {
//     "transactionId": "uuid",     // REQUIRED — the payment to reconcile
//     "status":        "PAID",     // REQUIRED — "PENDING" | "PAID"
//     "bankReference": "UTR12345"  // optional — the bank/PSP settlement ref
//   }
//
// Verify RECONCILES an existing payment; it does not create one. An unknown
// transaction is a 404 (call /create first), not a silent upsert.
//
// Mirrors the conventions of the other routes: `NextResponse`,
// `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import {
  updatePaymentStatus,
  PaymentStoreError,
} from "@/lib/payments/store";
import { autoCreateShipment } from "@/lib/tocxi/auto-shipment";

// The payment store is `import "server-only"` and touches node:fs / @vercel/blob,
// so this handler must run on the Node runtime, not Edge.
export const runtime = "nodejs";

type VerifyRequestBody = {
  transactionId?: string;
  status?: string;
  bankReference?: string;
};

const VALID_STATUSES = ["PENDING", "PAID"] as const;
type PaymentStatus = (typeof VALID_STATUSES)[number];

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank.
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

  const body = (raw ?? {}) as VerifyRequestBody;
  const transactionId = str(body.transactionId);
  const status = str(body.status);
  const bankReference = str(body.bankReference);

  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // status drives the whole call — require it and constrain it to the known set
  // so a typo can't park a payment in an unrepresentable state.
  if (!status || !VALID_STATUSES.includes(status as PaymentStatus)) {
    return NextResponse.json(
      { error: "'status' must be one of: PENDING, PAID." },
      { status: 400 }
    );
  }

  try {
    const record = await updatePaymentStatus({
      transactionId,
      status: status as PaymentStatus,
      bankReference,
    });

    // null means no payment was ever created for this transaction. Verify does
    // not create — surface a 404 so the caller fixes the ordering (create first).
    if (!record) {
      return NextResponse.json(
        { error: "No payment found for this transaction." },
        { status: 404 }
      );
    }

    if (record.status === "PAID" && record.orderId) {
      try {
        await autoCreateShipment({
          transactionId,
          orderId: record.orderId,
          amount: record.amount,
        });
      } catch {
        // best-effort — payment is already verified
      }
    }

    return NextResponse.json(record, { status: 200 });
  } catch (err) {
    const msg =
      err instanceof PaymentStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    console.error("payments.verify fault", { transactionId, message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
