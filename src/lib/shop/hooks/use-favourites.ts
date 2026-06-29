"use client";

// Favourites / wishlist — migrated from the prototype. A tiny localStorage-backed
// external store (no provider, no service), purely client UI state for the
// favourite button. Keys are stable product keys `${bppId}:${providerId}:${itemId}`
// produced by productKey() so a favourite survives across discovery sessions.
import * as React from "react";
import type { Product } from "@/lib/shop/types";

const KEY = "openidea.favourites.v1";
const EMPTY: readonly string[] = [];
let ids: string[] = [];
const listeners = new Set<() => void>();

export function productKey(p: {
  bppId: string;
  providerId: string;
  itemId: string;
}): string {
  return `${p.bppId}:${p.providerId}:${p.itemId}`;
}

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
  if (typeof window !== "undefined")
    localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function toggleFavourite(key: string) {
  ids = ids.includes(key) ? ids.filter((x) => x !== key) : [...ids, key];
  emit();
}

export function useIsFavourite(key: string): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => ids.includes(key),
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

// Convenience for components holding a Product.
export function isFavouriteProduct(p: Product): string {
  return productKey(p);
}
