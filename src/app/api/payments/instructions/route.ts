// Payment instructions endpoint — tell the buyer exactly how to pay.
//
// READ-ONLY. Joins the per-payment data we already track (paymentReference +
// amount, from the payment store) with the static Ecosysz collection-account
// details (from src/lib/payments/config.ts). The buyer pays manually into that
// account quoting the reference; the payment is reconciled later via
// /api/payments/reconcile. No gateway, no UPI SDK, no QR generation here.
//
//   GET /api/payments/instructions?transactionId=<id>
//
// ⚠️ The bank/UPI fields come straight from PAYMENT_CONFIG — ONLY ECOSYSZ BANK
// ACCOUNT VALUES REMAIN TO BE FILLED. Until they are, those fields are blank but
// the endpoint still resolves the reference + amount correctly.
//
// Mirrors the conventions of the other routes: `NextResponse`,
// `runtime = "nodejs"`, a 400 guard on the required input, 404 on an untracked
// transaction.
import { NextResponse } from "next/server";
import { getPayment } from "@/lib/payments/store-json";
import { PAYMENT_CONFIG } from "@/lib/payments/config";

// The payment store is `import "server-only"` and touches node:fs / @vercel/blob,
// so this handler must run on the Node runtime, not Edge.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();

  // transactionId is the only key into the payment store — without it there is
  // nothing to build instructions for. Fail fast with a 400.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required." },
      { status: 400 }
    );
  }

  // Reuse the existing store — the reference + amount are NOT recomputed or
  // duplicated here, they are read back from the record /create persisted.
  const record = await getPayment(transactionId);
  if (!record) {
    return NextResponse.json(
      { error: "No payment found for this transaction." },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      transactionId: record.transactionId,
      paymentReference: record.paymentReference,
      amount: record.amount,
      // Static Ecosysz collection-account details. Blank until filled in config.
      accountName: PAYMENT_CONFIG.accountName,
      accountNumber: PAYMENT_CONFIG.accountNumber,
      ifsc: PAYMENT_CONFIG.ifsc,
      upiId: PAYMENT_CONFIG.upiId,
      qrCodeUrl: PAYMENT_CONFIG.qrCodeUrl,
    },
    { status: 200 }
  );
}
