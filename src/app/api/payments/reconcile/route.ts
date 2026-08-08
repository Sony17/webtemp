// Payment reconcile endpoint — settle a payment quoted by its reference.
//
// Same out-of-band reconciliation step as /api/payments/verify, but keyed by
// paymentReference instead of transactionId — because that is what a bank
// statement / settlement line carries (the buyer was told to quote the
// reference, not the internal transaction id). This route resolves the
// reference back to its payment and then REUSES the existing verification logic
// (updatePaymentStatus) — it does NOT introduce a second settlement path, so
// write-once verifiedAt and all idempotency semantics carry over unchanged.
//
//   POST /api/payments/reconcile
//   {
//     "paymentReference": "PAY-ABC123...",  // REQUIRED — what the bank line quotes
//     "status":           "PAID",           // REQUIRED — "PENDING" | "PAID"
//     "bankReference":    "UTR12345"        // optional — bank/PSP settlement ref
//   }
//
// No bank API is called here — this records an outcome an out-of-band check
// already established. ⚠️ The only thing still missing to wire a real bank feed
// is the Ecosysz account details in src/lib/payments/config.ts; the settlement
// path itself is complete.
//
// Mirrors the conventions of the other routes: `NextResponse`,
// `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import {
  getPaymentByReference,
  updatePaymentStatus,
  PaymentStoreError,
} from "@/lib/payments/store";

// The payment store is `import "server-only"` and touches node:fs / @vercel/blob,
// so this handler must run on the Node runtime, not Edge.
export const runtime = "nodejs";

type ReconcileRequestBody = {
  paymentReference?: string;
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
  const denied = requireAdmin(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = (raw ?? {}) as ReconcileRequestBody;
  const paymentReference = str(body.paymentReference);
  const status = str(body.status);
  const bankReference = str(body.bankReference);

  if (!paymentReference) {
    return NextResponse.json(
      { error: "'paymentReference' is required." },
      { status: 400 }
    );
  }

  // status drives the whole call — require it and constrain it to the known set.
  if (!status || !VALID_STATUSES.includes(status as PaymentStatus)) {
    return NextResponse.json(
      { error: "'status' must be one of: PENDING, PAID." },
      { status: 400 }
    );
  }

  try {
    // Resolve the reference to its payment so we can drive the existing
    // transactionId-keyed verification logic.
    const found = await getPaymentByReference(paymentReference);
    if (!found) {
      return NextResponse.json(
        { error: "No payment found for this reference." },
        { status: 404 }
      );
    }

    // REUSE the existing verification path — same write-once verifiedAt + 404
    // semantics as /verify, no duplicate settlement logic.
    const record = await updatePaymentStatus({
      transactionId: found.transactionId,
      status: status as PaymentStatus,
      bankReference,
    });

    // Defensive: the payment existed a moment ago, so a null here would only
    // mean a concurrent delete — treat it as not-found rather than 500.
    if (!record) {
      return NextResponse.json(
        { error: "No payment found for this reference." },
        { status: 404 }
      );
    }

    return NextResponse.json(record, { status: 200 });
  } catch (err) {
    const msg =
      err instanceof PaymentStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    console.error("payments.reconcile fault", { paymentReference, message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
