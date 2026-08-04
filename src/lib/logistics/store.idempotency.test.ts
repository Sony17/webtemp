// Shipment store idempotency + out-of-order semantics (store-json.ts).
//
// These pin the guarantees the create route and the at-least-once webhook depend
// on:
//   * create is idempotent on partnerReference — a re-book returns the existing
//     record, never a second one;
//   * a duplicate status event leaves exactly one history entry;
//   * an out-of-order (backwards) event is ignored;
//   * terminal states behave: CANCELLED overrides a non-terminal state, and
//     DELIVERED is absorbing.
//
// node:fs/promises is mocked so the store runs purely on its in-memory Map:
// hydration reads "empty" and writes are no-ops, keeping the test hermetic and
// off-disk. The globalThis singleton is reset before each test so state can't
// leak between cases.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async () => {
      throw new Error("ENOENT"); // no snapshot → hydrate empty
    }),
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  },
}));

import {
  createShipment,
  updateShipmentStatus,
  getShipmentByReference,
  getShipment,
  getShipmentByTransaction,
  listShipments,
  shouldAdvanceStatus,
  type CreateShipmentInput,
} from "./store-json";
import type { Address } from "./types";

const PICKUP: Address = {
  contactName: "Store #4",
  contactPhone: "9810000000",
  latitude: 28.6304,
  longitude: 77.2177,
};
const DROP: Address = {
  contactName: "Riya",
  contactPhone: "9820000000",
  latitude: 28.5355,
  longitude: 77.391,
};

function baseInput(over: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
  return {
    partnerReference: "order-88213",
    shipmentId: "PRCL-9F3A2B7C",
    status: "PENDING",
    pickup: PICKUP,
    drop: DROP,
    cod: true,
    codAmount: 640,
    ...over,
  };
}

beforeEach(() => {
  // Reset the module-level singleton so each test starts from an empty store.
  delete (globalThis as Record<string, unknown>).__shipmentStore__;
});

describe("createShipment idempotency", () => {
  it("re-booking the same order yields ONE record", async () => {
    const first = await createShipment(baseInput());
    const second = await createShipment(baseInput());

    expect(first.shipmentId).toBe(second.shipmentId);
    expect(first.createdAt).toBe(second.createdAt); // not reset
    const all = await listShipments();
    expect(all).toHaveLength(1);
    expect(all[0].statusHistory).toHaveLength(1);
  });

  it("enriches late-known fields on re-book without clobbering", async () => {
    await createShipment(baseInput()); // no awbNo yet
    const enriched = await createShipment(
      baseInput({ awbNo: "AWB123", trackingUrl: "https://t/x" })
    );
    expect(enriched.awbNo).toBe("AWB123");
    expect(enriched.trackingUrl).toBe("https://t/x");
  });
});

describe("updateShipmentStatus progression", () => {
  it("advances forward and appends one history entry per real change", async () => {
    await createShipment(baseInput());
    await updateShipmentStatus({ partnerReference: "order-88213", status: "CONFIRMED" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "OUT_FOR_DELIVERY",
    });
    expect(rec?.status).toBe("OUT_FOR_DELIVERY");
    expect(rec?.statusHistory.map((e) => e.status)).toEqual([
      "PENDING",
      "CONFIRMED",
      "OUT_FOR_DELIVERY",
    ]);
  });

  it("treats a duplicate event as a no-op (one history entry)", async () => {
    await createShipment(baseInput());
    await updateShipmentStatus({ partnerReference: "order-88213", status: "OUT_FOR_DELIVERY" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "OUT_FOR_DELIVERY",
    });
    const outForDelivery = rec!.statusHistory.filter(
      (e) => e.status === "OUT_FOR_DELIVERY"
    );
    expect(outForDelivery).toHaveLength(1);
  });

  it("ignores an out-of-order (backwards) event", async () => {
    await createShipment(baseInput());
    await updateShipmentStatus({ partnerReference: "order-88213", status: "OUT_FOR_DELIVERY" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "PICKED_UP", // earlier than OUT_FOR_DELIVERY → ignored
    });
    expect(rec?.status).toBe("OUT_FOR_DELIVERY");
    expect(rec?.statusHistory.some((e) => e.status === "PICKED_UP")).toBe(false);
  });

  it("resolves by shipmentId when partnerReference isn't supplied", async () => {
    await createShipment(baseInput());
    const rec = await updateShipmentStatus({
      shipmentId: "PRCL-9F3A2B7C",
      status: "CONFIRMED",
    });
    expect(rec?.status).toBe("CONFIRMED");
  });

  it("returns null when no shipment matches", async () => {
    const rec = await updateShipmentStatus({
      partnerReference: "does-not-exist",
      status: "CONFIRMED",
    });
    expect(rec).toBeNull();
  });

  it("folds a newly-known awbNo in even on a non-advancing event", async () => {
    await createShipment(baseInput());
    await updateShipmentStatus({ partnerReference: "order-88213", status: "IN_TRANSIT" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "IN_TRANSIT", // duplicate…
      awbNo: "AWB999", // …but carries a new awb
    });
    expect(rec?.awbNo).toBe("AWB999");
  });
});

describe("terminal states", () => {
  it("lets CANCELLED override a non-terminal state", async () => {
    await createShipment(baseInput());
    await updateShipmentStatus({ partnerReference: "order-88213", status: "CONFIRMED" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "CANCELLED",
    });
    expect(rec?.status).toBe("CANCELLED");
  });

  it("keeps DELIVERED absorbing (nothing supersedes it)", async () => {
    await createShipment(baseInput({ status: "OUT_FOR_DELIVERY" }));
    await updateShipmentStatus({ partnerReference: "order-88213", status: "DELIVERED" });
    const rec = await updateShipmentStatus({
      partnerReference: "order-88213",
      status: "FAILED",
    });
    expect(rec?.status).toBe("DELIVERED");
  });
});

describe("shouldAdvanceStatus (unit)", () => {
  it("advances forward only", () => {
    expect(shouldAdvanceStatus("PENDING", "CONFIRMED")).toBe(true);
    expect(shouldAdvanceStatus("IN_TRANSIT", "PICKED_UP")).toBe(false);
    expect(shouldAdvanceStatus("CONFIRMED", "CONFIRMED")).toBe(false);
  });
  it("handles terminals", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "CANCELLED")).toBe(true);
    expect(shouldAdvanceStatus("DELIVERED", "FAILED")).toBe(false);
    expect(shouldAdvanceStatus("CANCELLED", "IN_TRANSIT")).toBe(false);
  });
});

describe("reads", () => {
  it("getShipment resolves by shipmentId and getShipmentByReference by order id", async () => {
    await createShipment(baseInput());
    expect((await getShipment("PRCL-9F3A2B7C"))?.partnerReference).toBe("order-88213");
    expect((await getShipmentByReference("order-88213"))?.shipmentId).toBe("PRCL-9F3A2B7C");
    expect(await getShipment("nope")).toBeNull();
  });

  it("getShipmentByTransaction resolves by ONDC txn (buyer-page lookup)", async () => {
    await createShipment(baseInput({ transactionId: "txn-abc" }));
    expect((await getShipmentByTransaction("txn-abc"))?.shipmentId).toBe("PRCL-9F3A2B7C");
    expect(await getShipmentByTransaction("txn-none")).toBeNull();
  });
});
