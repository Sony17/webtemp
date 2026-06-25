"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, ArrowRight, Store, Clock, Info, Trash2, Truck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { CartItem } from "@/components/CartItem";
import { PriceCard } from "@/components/PriceCard";
import { EmptyState } from "@/components/EmptyState";
import { AnimatedNumber } from "@/components/motion/Motion";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/hooks/use-cart";
import { formatINR, formatEta, pluralize } from "@/lib/format";
import type { CartLine } from "@/types";

export default function CartPage() {
  const { lines, breakup, count, sellerCount, clear } = useCart();

  if (lines.length === 0) {
    return (
      <PageContainer size="narrow">
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Browse the network and add items from your favourite sellers."
          action={
            <Button asChild>
              <Link href="/search">Start shopping</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const bySeller = lines.reduce<Record<string, CartLine[]>>((acc, line) => {
    (acc[line.sellerId] ??= []).push(line);
    return acc;
  }, {});

  const minEta = Math.min(...lines.map((l) => l.seller.etaMinMins));
  const maxEta = Math.max(...lines.map((l) => l.seller.etaMaxMins));

  return (
    <PageContainer className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Your Cart</h1>
          <p className="text-sm text-muted-foreground">
            {count} {pluralize(count, "item")} from {sellerCount} {pluralize(sellerCount, "seller")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
          <Trash2 className="h-4 w-4" /> Clear
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Lines grouped by seller */}
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {Object.values(bySeller).map((sellerLines) => {
              const seller = sellerLines[0].seller;
              return (
                <motion.div
                  key={seller.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl border border-border bg-card px-4 shadow-soft"
                >
                  <div className="flex items-center justify-between gap-2 py-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/60 text-primary">
                        <Store className="h-3.5 w-3.5" />
                      </span>
                      {seller.name}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatEta(seller.etaMinMins, seller.etaMaxMins)}
                    </span>
                  </div>
                  <Separator />
                  <div className="divide-y divide-border">
                    <AnimatePresence initial={false}>
                      {sellerLines.map((line) => (
                        <motion.div
                          key={`${line.productId}-${line.sellerId}`}
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <CartItem line={line} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Summary */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/40 p-3.5 text-xs text-accent-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">ONDC protocol notice</p>
              <p className="mt-0.5 text-accent-foreground/80">
                Final price will be confirmed during checkout as per ONDC protocol.
              </p>
            </div>
          </div>

          <PriceCard breakup={breakup} />

          {/* Delivery estimate card */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/60 text-primary">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium">Estimated delivery</p>
              <p className="text-xs text-muted-foreground">{formatEta(minEta, maxEta)} to your location</p>
            </div>
          </div>

          <Button asChild size="lg" className="w-full">
            <Link href="/checkout">
              Checkout ·{" "}
              <AnimatedNumber value={breakup.total} format={(v) => formatINR(v)} />
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
