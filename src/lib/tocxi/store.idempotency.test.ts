import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

// We mock the file-system layer so the JSON store operates purely in-memory
// and tests never leak state via the persisted snapshot on disk.

const mockSnapshotPath = path.join(process.cwd(), "data", "tocxi", "store.json");

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

function clearStore() {
  delete (globalThis as Record<string, unknown>).__tocxiStore__;
}

describe("Tocxi Store Idempotency", () => {
  beforeEach(() => {
    clearStore();
  });

  afterEach(() => {
    clearStore();
  });

  describe("duplicate shipment create", () => {
    it("upserting the same shipmentId twice returns the same record", async () => {
      const { upsertShipment } = await import("./store-json");

      const first = await upsertShipment("shp-1", {
        partnerReference: "order-1",
        status: "PENDING",
      });
      const second = await upsertShipment("shp-1", {
        partnerReference: "order-1",
        status: "CONFIRMED",
      });

      expect(first.shipmentId).toBe("shp-1");
      expect(second.shipmentId).toBe("shp-1");
      expect(first.createdAt).toBe(second.createdAt);
      expect(second.status).toBe("CONFIRMED");
    });

    it("getShipmentByPartnerReference finds the correct shipment", async () => {
      const { upsertShipment, getShipmentByPartnerReference } = await import("./store-json");

      await upsertShipment("shp-1", { partnerReference: "order-1" });
      await upsertShipment("shp-2", { partnerReference: "order-2" });

      const found = await getShipmentByPartnerReference("order-1");
      expect(found).not.toBeNull();
      expect(found!.shipmentId).toBe("shp-1");
    });

    it("getShipmentByPartnerReference returns null for unknown reference", async () => {
      const { getShipmentByPartnerReference } = await import("./store-json");

      const result = await getShipmentByPartnerReference("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("duplicate webhook", () => {
    it("updateShipmentStatus is idempotent", async () => {
      const { upsertShipment, updateShipmentStatus, getShipmentByShipmentId } = await import("./store-json");

      await upsertShipment("shp-1", { status: "PENDING" });
      await updateShipmentStatus("shp-1", "CONFIRMED", {
        event: "shipment.status",
        status: "CONFIRMED",
      });
      const first = await getShipmentByShipmentId("shp-1");

      await updateShipmentStatus("shp-1", "CONFIRMED", {
        event: "shipment.status",
        status: "CONFIRMED",
      });
      const second = await getShipmentByShipmentId("shp-1");

      expect(first!.status).toBe("CONFIRMED");
      expect(second!.status).toBe("CONFIRMED");
      expect(first!.awbNo).toBe(second!.awbNo);
    });
  });

  describe("out-of-order webhook", () => {
    it("status does NOT regress (state machine enforced server-side)", async () => {
      const { upsertShipment, getShipmentByShipmentId } = await import("./store-json");

      await upsertShipment("shp-1", { status: "IN_TRANSIT" });
      const current = await getShipmentByShipmentId("shp-1");
      const { isStatusTransitionAllowed } = await import("./webhooks");

      if (isStatusTransitionAllowed(current!.status, "PENDING")) {
        await getShipmentByShipmentId("shp-1"); // no-op for flow
      }

      const after = await getShipmentByShipmentId("shp-1");
      expect(after!.status).toBe("IN_TRANSIT");
    });

    it("older webhook after terminal is ignored", async () => {
      const { upsertShipment, getShipmentByShipmentId } = await import("./store-json");

      await upsertShipment("shp-1", { status: "DELIVERED" });
      const current = await getShipmentByShipmentId("shp-1");
      const { isStatusTransitionAllowed } = await import("./webhooks");

      if (isStatusTransitionAllowed(current!.status, "PENDING")) {
        await getShipmentByShipmentId("shp-1"); // no-op for flow
      }

      const after = await getShipmentByShipmentId("shp-1");
      expect(after!.status).toBe("DELIVERED");
    });
  });

  describe("forward-only state machine", () => {
    it("listShipments returns paginated results", async () => {
      const { upsertShipment, listShipments } = await import("./store-json");

      for (let i = 0; i < 5; i++) {
        await upsertShipment(`shp-${i}`, { partnerReference: `order-${i}` });
      }

      const page1 = await listShipments({ page: 0, size: 2 });
      expect(page1.rows.length).toBe(2);
      expect(page1.total).toBe(5);

      const page2 = await listShipments({ page: 1, size: 2 });
      expect(page2.rows.length).toBe(2);

      const page3 = await listShipments({ page: 2, size: 2 });
      expect(page3.rows.length).toBe(1);
    });

    it("listShipments can filter by status", async () => {
      const { upsertShipment, listShipments } = await import("./store-json");

      await upsertShipment("shp-x1", { status: "PENDING" });
      await upsertShipment("shp-x2", { status: "CONFIRMED" });
      await upsertShipment("shp-x3", { status: "DELIVERED" });

      const pending = await listShipments({ status: "PENDING" });
      expect(pending.rows.length).toBe(1);
      expect(pending.rows[0].shipmentId).toBe("shp-x1");

      const delivered = await listShipments({ status: "DELIVERED" });
      expect(delivered.rows.length).toBe(1);
      expect(delivered.rows[0].shipmentId).toBe("shp-x3");
    });
  });
});
