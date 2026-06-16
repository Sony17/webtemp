// Ecosysz collection bank account — static payment-instruction config.
//
// ONDC settles out-of-band, and this BAP collects on-order by directing the
// buyer to pay into Ecosysz's own bank account / UPI. These are the destination
// details surfaced by GET /api/payments/instructions alongside the per-payment
// reference + amount from the store. They are deliberately static config (not a
// gateway, not a UPI SDK, not generated QR) — the buyer pays manually and the
// payment is later reconciled via /api/payments/reconcile.
//
// ⚠️ ONLY ECOSYSZ BANK ACCOUNT VALUES REMAIN TO BE FILLED. Every other part of
// the payment implementation is complete; once the real account details below
// are populated, payment instructions go live. Until then the fields are empty
// strings (the instructions endpoint still works — it just returns blanks).
//
//   accountName   — registered name on the Ecosysz collection account
//   accountNumber — Ecosysz bank account number
//   ifsc          — branch IFSC for NEFT/IMPS/RTGS
//   upiId         — Ecosysz UPI VPA (e.g. ecosysz@bank)
//   qrCodeUrl     — URL of a pre-made UPI QR image (NOT generated here)
export const PAYMENT_CONFIG = {
  accountName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
  qrCodeUrl: "",
};
