"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/format";
import type { SearchFilters } from "@/types";

export const SORTS: { value: NonNullable<SearchFilters["sort"]>; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_low", label: "Price: Low to High" },
  { value: "price_high", label: "Price: High to Low" },
  { value: "rating", label: "Top Rated" },
  { value: "fastest", label: "Fastest Delivery" },
];

const ETA_OPTIONS = [
  { value: 30, label: "Under 30 min" },
  { value: 60, label: "Under 1 hr" },
  { value: 240, label: "Under 4 hr" },
];

const RATING_OPTIONS = [4.5, 4.0, 3.5];

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-primary/40"
      )}
    >
      {children}
    </button>
  );
}

/** Controlled filter controls shared by the mobile sheet and the desktop sidebar. */
export function FilterControls({
  value,
  onChange,
  maxPriceCeiling = 20000,
}: {
  value: SearchFilters;
  onChange: (next: SearchFilters) => void;
  maxPriceCeiling?: number;
}) {
  const price = value.maxPrice ?? maxPriceCeiling;

  return (
    <div className="space-y-7">
      {/* Sort */}
      <section className="space-y-3">
        <Label>Sort by</Label>
        <div className="flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <Pill
              key={s.value}
              active={(value.sort ?? "relevance") === s.value}
              onClick={() => onChange({ ...value, sort: s.value })}
            >
              {s.label}
            </Pill>
          ))}
        </div>
      </section>

      {/* Price */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Max price</Label>
          <span className="text-sm font-medium tabular-nums">{formatINR(price)}</span>
        </div>
        <Slider
          min={50}
          max={maxPriceCeiling}
          step={50}
          value={[price]}
          onValueChange={([v]) => onChange({ ...value, maxPrice: v })}
          aria-label="Maximum price"
        />
      </section>

      {/* Delivery time */}
      <section className="space-y-3">
        <Label>Delivery time</Label>
        <div className="flex flex-wrap gap-2">
          {ETA_OPTIONS.map((o) => (
            <Pill
              key={o.value}
              active={value.maxEtaMins === o.value}
              onClick={() =>
                onChange({ ...value, maxEtaMins: value.maxEtaMins === o.value ? undefined : o.value })
              }
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </section>

      {/* Rating */}
      <section className="space-y-3">
        <Label>Customer rating</Label>
        <div className="flex flex-wrap gap-2">
          {RATING_OPTIONS.map((r) => (
            <Pill
              key={r}
              active={value.minRating === r}
              onClick={() => onChange({ ...value, minRating: value.minRating === r ? undefined : r })}
            >
              {r}★ & above
            </Pill>
          ))}
        </div>
      </section>
    </div>
  );
}
