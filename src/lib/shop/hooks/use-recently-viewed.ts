"use client";

// Recently-viewed products — migrated from the prototype and adapted to the
// current architecture. The prototype stored ids against a global mock catalog;
// here products are discovery-session-scoped, so we persist lightweight product
// SNAPSHOTS instead (enough to render a card and route to the product/search).
import * as React from "react";
import type { Product } from "@/lib/shop/types";

export type RecentProduct = {
  bppId: string;
  providerId: string;
  itemId: string;
  name: string;
  image?: string;
  price: number;
  currency: string;
};

const KEY = "openidea.recentlyViewed.v1";
const MAX = 12;
const EMPTY: readonly RecentProduct[] = [];
let items: RecentProduct[] = [];
const listeners = new Set<() => void>();

function load() {
  if (typeof window === "undefined") return;
  try {
    items = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    items = [];
  }
}
load();

function emit() {
  if (typeof window !== "undefined")
    localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function recordView(p: Product) {
  const snap: RecentProduct = {
    bppId: p.bppId,
    providerId: p.providerId,
    itemId: p.itemId,
    name: p.name,
    image: p.image,
    price: p.price,
    currency: p.currency,
  };
  const k = `${snap.bppId}:${snap.providerId}:${snap.itemId}`;
  items = [
    snap,
    ...items.filter((x) => `${x.bppId}:${x.providerId}:${x.itemId}` !== k),
  ].slice(0, MAX);
  emit();
}

export function useRecentlyViewed(): readonly RecentProduct[] {
  return React.useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY
  );
}
