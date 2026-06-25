"use client";

import { Info, Tag } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { AnimatedNumber } from "@/components/motion/Motion";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PriceBreakup } from "@/types";

interface PriceCardProps {
  breakup: PriceBreakup;
  title?: string;
  /** Show the ONDC late-binding price disclaimer. */
  showOndcNote?: boolean;
  className?: string;
}

function Row({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "success";
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          tone === "muted" && "text-muted-foreground",
          tone === "success" && "text-success"
        )}
      >
        {tone === "success" && <Tag className="h-3.5 w-3.5" />}
        {label}
        {hint && <span className="text-xs text-muted-foreground">({hint})</span>}
      </span>
      <span
        className={cn(
          "tabular-nums",
          tone === "muted" && "text-muted-foreground",
          tone === "success" && "text-success"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Unified price summary used across Product, Cart, Checkout and Order Details.
 * Hierarchy: MRP → Discount → Selling subtotal → Delivery → Platform fee → Taxes → Total.
 * MRP is shown first and the discount visibly subtracts to reach the selling subtotal,
 * so the saving is never double-counted.
 */
export function PriceCard({ breakup, title = "Price Details", showOndcNote, className }: PriceCardProps) {
  const mrpTotal = breakup.mrpTotal ?? breakup.itemTotal + breakup.discount;
  const hasDiscount = breakup.discount > 0;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-soft", className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>

      <div className="space-y-2.5">
        {hasDiscount && <Row label="Total MRP" value={formatINR(mrpTotal)} tone="muted" />}
        {hasDiscount && (
          <Row label="Discount on MRP" value={`−${formatINR(breakup.discount)}`} tone="success" />
        )}
        <Row
          label={hasDiscount ? "Selling price" : "Item total"}
          value={formatINR(breakup.itemTotal)}
        />
        <Row
          label="Delivery charges"
          value={breakup.deliveryFee === 0 ? "FREE" : formatINR(breakup.deliveryFee)}
          tone="muted"
        />
        {breakup.platformFee != null && breakup.platformFee > 0 && (
          <Row label="Platform fee" value={formatINR(breakup.platformFee)} tone="muted" />
        )}
        {breakup.taxes > 0 && <Row label="Taxes" value={formatINR(breakup.taxes)} tone="muted" />}

        <Separator />

        <div className="flex items-center justify-between text-sm font-semibold">
          <span>Estimated total</span>
          <AnimatedNumber value={breakup.total} format={(v) => formatINR(v)} />
        </div>
      </div>

      {hasDiscount && (
        <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-center text-xs font-medium text-success">
          You save {formatINR(breakup.discount)} on this order
        </div>
      )}

      {showOndcNote && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent/50 p-3 text-xs text-accent-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>Final payable amount will be confirmed during ONDC checkout.</p>
        </div>
      )}
    </div>
  );
}
