"use client";

import * as React from "react";
import type { CartLine, Product, Seller, PriceBreakup } from "@/types";

interface CartContextValue {
  lines: CartLine[];
  count: number;
  addItem: (product: Product, seller: Seller, quantity?: number) => void;
  removeItem: (productId: string, sellerId: string) => void;
  setQuantity: (productId: string, sellerId: string, quantity: number) => void;
  clear: () => void;
  breakup: PriceBreakup;
  /** distinct sellers in the cart — relevant for ONDC multi-seller checkout */
  sellerCount: number;
}

const CartContext = React.createContext<CartContextValue | null>(null);
const STORAGE_KEY = "openidea.cart.v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines, hydrated]);

  const addItem = React.useCallback(
    (product: Product, seller: Seller, quantity = 1) => {
      setLines((prev) => {
        const idx = prev.findIndex(
          (l) => l.productId === product.id && l.sellerId === seller.id
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
          return next;
        }
        return [...prev, { productId: product.id, product, sellerId: seller.id, seller, quantity }];
      });
    },
    []
  );

  const removeItem = React.useCallback((productId: string, sellerId: string) => {
    setLines((prev) => prev.filter((l) => !(l.productId === productId && l.sellerId === sellerId)));
  }, []);

  const setQuantity = React.useCallback(
    (productId: string, sellerId: string, quantity: number) => {
      setLines((prev) => {
        if (quantity <= 0) {
          return prev.filter((l) => !(l.productId === productId && l.sellerId === sellerId));
        }
        return prev.map((l) =>
          l.productId === productId && l.sellerId === sellerId ? { ...l, quantity } : l
        );
      });
    },
    []
  );

  const clear = React.useCallback(() => setLines([]), []);

  const breakup = React.useMemo<PriceBreakup>(() => {
    const itemTotal = lines.reduce((sum, l) => sum + l.seller.price * l.quantity, 0);
    const mrpTotal = lines.reduce(
      (sum, l) => sum + (l.seller.mrp ?? l.seller.price) * l.quantity,
      0
    );
    const discount = Math.max(0, mrpTotal - itemTotal);
    // Free delivery across sellers when subtotal crosses a threshold (illustrative).
    const deliveryFee = itemTotal === 0 || itemTotal >= 499 ? 0 : 25;
    const platformFee = itemTotal === 0 ? 0 : 7;
    const taxes = 0;
    const total = itemTotal + deliveryFee + platformFee + taxes;
    return { mrpTotal, itemTotal, discount, deliveryFee, platformFee, taxes, total };
  }, [lines]);

  const value: CartContextValue = {
    lines,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    addItem,
    removeItem,
    setQuantity,
    clear,
    breakup,
    sellerCount: new Set(lines.map((l) => l.sellerId)).size,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
