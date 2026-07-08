// Ecosysz collection bank account — payment-instruction config, read from ENV.
//
// ONDC settles out-of-band, and this BAP collects on-order by directing the
// buyer to pay into Ecosysz's own bank account / UPI. These destination details
// are surfaced by GET /api/payments/instructions alongside the per-payment
// reference + amount from the store. Manual settlement — no gateway, no UPI SDK,
// no generated QR; the buyer pays manually and it's later reconciled via
// /api/payments/reconcile.
//
// Read from environment variables (NOT hard-coded) so the real account number /
// UPI never live in this PUBLIC repo. Set these in Vercel → Settings →
// Environment Variables (Production), then redeploy:
//
//   PAYMENT_ACCOUNT_NAME    — registered name on the collection account
//   PAYMENT_UPI_ID          — UPI VPA (e.g. name@hdfc)          [simplest to pay]
//   PAYMENT_ACCOUNT_NUMBER  — bank account number               [for NEFT/IMPS]
//   PAYMENT_IFSC            — branch IFSC                        [with account no]
//   PAYMENT_QR_CODE_URL     — hosted UPI-QR image URL           [optional]
//
// Read via a getter (not a module-load constant) so serverless picks up the
// runtime environment on each request. Missing vars return "" — the instructions
// endpoint still responds, just with blanks (as before).
export type PaymentConfig = {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  qrCodeUrl: string;
};

export function getPaymentConfig(): PaymentConfig {
  const env = (key: string): string => process.env[key]?.trim() ?? "";
  return {
    accountName: env("PAYMENT_ACCOUNT_NAME"),
    accountNumber: env("PAYMENT_ACCOUNT_NUMBER"),
    ifsc: env("PAYMENT_IFSC"),
    upiId: env("PAYMENT_UPI_ID"),
    qrCodeUrl: env("PAYMENT_QR_CODE_URL"),
  };
}
