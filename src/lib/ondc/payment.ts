// ONDC payment metadata — shared vocabulary + validator.
//
// The wire carries `payments` (an array in 1.2.x; a singular object is tolerated
// for legacy senders). This module owns the allowed enum values and the single
// `validatePayments` check the callbacks reuse, so the rules live in one
// auditable place rather than inline in each route. No gateway / settlement /
// webhook logic — this validates METADATA shape only.

// payment.type — when the amount is collected, relative to the fulfillment.
export const PAYMENT_TYPES = [
  "ON-ORDER",
  "PRE-FULFILLMENT",
  "ON-FULFILLMENT",
  "POST-FULFILLMENT",
] as const;

// payment.collected_by — which network participant collects the amount.
export const PAYMENT_COLLECTED_BY = ["BAP", "BPP"] as const;

// payment.status — optional; whether the amount has been paid.
export const PAYMENT_STATUS = ["PAID", "NOT-PAID"] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type PaymentCollectedBy = (typeof PAYMENT_COLLECTED_BY)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function includes<T extends string>(
  allowed: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

// Validate the `payments` facet of an order.
//   undefined / null  → valid (absent payments keeps prior behavior)
//   object            → validated as a single payment
//   array             → every element validated
// Each payment must carry a known `type` and `collected_by`; `status`, when
// present, must be a known value. Returns the first problem as a reason string.
export function validatePayments(value: unknown): ValidationResult {
  if (value === undefined || value === null) return { ok: true };

  const payments = Array.isArray(value) ? value : [value];
  for (const p of payments) {
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "invalid payments" };
    }
    const payment = p as {
      type?: unknown;
      collected_by?: unknown;
      status?: unknown;
    };
    if (!includes(PAYMENT_TYPES, payment.type)) {
      return { ok: false, reason: "invalid payment type" };
    }
    if (!includes(PAYMENT_COLLECTED_BY, payment.collected_by)) {
      return { ok: false, reason: "invalid payment collected_by" };
    }
    if (
      payment.status !== undefined &&
      payment.status !== null &&
      !includes(PAYMENT_STATUS, payment.status)
    ) {
      return { ok: false, reason: "invalid payment status" };
    }
  }
  return { ok: true };
}
