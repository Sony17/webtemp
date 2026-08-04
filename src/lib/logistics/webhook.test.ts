// Webhook signature verification (webhook.ts).
//
// The trust boundary: a valid HMAC-SHA256 over the raw body passes; a tampered
// body (or wrong secret, or missing/garbage header) fails. verifyTocxiSignature
// reads the secret from TOCXI_WEBHOOK_SECRET, so we set it per test.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeTocxiSignature, verifyTocxiSignature } from "./webhook";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({
  event: "shipment.status",
  shipmentId: "PRCL-9F3A2B7C",
  partnerReference: "order-88213",
  status: "OUT_FOR_DELIVERY",
  timestamp: "2026-07-29T17:05:11",
});

beforeEach(() => {
  process.env.TOCXI_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.TOCXI_WEBHOOK_SECRET;
});

describe("verifyTocxiSignature", () => {
  it("accepts a correct signature over the exact raw body", () => {
    const sig = computeTocxiSignature(BODY, SECRET);
    expect(verifyTocxiSignature(BODY, sig)).toBe(true);
  });

  it("accepts an upper-cased hex signature (case-insensitive)", () => {
    const sig = computeTocxiSignature(BODY, SECRET).toUpperCase();
    expect(verifyTocxiSignature(BODY, sig)).toBe(true);
  });

  it("rejects a tampered body against a signature for the original", () => {
    const sig = computeTocxiSignature(BODY, SECRET);
    const tampered = BODY.replace("OUT_FOR_DELIVERY", "DELIVERED");
    expect(verifyTocxiSignature(tampered, sig)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const sig = computeTocxiSignature(BODY, "wrong-secret");
    expect(verifyTocxiSignature(BODY, sig)).toBe(false);
  });

  it("rejects a missing or blank header", () => {
    expect(verifyTocxiSignature(BODY, null)).toBe(false);
    expect(verifyTocxiSignature(BODY, "")).toBe(false);
    expect(verifyTocxiSignature(BODY, "   ")).toBe(false);
  });

  it("rejects a non-hex / wrong-length header without throwing", () => {
    expect(verifyTocxiSignature(BODY, "not-a-hex-signature")).toBe(false);
    expect(verifyTocxiSignature(BODY, "deadbeef")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    delete process.env.TOCXI_WEBHOOK_SECRET;
    const sig = computeTocxiSignature(BODY, SECRET);
    expect(verifyTocxiSignature(BODY, sig)).toBe(false);
  });
});
