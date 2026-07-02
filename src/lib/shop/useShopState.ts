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
  // Hint the bpp this screen cares about so its quote/order/support is surfaced
  // even without a visible catalog slice (see api.getState / state route).
  bppId?: string;
  bppUri?: string;
};

export function useShopState(
  transactionId: string | null | undefined,
  opts: Options = {}
) {
  const { intervalMs = 2500, maxMs = 60_000, enabled = true, stopWhen, bppId, bppUri } = opts;
  const [state, setState] = React.useState<ShopState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);

  // Keep the latest stopWhen without restarting the polling effect each render.
  // Written in an effect (not during render) to satisfy the refs rule.
  const stopRef = React.useRef(stopWhen);
  React.useEffect(() => {
    stopRef.current = stopWhen;
  });

  React.useEffect(() => {
    if (!transactionId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    // Flag the start of an external polling loop (network → store). This is the
    // rule's documented "synchronize with an external system" case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPolling(true);

    const tick = async () => {
      try {
        const s = await getState(transactionId, { bppId, bppUri });
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
  }, [transactionId, enabled, intervalMs, maxMs, bppId, bppUri]);

  const refetch = React.useCallback(async () => {
    if (!transactionId) return;
    try {
      const s = await getState(transactionId, { bppId, bppUri });
      setState(s);
      setError(null);
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load state");
    }
  }, [transactionId, bppId, bppUri]);

  return { state, error, polling, refetch };
}
