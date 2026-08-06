"use client";

// Shared buyer-app widgets reused across screens: product card, quantity
// stepper, section header, empty/loading states, and a live "waiting on the
// network" indicator (ONDC callbacks are async, so most screens spend time
// waiting for data to arrive).
import * as React from "react";
import Link from "next/link";
import { Loader2, ImageOff, Plus, Minus } from "lucide-react";
import { Card } from "@/components/shop/ui";
import { FavouriteButton } from "@/components/shop/FavouriteButton";
import { Rating } from "@/components/shop/Rating";
import { productKey } from "@/lib/shop/hooks/use-favourites";
import { useShop } from "@/lib/shop/store";
import { cn, formatINR } from "@/lib/shop/cn";
import type { Product } from "@/lib/shop/types";
import type { ShopCategory } from "@/lib/shop/categories";

// A single grocery category tile: a real category photo on a soft tinted chip
// (with a lucide icon as the graceful fallback), plus a label — linking to a
// seeded ONDC search. No emoji (see the no-emoji rule).
export function CategoryTile({ category }: { category: ShopCategory }) {
  const { Icon, tint, label, query, image, domain } = category;
  const [failed, setFailed] = React.useState(false);
  // Carry the ONDC domain only for non-grocery categories so a fashion/beauty/
  // electronics tile searches the right network domain; grocery URLs stay clean
  // (the search route defaults to the primary/grocery domain when omitted).
  const href =
    domain && domain !== "ONDC:RET10"
      ? `/shop/search?q=${encodeURIComponent(query)}&domain=${encodeURIComponent(domain)}`
      : `/shop/search?q=${encodeURIComponent(query)}`;
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-2.5 text-center shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft-lg sm:p-3"
    >
      <span
        className={cn(
          "relative grid h-16 w-16 place-items-center overflow-hidden rounded-2xl transition-transform group-hover:scale-105 sm:h-[4.5rem] sm:w-[4.5rem]",
          tint
        )}
      >
        {image && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={label}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon className="h-7 w-7" strokeWidth={1.75} />
        )}
      </span>
      <span className="text-[11px] font-medium leading-tight sm:text-xs">
        {label}
      </span>
    </Link>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? (
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/60 text-primary">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ProductThumb({
  src,
  alt,
  className,
  priority = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  // LCP optimisation (migrated from the prototype's QA fix): above-the-fold
  // thumbnails load eagerly with high fetch priority; the rest stay lazy. Native
  // <img> is used deliberately — ONDC catalog images come from arbitrary seller
  // hosts, which next/image would reject without a wildcard remote allowlist.
  priority?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn(
          "grid place-items-center bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={cn("object-cover", className)}
    />
  );
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-8 w-8 place-items-center rounded-l-lg text-primary hover:bg-accent disabled:opacity-40"
        disabled={value <= min}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-8 w-8 place-items-center rounded-r-lg text-primary hover:bg-accent disabled:opacity-40"
        disabled={value >= max}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

// The signature quick-commerce add control: a compact "ADD" pill that swaps
// in place for a filled −/qty/+ stepper once the item is in the cart (the
// Blinkit/Zepto interaction). Reads the live quantity straight from the cart
// store so every card, list row and detail page stays in sync automatically.
// `+` re-uses addToCart (increment), `−` uses setQuantity (removes at 0).
export function CartControl({
  product,
  onAdd,
  size = "sm",
  className,
}: {
  product: Product;
  // Optional hook for the FIRST add (e.g. analytics / seeding a snapshot);
  // falls back to the store's addToCart when omitted.
  onAdd?: (p: Product) => void;
  size?: "sm" | "lg";
  className?: string;
}) {
  const { lines, addToCart, setQuantity } = useShop();
  const qty =
    lines.find(
      (l) =>
        l.product.itemId === product.itemId && l.product.bppId === product.bppId
    )?.quantity ?? 0;

  const dims =
    size === "lg"
      ? "h-11 min-w-[7.5rem] text-sm"
      : "h-8 min-w-[4.75rem] text-xs";
  const iconBtn = size === "lg" ? "w-11" : "w-8";

  if (qty === 0) {
    return (
      <button
        type="button"
        aria-label={`Add ${product.name} to cart`}
        onClick={() => (onAdd ? onAdd(product) : addToCart(product))}
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-primary/40 bg-primary/5 px-4 font-bold uppercase tracking-wide text-primary shadow-soft transition-colors hover:bg-primary hover:text-primary-foreground active:scale-95",
          dims,
          className
        )}
      >
        Add
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-between rounded-lg bg-primary font-bold text-primary-foreground shadow-soft",
        dims,
        className
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => setQuantity(product.itemId, product.bppId, qty - 1)}
        className={cn(
          "grid h-full place-items-center rounded-l-lg transition-colors hover:bg-white/15 active:scale-90",
          iconBtn
        )}
      >
        <Minus className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      </button>
      <span className="tabular-nums">{qty}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => addToCart(product, 1)}
        className={cn(
          "grid h-full place-items-center rounded-r-lg transition-colors hover:bg-white/15 active:scale-90",
          iconBtn
        )}
      >
        <Plus className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      </button>
    </div>
  );
}

