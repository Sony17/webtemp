import "server-only";
import type { TocxiConfig, TocxiApiError } from "./types";

export class TocxiClientError extends Error {
  readonly httpStatus?: number;
  readonly code?: string;
  readonly timeout: boolean;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      httpStatus?: number;
      code?: string;
      timeout?: boolean;
      retryable?: boolean;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "TocxiClientError";
    this.httpStatus = options.httpStatus;
    this.code = options.code;
    this.timeout = options.timeout ?? false;
    this.retryable = options.retryable ?? false;
  }
}

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 500;

function isRetryable(httpStatus: number | undefined): boolean {
  if (!httpStatus) return true;
  if (httpStatus === 429) return true;
  if (httpStatus >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTocxiClient(config: TocxiConfig) {
  async function request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    };
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutMs = 15_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const combinedSignal = options.signal
          ? combineAbortSignals(options.signal, controller.signal)
          : controller.signal;

        const res = await fetch(url, {
          method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: combinedSignal,
        });

        clearTimeout(timer);

        let data: unknown;
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }

        if (!res.ok) {
          const errData = data as { code?: string; message?: string } | null;
          const err = new TocxiClientError(
            errData?.message ?? `Tocxi API returned HTTP ${res.status}`,
            {
              httpStatus: res.status,
              code: errData?.code,
              retryable: isRetryable(res.status),
            }
          );

          if (isRetryable(res.status) && attempt < MAX_RETRIES) {
            lastError = err;
            await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
            continue;
          }

          throw err;
        }

        return data as T;
      } catch (err) {
        if (err instanceof TocxiClientError) throw err;
        if (isAbortError(err)) {
          throw new TocxiClientError("Request timed out or was cancelled", {
            timeout: true,
            retryable: true,
            cause: err,
          });
        }
        if (attempt < MAX_RETRIES) {
          lastError = err instanceof Error ? err : new Error(String(err));
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        throw new TocxiClientError(
          lastError?.message ?? "Unknown Tocxi client error",
          { retryable: false, cause: lastError }
        );
      }
    }

    throw lastError ?? new TocxiClientError("Request failed after retries");
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) =>
      request<T>("GET", path, { signal }),
    post: <T>(
      path: string,
      body: unknown,
      idempotencyKey?: string,
      signal?: AbortSignal
    ) => request<T>("POST", path, { body, idempotencyKey, signal }),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function combineAbortSignals(
  ...signals: AbortSignal[]
): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}
