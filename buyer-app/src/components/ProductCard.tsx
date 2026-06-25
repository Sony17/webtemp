"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Store, Clock, Plus, Zap } from "lucide-react";
import { Rating } from "@/components/Rating";
import { QuantitySelector } from "@/components/QuantitySelector";
import { FavouriteButton } from "@/components/FavouriteButton";
import { useCart } from "@/hooks/use-cart";
import { formatINR, formatEta, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { lines, addItem, setQuantity } = useCart();
  const reduce = useReducedMotion();
  const bestSeller = [...product.sellers].sort((a, b) => a.price - b.price)[0];
  const line = lines.find((l) => l.productId === product.id && l.sellerId === bestSeller.id);
  const discount =
    product.mrp && product.mrp > product.startingPrice
      ? Math.round(((product.mrp - product.startingPrice) / product.mrp) * 100)
      : 0;
  const fastestEta = Math.min(...product.sellers.map((s) => s.etaMinMins));

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: (index % 10) * 0.035 }}
      whileHover={reduce ? undefined : { y: -6 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-shadow duration-300 hover:shadow-soft-lg"
    >
      {/* Image */}
      <Link href={`/product/${product.id}`} className="relative block">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <Image
            src={product.images[0]}
            alt={product.title}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            priority={index < 5}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-110"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          {/* Top-left badges */}
          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5">
            {discount > 0 && (
              <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-soft">
                {discount}% OFF
              </span>
            )}
            {bestSeller.etaMinMins <= 30 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-semibold text-white shadow-soft">
                <Zap className="h-2.5 w-2.5" /> Fast
              </span>
            )}
          </div>

          {/* Favourite */}
          <div className="absolute right-2.5 top-2.5 opacity-0 transition-all duration-200 group-hover:opacity-100 max-md:opacity-100">
            <FavouriteButton productId={product.id} size="sm" />
          </div>

          {/* ETA chip bottom-left */}
          <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-soft backdrop-blur-md">
            <Clock className="h-3 w-3 text-primary" />
            {formatEta(fastestEta)}
          </span>
        </div>
      </Link>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {/* Seller chip */}
        <Link
          href={`/product/${product.id}`}
          className="inline-flex w-fit items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Store className="h-3 w-3" />
          {product.sellers.length} {pluralize(product.sellers.length, "seller")}
        </Link>

        <Link href={`/product/${product.id}`} className="min-h-[2.5rem]">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
            {product.title}
          </h3>
        </Link>

        <div className="flex items-center gap-2">
          <Rating value={product.rating} />
          {product.unit && (
            <span className="text-xs text-muted-foreground">· {product.unit}</span>
          )}
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-semibold tracking-tight">
                {formatINR(product.startingPrice)}
              </span>
              {product.mrp && product.mrp > product.startingPrice && (
                <span className="text-xs text-muted-foreground line-through">
                  {formatINR(product.mrp)}
                </span>
              )}
            </div>
            {discount > 0 && (
              <span className="text-[11px] font-medium text-success">
                Save {formatINR(product.mrp! - product.startingPrice)}
              </span>
            )}
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {line ? (
              <motion.div
                key="qty"
                initial={reduce ? undefined : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reduce ? undefined : { scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <QuantitySelector
                  size="sm"
                  value={line.quantity}
                  onChange={(q) => setQuantity(product.id, bestSeller.id, q)}
                />
              </motion.div>
            ) : (
              <motion.button
                key="add"
                type="button"
                onClick={() => addItem(product, bestSeller)}
                initial={reduce ? undefined : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reduce ? undefined : { scale: 0.8, opacity: 0 }}
                whileTap={reduce ? undefined : { scale: 0.92 }}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                )}
              >
                <Plus className="h-4 w-4" />
                Add
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
