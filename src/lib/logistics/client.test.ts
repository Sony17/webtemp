// Tocxi client (client.ts) — transport behavior under a mocked fetch.
//
// Pins the cross-cutting concerns tocxiFetch owns, since every public function
// rides on it:
//   * the X-API-Key header is injected on every request;
//   * createShipment sends the Idempotency-Key header (the anti-double-book);
//   * a 429 is retried (honoring Retry-After) and then succeeds;
//   * a 4xx auth failure surfaces as a typed TocxiError carrying the machine
//     code (INVALID_API_KEY) and is NOT retried.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  quote,
  createShipment,
  TocxiError,
} from "./client";

// A fake fetch that yields successive canned Responses from a queue. Each entry
// is { status, body, headers } → a real Response so the client's res.text() /
// res.headers.get() / res.ok paths run for real.
function queueFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("queueFetch: no more responses queued");
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      { status: next.status, headers: next.headers }
    );
  });
  return { fn, calls };
}

const QUOTE_OK = {
  serviceable: true,
  totalPrice: 79,
  codFee: 10,
  estimatedDistanceKm: 18.4,
  estimatedDurationMin: 44,
  currency: "INR",
};

beforeEach(() => {
  process.env.TOCXI_API_KEY = "pk_test_key";
  delete process.env.TOCXI_BASE_URL; // use the default https://api.tocxi.com
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.TOCXI_API_KEY;
});

describe("tocxiFetch auth + base URL", () => {
  it("injects the X-API-Key header and hits the default base URL", async () => {
    const { fn, calls } = queueFetch([{ status: 200, body: QUOTE_OK }]);
    vi.stubGlobal("fetch", fn);

    const res = await quote({
      pickupLatitude: 28.6,
      pickupLongitude: 77.2,
      dropLatitude: 28.5,
      dropLongitude: 77.3,
      cod: true,
      codAmount: 800,
    });

    expect(res).toEqual(QUOTE_OK);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.tocxi.com/api/v1/partner/quote");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("x-api-key")).toBe("pk_test_key");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("createShipment idempotency header", () => {
  it("sends the Idempotency-Key header set to the order id", async () => {
    const { fn, calls } = queueFetch([
      {
        status: 201,
        body: {
          shipmentId: "PRCL-9F3A2B7C",
          partnerReference: "order-88213",
          status: "PENDING",
          estimatedPrice: 129,
          trackingUrl: "https://www.tocxi.com/track/ab12cd34",
        },
      },
    ]);
    vi.stubGlobal("fetch", fn);

    const res = await createShipment(
      {
        partnerReference: "order-88213",
        pickup: { contactName: "Store", contactPhone: "9810000000", latitude: 28.63, longitude: 77.21 },
        drop: { contactName: "Riya", contactPhone: "9820000000", latitude: 28.53, longitude: 77.39 },
        cod: true,
        codAmount: 640,
      },
      "order-88213"
    );

    expect(res.shipmentId).toBe("PRCL-9F3A2B7C");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("idempotency-key")).toBe("order-88213");
  });

  it("refuses to book without an Idempotency-Key (no fetch fired)", async () => {
    const { fn } = queueFetch([]);
    vi.stubGlobal("fetch", fn);
    await expect(
      createShipment({
        // no partnerReference and no explicit key
        pickup: { contactName: "S", contactPhone: "1", latitude: 1, longitude: 1 },
        drop: { contactName: "D", contactPhone: "2", latitude: 2, longitude: 2 },
        cod: true,
        codAmount: 1,
      })
    ).rejects.toBeInstanceOf(TocxiError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("retry policy", () => {
  it("retries a 429 (honoring Retry-After) then succeeds", async () => {
    const { fn, calls } = queueFetch([
      { status: 429, body: { code: "RATE_LIMITED" }, headers: { "Retry-After": "0" } },
      { status: 200, body: QUOTE_OK },
    ]);
    vi.stubGlobal("fetch", fn);

    const res = await quote({
      pickupLatitude: 28.6,
      pickupLongitude: 77.2,
      dropLatitude: 28.5,
      dropLongitude: 77.3,
    });

    expect(res).toEqual(QUOTE_OK);
    expect(calls).toHaveLength(2); // one retry
  });

  it("does NOT retry a 401 and surfaces INVALID_API_KEY as a typed error", async () => {
    const { fn, calls } = queueFetch([
      { status: 401, body: { code: "INVALID_API_KEY" } },
    ]);
    vi.stubGlobal("fetch", fn);

    await expect(
      quote({
        pickupLatitude: 28.6,
        pickupLongitude: 77.2,
        dropLatitude: 28.5,
        dropLongitude: 77.3,
      })
    ).rejects.toMatchObject({
      name: "TocxiError",
      httpStatus: 401,
      code: "INVALID_API_KEY",
    });
    expect(calls).toHaveLength(1); // no retry on a 4xx
  });
});