export function QuoteSummary({
  quote,
  className,
}: {
  quote: import("@/lib/shop/types").ParsedQuote;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="space-y-1.5">
        {quote.breakup.map((l, i) => {
          const isDiscount =
            l.type === "discount" || l.price < 0 || /discount/i.test(l.title);
          return (
            <div
              key={`${l.title}-${i}`}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">{l.title}</span>
              <span className={isDiscount ? "text-emerald-600" : ""}>
                {formatINR(l.price)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="font-semibold">To pay</span>
        <span className="text-lg font-semibold">{formatINR(quote.total)}</span>
      </div>
    </div>
  );
}

export function Timeline({
  events,
}: {
  events: import("@/lib/shop/types").TimelineEvent[];
}) {
  const tone: Record<string, string> = {
    order: "bg-primary",
    fulfillment: "bg-emerald-500",
    cancel: "bg-destructive",
    refund: "bg-amber-500",
    return: "bg-amber-500",
    replacement: "bg-blue-500",
    rto: "bg-orange-500",
  };
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">No updates yet.</p>
    );
  }
  return (
    <div className="space-y-0">
      {events.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                e.done ? tone[e.kind] ?? "bg-primary" : "bg-muted"
              )}
            />
            {i < events.length - 1 ? (
              <span className="my-0.5 w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className="pb-4">
            <p className="text-sm font-medium leading-tight">{e.label}</p>
            {e.sublabel ? (
              <p className="text-xs text-muted-foreground">{e.sublabel}</p>
            ) : null}
            {e.at ? (
              <p className="text-[11px] text-muted-foreground">
                {new Date(e.at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RefundSummary({
  refund,
}: {
  refund: import("@/lib/shop/types").ParsedRefund;
}) {
  return (
    <div>
      <div className="space-y-1.5">
        {refund.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="capitalize text-muted-foreground">{l.title}</span>
            <span>{formatINR(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="font-semibold">Refund amount</span>
        <span className="text-lg font-semibold text-emerald-600">
          {formatINR(refund.total)}
        </span>
      </div>
    </div>
  );
}

export function ProductCard({
  product,
  onAdd,
  priority = false,
}: {
  product: Product;
  onAdd?: (p: Product) => void;
  // Pass true for above-the-fold cards (LCP). See ProductThumb.
  priority?: boolean;
}) {
  const discount =
    product.maxPrice && product.maxPrice > product.price
      ? Math.round(((product.maxPrice - product.price) / product.maxPrice) * 100)
      : 0;

  const href = `/shop/product/${encodeURIComponent(
    product.bppId
  )}/${encodeURIComponent(product.providerId)}/${encodeURIComponent(
    product.itemId
  )}`;

  return (
    <Card className="group flex flex-col overflow-hidden shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft-lg">
      <Link href={href} className="relative block aspect-square overflow-hidden bg-muted/40">
        <ProductThumb
          src={product.image}
          alt={product.name}
          priority={priority}
          className="h-full w-full transition-transform duration-300 group-hover:scale-105"
        />
        {discount > 0 ? (
          <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-soft">
            {discount}% OFF
          </span>
        ) : null}
        <FavouriteButton
          productKey={productKey(product)}
          size="sm"
          className="absolute right-2 top-2"
        />
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link href={href} className="line-clamp-2 text-sm font-medium leading-snug">
          {product.name}
        </Link>
        {/* Seller name first (so buyers can tell sellers apart / pick a specific
            one on ONDC), linking to the seller's storefront, with the unit
            appended when present. */}
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          <Link
            href={`/shop/seller/${encodeURIComponent(
              product.bppId
            )}/${encodeURIComponent(product.providerId)}`}
            className="hover:text-primary hover:underline"
          >
            {product.providerName}
          </Link>
          {product.unit ? ` · ${product.unit}` : ""}
        </p>
        {product.rating ? (
          <Rating value={product.rating} className="mt-1 w-fit" />
        ) : null}
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <span className="text-sm font-semibold">
              {formatINR(product.price)}
            </span>
            {discount > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground line-through">
                {formatINR(product.maxPrice)}
              </span>
            ) : null}
          </div>
          {onAdd ? <CartControl product={product} onAdd={onAdd} /> : null}
        </div>
      </div>
    </Card>
  );
}
