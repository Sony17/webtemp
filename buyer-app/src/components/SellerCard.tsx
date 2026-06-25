"use client";

import Image from "next/image";
import { Clock, Truck, Zap, BadgeIndianRupee, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Rating } from "@/components/Rating";
import { formatINR, formatEta } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Seller } from "@/types";

interface SellerCardProps {
  seller: Seller;
  selected?: boolean;
  onSelect?: () => void;
}

export function SellerCard({ seller, selected, onSelect }: SellerCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all duration-200 hover:shadow-soft",
        selected
          ? "border-primary ring-1 ring-primary shadow-soft"
          : "border-border hover:border-primary/40"
      )}
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
        {seller.logo && (
          <Image src={seller.logo} alt={seller.name} fill sizes="48px" className="object-cover" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{seller.name}</p>
          {seller.isFastest && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
              <Zap className="h-2.5 w-2.5" /> Fastest
            </Badge>
          )}
          {seller.isCheapest && (
            <Badge variant="success" className="px-1.5 py-0 text-[10px]">
              <BadgeIndianRupee className="h-2.5 w-2.5" /> Best price
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Rating value={seller.rating} count={seller.ratingCount} />
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatEta(seller.etaMinMins, seller.etaMaxMins)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3.5 w-3.5" />
            {seller.deliveryFee === 0 ? "Free delivery" : `${formatINR(seller.deliveryFee)} delivery`}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-base font-semibold tracking-tight">{formatINR(seller.price)}</div>
        {seller.mrp && seller.mrp > seller.price && (
          <div className="text-xs text-muted-foreground line-through">{formatINR(seller.mrp)}</div>
        )}
        {selected && (
          <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" /> Selected
          </span>
        )}
      </div>
    </button>
  );
}
