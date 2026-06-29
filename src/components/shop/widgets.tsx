"use client";

// Shared buyer-app widgets reused across screens: product card, quantity
// stepper, section header, empty/loading states, and a live "waiting on the
// network" indicator (ONDC callbacks are async, so most screens spend time
// waiting for data to arrive).
import * as React from "react";
import Link from "next/link";
import { Loader2, ImageOff, Star, Plus, Minus } from "lucide-react";
import { Button, Card } from "@/components/shop/ui";
import { FavouriteButton } from "@/components/shop/FavouriteButton";
import { productKey } from "@/lib/shop/hooks/use-favourites";
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
    <Card className="flex flex-col overflow-hidden">
      <Link href={href} className="relative block aspect-square">
        <ProductThumb
          src={product.image}
          alt={product.name}
          priority={priority}
          className="h-full w-full"
        />
        {discount > 0 ? (
          <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
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
