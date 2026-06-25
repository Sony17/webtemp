"use client";

import Image from "next/image";
import Link from "next/link";
import { Store, Trash2 } from "lucide-react";
import { QuantitySelector } from "@/components/QuantitySelector";
import { useCart } from "@/hooks/use-cart";
import { formatINR } from "@/lib/format";
import type { CartLine } from "@/types";

export function CartItem({ line }: { line: CartLine }) {
  const { setQuantity, removeItem } = useCart();
  const { product, seller, quantity } = line;

  return (
    <div className="flex gap-3 py-4">
      <Link
        href={`/product/${product.id}`}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
      >
        <Image src={product.images[0]} alt={product.title} fill sizes="80px" className="object-cover" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/product/${product.id}`} className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary">
              {product.title}
            </h3>
          </Link>
          <button
            type="button"
            aria-label="Remove item"
            onClick={() => removeItem(product.id, seller.id)}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Store className="h-3 w-3" /> {seller.name}
          {product.unit && <span className="text-border">·</span>}
          {product.unit}
        </p>

        <div className="mt-auto flex items-center justify-between pt-2">
          <QuantitySelector
            size="sm"
            min={1}
            value={quantity}
            onChange={(q) => setQuantity(product.id, seller.id, q)}
          />
          <div className="text-right">
            <span className="text-sm font-semibold tabular-nums">
              {formatINR(seller.price * quantity)}
            </span>
            {seller.mrp && seller.mrp > seller.price && (
              <span className="ml-1.5 text-xs text-muted-foreground line-through">
                {formatINR(seller.mrp * quantity)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
