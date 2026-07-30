import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The timeout test waits for the client's 15s timer; increase the vitest limit.
vi.setConfig({ testTimeout: 25_000 });

const TEST_API_KEY = "pk_test_abc123";
const TEST_BASE_URL = "https://api.tocxi-test.com";

async function createTestClient() {
  const { createTocxiClient } = await import("./client");
  return createTocxiClient({ apiKey: TEST_API_KEY, baseUrl: TEST_BASE_URL, webhookSecret: "secret" });
}

describe("Tocxi HTTP Client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends X-API-Key header on every request", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();
    await client.get("/api/v1/partner/me");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-API-Key"]).toBe(TEST_API_KEY);
  });

  it("sends Idempotency-Key header when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();
    await client.post("/api/v1/partner/shipments", { test: true }, "order-123");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Idempotency-Key"]).toBe("order-123");
  });

  it("does not send Idempotency-Key when not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();
    await client.post("/api/v1/partner/shipments", { test: true });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("retries on 429 after backoff", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve(JSON.stringify({ error: "rate limited" })),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();
    const result = await client.get("/api/v1/partner/me");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it("retries on 5xx up to MAX_RETRIES", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: "server error" })),
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();

    await expect(client.get("/api/v1/partner/me")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on 4xx non-retryable errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: "bad request" })),
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();

    await expect(client.get("/api/v1/partner/me")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("honours timeout via AbortSignal", async () => {
    vi.useFakeTimers();

    // A mock fetch that honours the abort signal so the client's 15s timer
    // actually aborts the request instead of waiting for the mock to settle.
    const mockFetch = vi.fn().mockImplementation(
      (url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (opts?.signal?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
          }
          const onAbort = () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          };
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
        })
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = await createTestClient();
    const getPromise = client.get("/api/v1/partner/me");
    // Suppress unhandled rejection — the rejection is caught by the await
    // in the test below, but Node may detect it as unhandled between
    // microtask ticks.
    getPromise.catch(() => {});

    // Advance past the client's 15s timeout
    await vi.advanceTimersByTimeAsync(16_000);

    await expect(getPromise).rejects.toThrow("timed out");

    vi.useRealTimers();
  });
});
