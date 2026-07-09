// Payment status endpoint — read the tracked payment for an ONDC transaction.
//
// READ-ONLY. Returns the full PaymentRecord (status, references, amount,
// timestamps) so a buyer UI or an ops console can show "have we marked this
// transaction paid yet, and what's the bank reference." A miss is a 404 — the
// payment was never created via /create — not an empty 200.
//
//   GET /api/payments/status?transactionId=<id>
//
// Mirrors the conventions of the other routes: `NextResponse`,
// `runtime = "nodejs"`, a 400 guard on the required input.
import { NextResponse } from "next/server";
import { getPayment } from "@/lib/payments/store";

// The payment store is `import "server-only"` and touches node:fs / @vercel/blob,
// so this handler must run on the Node runtime, not Edge.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();

  // transactionId is the only key into the payment store for this view — without
  // it there is nothing to look up. Fail fast with a 400.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  const record = await getPayment(transactionId);

  // No record means /create was never called for this transaction. 404 keeps
  // "not tracked" distinct from a tracked-but-still-PENDING payment.
  if (!record) {
    return NextResponse.json(
      { error: "No payment found for this transaction." },
      { status: 404 }
    );
  }

  return NextResponse.json(record, { status: 200 });
}
