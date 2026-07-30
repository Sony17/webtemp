import { describe, it, expect, vi, beforeEach } from "vitest";

// The webhook module reads TOCXI_WEBHOOK_SECRET from env. Set a test value.
const TEST_SECRET = "whsec_test_secret_key_12345";

function hmacSha256(payload: string, secret: string): string {
  // Replicate the server-side HMAC so we can forge valid test signatures.
  // The real module uses node:crypto.createHmac; this is the same algorithm.
  const crypto = require("node:crypto");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

describe("Tocxi Webhook Verification", () => {
  beforeEach(() => {
    vi.stubEnv("TOCXI_WEBHOOK_SECRET", TEST_SECRET);
  });

  describe("verifyWebhookSignature", () => {
    it("accepts a valid HMAC signature", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");
      const payload = JSON.stringify({ event: "shipment.status", shipmentId: "shp-1" });
      const signature = hmacSha256(payload, TEST_SECRET);

      const result = await verifyWebhookSignature(payload, signature);
      expect(result).toBe(true);
    });

    it("rejects an invalid HMAC signature", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");
      const payload = JSON.stringify({ event: "shipment.status", shipmentId: "shp-1" });

      const result = await verifyWebhookSignature(payload, "invalid_signature");
      expect(result).toBe(false);
    });

    it("rejects a tampered payload", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");
      const payload = JSON.stringify({ event: "shipment.status", shipmentId: "shp-1" });
      const signature = hmacSha256(payload, TEST_SECRET);

      const tamperedPayload = JSON.stringify({ event: "shipment.status", shipmentId: "shp-2" });
      const result = await verifyWebhookSignature(tamperedPayload, signature);
      expect(result).toBe(false);
    });

    it("returns false when signature header is null", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");

      const result = await verifyWebhookSignature("{}", null);
      expect(result).toBe(false);
    });

    it("returns false when signature header is empty", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");

      const result = await verifyWebhookSignature("{}", "");
      expect(result).toBe(false);
    });

    it("rejects signature with wrong key", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");
      const payload = JSON.stringify({ event: "shipment.status", shipmentId: "shp-1" });
      const wrongKeySig = hmacSha256(payload, "wrong_secret");

      const result = await verifyWebhookSignature(payload, wrongKeySig);
      expect(result).toBe(false);
    });

    it("handles timing-safe comparison correctly for different length signatures", async () => {
      const { verifyWebhookSignature } = await import("./webhooks");
      const payload = JSON.stringify({ event: "shipment.status" });

      const result = await verifyWebhookSignature(payload, "too_short");
      expect(result).toBe(false);
    });
  });

  describe("isStatusTransitionAllowed", () => {
    it("allows forward progression: PENDING → CONFIRMED", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("PENDING", "CONFIRMED")).toBe(true);
    });

    it("rejects backward progression: CONFIRMED → PENDING", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("CONFIRMED", "PENDING")).toBe(false);
    });

    it("rejects same status: CONFIRMED → CONFIRMED", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("CONFIRMED", "CONFIRMED")).toBe(false);
    });

    it("allows CANCELLED from any non-terminal state", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("PENDING", "CANCELLED")).toBe(true);
      expect(isStatusTransitionAllowed("IN_TRANSIT", "CANCELLED")).toBe(true);
    });

    it("allows FAILED from any non-terminal state", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("PENDING", "FAILED")).toBe(true);
      expect(isStatusTransitionAllowed("OUT_FOR_DELIVERY", "FAILED")).toBe(true);
    });

    it("rejects any transition from a terminal state", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("DELIVERED", "CANCELLED")).toBe(false);
      expect(isStatusTransitionAllowed("DELIVERED", "FAILED")).toBe(false);
      expect(isStatusTransitionAllowed("CANCELLED", "PENDING")).toBe(false);
      expect(isStatusTransitionAllowed("FAILED", "PENDING")).toBe(false);
    });

    it("allows progressive: PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED", async () => {
      const { isStatusTransitionAllowed } = await import("./webhooks");
      expect(isStatusTransitionAllowed("PICKED_UP", "IN_TRANSIT")).toBe(true);
      expect(isStatusTransitionAllowed("IN_TRANSIT", "OUT_FOR_DELIVERY")).toBe(true);
      expect(isStatusTransitionAllowed("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    });
  });
});
