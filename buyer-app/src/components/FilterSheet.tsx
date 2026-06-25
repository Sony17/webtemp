"use client";

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
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterControls } from "@/components/FilterControls";
import type { SearchFilters } from "@/types";

export function FilterSheet({
  filters,
  onApply,
  maxPriceCeiling = 20000,
}: {
  filters: SearchFilters;
  onApply: (next: SearchFilters) => void;
  maxPriceCeiling?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<SearchFilters>(filters);

  React.useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const activeCount =
    (filters.maxPrice != null ? 1 : 0) +
    (filters.maxEtaMins != null ? 1 : 0) +
    (filters.minRating != null ? 1 : 0) +
    (filters.sort && filters.sort !== "relevance" ? 1 : 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 lg:hidden">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <Badge className="ml-1 h-5 min-w-5 justify-center px-1 text-[11px]">{activeCount}</Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters & Sort</SheetTitle>
          <SheetDescription>Refine results across all sellers.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          <FilterControls value={draft} onChange={setDraft} maxPriceCeiling={maxPriceCeiling} />
        </div>

        <SheetFooter className="flex-row gap-3 border-t border-border">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              const cleared: SearchFilters = { sort: "relevance" };
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
