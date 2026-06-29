"use client";

// Buyer-app client state — cart, delivery address, and the active ONDC
// transaction id, all persisted to localStorage so a refresh mid-flow doesn't
// lose the order. This is deliberately small: the authoritative order state
// lives in the backend store (read via /api/shop/state); this only holds the
// buyer's local intent (what's in the cart, where to deliver).
import * as React from "react";
import type { Product } from "@/lib/shop/types";

export type CartLine = { product: Product; quantity: number };

// A local pointer to an order this device placed. The backend keys orders by
// transactionId and has no buyer identity, so the buyer app must remember its
// own orders to show an Orders list. Live status is read from /api/shop/state.
export type OrderRef = {
  transactionId: string;
  bppId: string;
  bppUri: string;
  providerName: string;
  title: string; // e.g. "Basmati Rice +2 more"
  total: number;
  placedAt: number;
};

export type Address = {
  name: string;
  phone: string;
  email?: string;
  building?: string;
  locality?: string;
  city?: string;
  state?: string;
  areaCode?: string;
  gps?: string;
};

type ShopContextValue = {
  // Cart
  lines: CartLine[];
  addToCart: (product: Product, quantity?: number) => void;
  setQuantity: (itemId: string, bppId: string, quantity: number) => void;
  removeFromCart: (itemId: string, bppId: string) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
  // The single BPP/provider the current cart belongs to (ONDC orders are
  // per-provider; we keep the cart single-seller to keep select/init/confirm
  // unambiguous). Null when empty.
  cartBpp: { bppId: string; bppUri: string; providerId: string } | null;
  // Delivery address
  address: Address | null;
  setAddress: (a: Address | null) => void;
  // Active transaction id for the discovery/order flow
  transactionId: string | null;
  setTransactionId: (id: string | null) => void;
  // Locally-remembered placed orders (newest first)
  orders: OrderRef[];
  addOrder: (ref: OrderRef) => void;
};

const ShopContext = React.createContext<ShopContextValue | null>(null);

const LS_CART = "shop.cart.v1";
const LS_ADDRESS = "shop.address.v1";
const LS_TXN = "shop.txn.v1";
const LS_ORDERS = "shop.orders.v1";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [address, setAddressState] = React.useState<Address | null>(null);
  const [transactionId, setTxnState] = React.useState<string | null>(null);
  const [orders, setOrders] = React.useState<OrderRef[]>([]);

  // Hydrate once on mount (avoids SSR/client mismatch).
  React.useEffect(() => {
    setLines(load<CartLine[]>(LS_CART, []));
    setAddressState(load<Address | null>(LS_ADDRESS, null));
    setTxnState(load<string | null>(LS_TXN, null));
    setOrders(load<OrderRef[]>(LS_ORDERS, []));
  }, []);

  React.useEffect(() => save(LS_CART, lines), [lines]);

  const addToCart = React.useCallback((product: Product, quantity = 1) => {
    setLines((prev) => {
      // Single-seller cart: adding from a different BPP replaces the cart.
      const differentSeller =
        prev.length > 0 && prev[0].product.bppId !== product.bppId;
      const base = differentSeller ? [] : prev;
      const idx = base.findIndex(
        (l) =>
          l.product.itemId === product.itemId &&
          l.product.bppId === product.bppId
      );
      if (idx >= 0) {
        const next = [...base];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [...base, { product, quantity }];
    });
  }, []);

  const setQuantity = React.useCallback(
    (itemId: string, bppId: string, quantity: number) => {
      setLines((prev) =>
        prev
          .map((l) =>
            l.product.itemId === itemId && l.product.bppId === bppId
              ? { ...l, quantity }
              : l
          )
          .filter((l) => l.quantity > 0)
      );
    },
    []
  );

  const removeFromCart = React.useCallback((itemId: string, bppId: string) => {
    setLines((prev) =>
      prev.filter(
        (l) => !(l.product.itemId === itemId && l.product.bppId === bppId)
      )
    );
  }, []);

  const clearCart = React.useCallback(() => setLines([]), []);

  const setAddress = React.useCallback((a: Address | null) => {
    setAddressState(a);
    save(LS_ADDRESS, a);
  }, []);

  const setTransactionId = React.useCallback((id: string | null) => {
    setTxnState(id);
    save(LS_TXN, id);
  }, []);

  const addOrder = React.useCallback((ref: OrderRef) => {
    setOrders((prev) => {
      // De-dupe by (transactionId, bppId); newest first.
      const next = [
        ref,
        ...prev.filter(
          (o) => !(o.transactionId === ref.transactionId && o.bppId === ref.bppId)
        ),
      ];
      save(LS_ORDERS, next);
      return next;
    });
  }, []);

  const cartCount = lines.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = lines.reduce((s, l) => s + l.product.price * l.quantity, 0);
  const cartBpp =
    lines.length > 0
      ? {
          bppId: lines[0].product.bppId,
          bppUri: lines[0].product.bppUri,
          providerId: lines[0].product.providerId,
        }
      : null;

  const value: ShopContextValue = {
    lines,
    addToCart,
    setQuantity,
    removeFromCart,
    clearCart,
    cartCount,
    cartTotal,
    cartBpp,
    address,
    setAddress,
    transactionId,
    setTransactionId,
    orders,
    addOrder,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = React.useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used within <ShopProvider>");
  return ctx;
}
