// Tests for the shared ONDC payment-metadata validator (payment.ts).
//
// validatePayments accepts either a single payment object or an array, and
// returns { ok: true } or { ok: false, reason }. These tests pin the CURRENT
// behavior of the validator — see the "amount = 0" / "amount < 0" cases, which
// document a known gap (non-positive amounts are accepted today).
import { describe, it, expect } from "vitest";
import { validatePayments } from "./payment";

// A minimal payment that satisfies every required field.
const validPayment = {
  type: "ON-ORDER",
  collected_by: "BPP",
  status: "PAID",
  params: { amount: "100.00", currency: "INR" },
};

describe("validatePayments", () => {
  it("accepts a valid single payment object", () => {
    expect(validatePayments(validPayment)).toEqual({ ok: true });
  });

  it("accepts a valid array of payments", () => {
    expect(
      validatePayments([
        validPayment,
        { type: "ON-FULFILLMENT", collected_by: "BAP", status: "NOT-PAID" },
      ])
    ).toEqual({ ok: true });
  });

  it("rejects an invalid payment.type", () => {
    const r = validatePayments({ ...validPayment, type: "WHENEVER" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe("invalid payment type");
  });

  it("rejects an invalid payment.collected_by", () => {
    const r = validatePayments({ ...validPayment, collected_by: "NOBODY" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "invalid payment collected_by"
    );
  });

  it("rejects an invalid payment.status", () => {
    const r = validatePayments({ ...validPayment, status: "MAYBE" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe("invalid payment status");
  });

  it("rejects a non-numeric params.amount", () => {
    const r = validatePayments({
      ...validPayment,
      params: { amount: "abc", currency: "INR" },
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "invalid payment params.amount"
    );
  });

  it("rejects an empty params.currency", () => {
    const r = validatePayments({
      ...validPayment,
      params: { amount: "100.00", currency: "" },
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "invalid payment params.currency"
    );
  });

  it("rejects amount = 0", () => {
    const r = validatePayments({
      ...validPayment,
      params: { amount: "0", currency: "INR" },
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "invalid payment params.amount"
    );
  });

  it("rejects amount < 0", () => {
    const r = validatePayments({
      ...validPayment,
      params: { amount: "-50", currency: "INR" },
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "invalid payment params.amount"
    );
  });

  it("rejects amount = Infinity", () => {
  const r = validatePayments({
    ...validPayment,
    params: { amount: "Infinity", currency: "INR" },
  });

  expect(r.ok).toBe(false);
  expect((r as { reason: string }).reason).toBe(
    "invalid payment params.amount"
  );
});

it("rejects overflowing exponential amounts", () => {
  const r = validatePayments({
    ...validPayment,
    params: { amount: "1e999", currency: "INR" },
  });

  expect(r.ok).toBe(false);
  expect((r as { reason: string }).reason).toBe(
    "invalid payment params.amount"
  );
});

  it("treats null payments as valid (absent payments)", () => {
    expect(validatePayments(null)).toEqual({ ok: true });
  });

  it("treats undefined payments as valid (absent payments)", () => {
    expect(validatePayments(undefined)).toEqual({ ok: true });
  });

  it("accepts the object payment form", () => {
    expect(validatePayments(validPayment)).toEqual({ ok: true });
  });

  it("accepts the array payment form", () => {
    expect(validatePayments([validPayment])).toEqual({ ok: true });
  });
});
