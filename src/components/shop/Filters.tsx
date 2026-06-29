"use client";

// Search filter sheet — migrated from the prototype's FilterSheet + FilterControls,
// adapted to the current architecture: it filters the LIVE ONDC catalog
// client-side and is limited to fields ONDC reliably provides (price + sort).
// The prototype's mock eta/rating filters were intentionally dropped.
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/shop/ui-sheet";
import { Slider } from "@/components/shop/ui-slider";
import { Button, Badge, Label } from "@/components/shop/ui";
import { cn, formatINR } from "@/lib/shop/cn";
import {
  activeFilterCount,
  type ShopFilters,
  type ShopSort,
} from "@/lib/shop/types";

const SORTS: { value: ShopSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_low", label: "Price: Low to High" },
  { value: "price_high", label: "Price: High to Low" },
];

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

function FilterControls({
  value,
  onChange,
  maxPriceCeiling,
}: {
  value: ShopFilters;
  onChange: (next: ShopFilters) => void;
  maxPriceCeiling: number;
}) {
  const price = value.maxPrice ?? maxPriceCeiling;
  return (
    <div className="space-y-7">
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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Max price</Label>
          <span className="text-sm font-medium tabular-nums">
            {formatINR(price)}
          </span>
        </div>
        <Slider
          min={50}
          max={maxPriceCeiling}
          step={50}
          value={[price]}
          onValueChange={([v]: number[]) => onChange({ ...value, maxPrice: v })}
          aria-label="Maximum price"
        />
      </section>
    </div>
  );
}

export function FilterSheet({
  filters,
  onApply,
  maxPriceCeiling,
}: {
  filters: ShopFilters;
  onApply: (next: ShopFilters) => void;
  maxPriceCeiling: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ShopFilters>(filters);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDraft(filters);
  }, [open, filters]);

  const count = activeFilterCount(filters);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {count > 0 ? (
            <Badge className="ml-1 h-5 min-w-5 justify-center px-1 text-[11px]">
              {count}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters &amp; Sort</SheetTitle>
          <SheetDescription>Refine results across all sellers.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          <FilterControls
            value={draft}
            onChange={setDraft}
            maxPriceCeiling={maxPriceCeiling}
          />
        </div>

        <SheetFooter className="flex-row gap-3 border-t border-border">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              const cleared: ShopFilters = { sort: "relevance" };
              setDraft(cleared);
              onApply(cleared);
              setOpen(false);
            }}
          >
            Clear all
          </Button>
          <SheetClose asChild>
            <Button className="flex-1" onClick={() => onApply(draft)}>
              Show results
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
