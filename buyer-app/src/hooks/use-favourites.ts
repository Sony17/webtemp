"use client";

import * as React from "react";

/**
 * Favourites — a tiny localStorage-backed external store (no provider, no service).
 * Purely client UI state for the favourite/wishlist button.
 */
const KEY = "openidea.favourites.v1";
const EMPTY: readonly string[] = [];
let ids: string[] = [];
const listeners = new Set<() => void>();

function load() {
  if (typeof window === "undefined") return;
  try {
    ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    ids = [];
  }
}
load();

function emit() {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function toggleFavourite(id: string) {
  ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  emit();
}

export function useIsFavourite(id: string): boolean {
  const subscribeStore = React.useCallback((cb: () => void) => subscribe(cb), []);
  return React.useSyncExternalStore(
    subscribeStore,
    () => ids.includes(id),
    () => false
  );
}

export function useFavourites(): readonly string[] {
  return React.useSyncExternalStore(
    subscribe,
    () => ids,
    () => EMPTY
  );
}
