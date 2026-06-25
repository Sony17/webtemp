"use client";

import * as React from "react";

/**
 * Recently viewed product ids — localStorage external store (client UI only).
 * The product page records a view; the home page reads the list.
 */
const KEY = "openidea.recentlyViewed.v1";
const MAX = 12;
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

export function recordView(id: string) {
  ids = [id, ...ids.filter((x) => x !== id)].slice(0, MAX);
  emit();
}

export function useRecentlyViewed(): readonly string[] {
  return React.useSyncExternalStore(
    subscribe,
    () => ids,
    () => EMPTY
  );
}
