"use client";

// Shared buyer-app widgets reused across screens: product card, quantity
// stepper, section header, empty/loading states, and a live "waiting on the
// network" indicator (ONDC callbacks are async, so most screens spend time
// waiting for data to arrive).
import * as React from "react";
import Link from "next/link";
import { Loader2, ImageOff, Star, Plus, Minus } from "lucide-react";
import { Button, Card } from "@/components/shop/ui";
import { cn, formatINR } from "@/lib/shop/cn";
import type { Product } from "@/lib/shop/types";

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
}: {
  src?: string;
  alt: string;
  className?: string;
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
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
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

export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd?: (p: Product) => void;
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
    <Card className="flex flex-col overflow-hidden">
      <Link href={href} className="relative block aspect-square">
        <ProductThumb
          src={product.image}
          alt={product.name}
          className="h-full w-full"
        />
        {discount > 0 ? (
          <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {discount}% OFF
          </span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link href={href} className="line-clamp-2 text-sm font-medium">
          {product.name}
        </Link>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {product.unit ?? product.providerName}
        </p>
        {product.rating ? (
          <span className="mt-1 inline-flex w-fit items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <Star className="h-3 w-3 fill-current" />
            {product.rating.toFixed(1)}
          </span>
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
          {onAdd ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3"
              onClick={() => onAdd(product)}
            >
              Add
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
