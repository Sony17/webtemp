"use client";

// Poll /api/shop/state for a transaction. ONDC data arrives asynchronously via
// on_* callbacks, so every screen that shows live order/catalog/quote state
// polls this hook. Polling auto-stops when `stopWhen` is satisfied (e.g. the
// quote arrived) or after `maxMs`, so we don't poll forever on a dead flow.
import * as React from "react";
import { getState } from "@/lib/shop/api";
import type { ShopState } from "@/lib/shop/types";

type Options = {
  intervalMs?: number;
  maxMs?: number;
  enabled?: boolean;
  // Return true to stop polling (data we were waiting for has arrived).
  stopWhen?: (state: ShopState) => boolean;
};

export function useShopState(
  transactionId: string | null | undefined,
  opts: Options = {}
) {
  const { intervalMs = 2500, maxMs = 60_000, enabled = true, stopWhen } = opts;
  const [state, setState] = React.useState<ShopState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);

  // Keep the latest stopWhen without restarting the effect each render.
  const stopRef = React.useRef(stopWhen);
  stopRef.current = stopWhen;

  React.useEffect(() => {
    if (!transactionId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    setPolling(true);

    const tick = async () => {
      try {
        const s = await getState(transactionId);
        if (cancelled) return;
        setState(s);
        setError(null);
        if (stopRef.current?.(s) || Date.now() - startedAt > maxMs) {
          setPolling(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load state");
        if (Date.now() - startedAt > maxMs) {
          setPolling(false);
          return;
        }
      }
      timer = setTimeout(tick, intervalMs);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [transactionId, enabled, intervalMs, maxMs]);

  const refetch = React.useCallback(async () => {
    if (!transactionId) return;
    try {
      const s = await getState(transactionId);
      setState(s);
      setError(null);
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load state");
    }
  }, [transactionId]);

  return { state, error, polling, refetch };
}
