"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ShoppingCart, Zap, Clock, Check } from "lucide-react";
import { QuantitySelector } from "@/components/QuantitySelector";
import { formatINR, formatEta } from "@/lib/format";
import type { Seller } from "@/types";

/**
 * Sticky bottom purchase bar — mobile only (hidden at lg).
 * Slides in when the inline purchase card scrolls out of view.
 */
export function MobilePurchaseBar({
  visible,
  seller,
  qty,
  setQty,
  inCart,
  onAddToCart,
  onBuyNow,
}: {
  visible: boolean;
  seller: Seller;
  qty: number;
  setQty: (q: number) => void;
  inCart: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: "110%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "110%" }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-xl lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          role="region"
          aria-label="Purchase"
        >
          <div className="mx-auto max-w-2xl px-4 py-3">
            {/* price + eta + qty */}
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold tracking-tight">
                    {formatINR(seller.price)}
                  </span>
                  {seller.mrp && seller.mrp > seller.price && (
                    <span className="text-xs text-muted-foreground line-through">
                      {formatINR(seller.mrp)}
                    </span>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3 text-primary" />
                  {formatEta(seller.etaMinMins, seller.etaMaxMins)} · {seller.name}
                </span>
              </div>
              <QuantitySelector value={qty} min={1} onChange={setQty} size="sm" />
            </div>

            {/* actions */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onAddToCart}
                aria-label="Add to cart"
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] ${
                  inCart
                    ? "bg-success text-success-foreground"
                    : "border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                }`}
              >
                {inCart ? <Check className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
                {inCart ? "Added" : "Add to cart"}
              </button>
              <button
                type="button"
                onClick={onBuyNow}
                aria-label="Buy now"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition-transform active:scale-[0.98]"
              >
                <Zap className="h-5 w-5" /> Buy now
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
