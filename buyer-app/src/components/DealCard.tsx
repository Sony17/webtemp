"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Plus, Check } from "lucide-react";
import { useCart } from "@/hooks/use-cart";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * Deal-specific card — intentionally distinct from ProductCard:
 * warm amber "offer" treatment, big discount + savings emphasis, urgency chip.
 */
export function DealCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { lines, addItem } = useCart();
  const reduce = useReducedMotion();
  const best = [...product.sellers].sort((a, b) => a.price - b.price)[0];
  const inCart = lines.some((l) => l.productId === product.id && l.sellerId === best.id);
  const discount =
    product.mrp && product.mrp > product.startingPrice
      ? Math.round(((product.mrp - product.startingPrice) / product.mrp) * 100)
      : 0;
  const save = product.mrp ? product.mrp - product.startingPrice : 0;

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: (index % 8) * 0.04 }}
      whileHover={reduce ? undefined : { y: -6 }}
      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-50 to-card shadow-soft transition-shadow hover:shadow-soft-lg dark:from-amber-500/10"
    >
      <Link href={`/product/${product.id}`} className="relative block">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <Image
            src={product.images[0]}
            alt={product.title}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            loading="lazy"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
          {/* Corner discount flag */}
          {discount > 0 && (
            <div className="absolute left-0 top-0 rounded-br-2xl bg-amber-500 px-2.5 py-1 text-sm font-bold text-white shadow-soft">
              {discount}%<span className="ml-0.5 text-[10px] font-semibold">OFF</span>
            </div>
          )}
          <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <Flame className="h-2.5 w-2.5 text-amber-400" /> Limited time
          </span>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={`/product/${product.id}`} className="min-h-[2.5rem]">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{product.title}</h3>
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tracking-tight text-amber-700 dark:text-amber-400">
                {formatINR(product.startingPrice)}
              </span>
              {product.mrp && (
                <span className="text-xs text-muted-foreground line-through">
                  {formatINR(product.mrp)}
                </span>
              )}
            </div>
            {save > 0 && (
              <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                Save {formatINR(save)}
              </span>
            )}
          </div>

          <motion.button
            type="button"
            onClick={() => addItem(product, best)}
            whileTap={reduce ? undefined : { scale: 0.9 }}
            aria-label={`Add ${product.title} to cart`}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm font-semibold transition-colors",
              inCart
                ? "bg-success text-success-foreground"
                : "bg-amber-500 text-white hover:bg-amber-600"
            )}
          >
            {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {inCart ? "" : "Add"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
