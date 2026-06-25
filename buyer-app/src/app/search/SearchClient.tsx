"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SearchX, PackageSearch, X, SlidersHorizontal } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { SearchBar } from "@/components/SearchBar";
import { ProductCard } from "@/components/ProductCard";
import { FilterSheet } from "@/components/FilterSheet";
import { FilterControls } from "@/components/FilterControls";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ProductGridSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { searchProducts } from "@/services/catalog";
import { categories } from "@/mock/categories";
import { pluralize, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product, SearchFilters } from "@/types";

const SORT_LABELS: Record<string, string> = {
  relevance: "Relevance",
  price_low: "Price: Low to High",
  price_high: "Price: High to Low",
  rating: "Top rated",
  fastest: "Fastest",
};

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onRemove}
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2 }}
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
    >
      {label}
      <X className="h-3 w-3" />
    </motion.button>
  );
}

export function SearchClient() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get("q") ?? "";
  const categoryId = params.get("category") ?? "";
  const categoryName = categories.find((c) => c.id === categoryId)?.name;

  const [filters, setFilters] = React.useState<SearchFilters>({ sort: "relevance" });
  const [results, setResults] = React.useState<Product[] | null>(null);
  const [error, setError] = React.useState(false);

  const effectiveQuery = query || categoryId;

  const load = React.useCallback(async () => {
    setResults(null);
    setError(false);
    try {
      setResults(await searchProducts(effectiveQuery, filters));
    } catch {
      setError(true);
    }
  }, [effectiveQuery, filters]);

  React.useEffect(() => {
    load();
  }, [load]);

  const heading = query ? `Results for “${query}”` : categoryName ?? "All products";

  const hasChips =
    (filters.sort && filters.sort !== "relevance") ||
    filters.maxPrice != null ||
    filters.maxEtaMins != null ||
    filters.minRating != null;

  const quickSorts: SearchFilters["sort"][] = ["relevance", "price_low", "rating", "fastest"];

  return (
    <PageContainer className="space-y-4">
      {/* Sticky search + filter bar */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-lg lg:top-0">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SearchBar
                defaultValue={query}
                onSubmit={(q) => router.push(`/search?q=${encodeURIComponent(q)}`)}
              />
            </div>
            <FilterSheet filters={filters} onApply={setFilters} />
          </div>

          {/* Quick sort pills — mobile/tablet only (desktop uses the sidebar) */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0 lg:hidden">
            {quickSorts.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, sort: s }))}
                className={cn(
                  "whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                  (filters.sort ?? "relevance") === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/40"
                )}
              >
                {SORT_LABELS[s!]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[244px_1fr] lg:gap-8">
        {/* Desktop filter sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </h2>
              {hasChips && (
                <button
                  onClick={() => setFilters({ sort: "relevance" })}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <FilterControls value={filters} onChange={setFilters} />
          </div>
        </aside>

        {/* Results column */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{heading}</h1>
              {results && (
                <p className="text-sm text-muted-foreground">
                  {results.length} {pluralize(results.length, "product")} across the network
                </p>
              )}
            </div>
          </div>

          {hasChips && (
            <div className="flex flex-wrap items-center gap-2">
              <AnimatePresence>
                {filters.sort && filters.sort !== "relevance" && (
                  <FilterChip
                    key="sort"
                    label={SORT_LABELS[filters.sort]}
                    onRemove={() => setFilters((f) => ({ ...f, sort: "relevance" }))}
                  />
                )}
                {filters.maxPrice != null && (
                  <FilterChip
                    key="price"
                    label={`Under ${formatINR(filters.maxPrice)}`}
                    onRemove={() => setFilters((f) => ({ ...f, maxPrice: undefined }))}
                  />
                )}
                {filters.maxEtaMins != null && (
                  <FilterChip
                    key="eta"
                    label={`Under ${filters.maxEtaMins} min`}
                    onRemove={() => setFilters((f) => ({ ...f, maxEtaMins: undefined }))}
                  />
                )}
                {filters.minRating != null && (
                  <FilterChip
                    key="rating"
                    label={`${filters.minRating}★ & above`}
                    onRemove={() => setFilters((f) => ({ ...f, minRating: undefined }))}
                  />
                )}
              </AnimatePresence>
            </div>
          )}

          {error ? (
            <ErrorState onRetry={load} />
          ) : results === null ? (
            <ProductGridSkeleton count={9} className="sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4" />
          ) : results.length === 0 ? (
            <EmptyState
              icon={effectiveQuery ? SearchX : PackageSearch}
              title="No products found"
              description={
                effectiveQuery
                  ? `We couldn't find anything for “${effectiveQuery}”. Try a different search or adjust your filters.`
                  : "Try searching for a product or browsing a category."
              }
              action={
                <Button variant="outline" onClick={() => setFilters({ sort: "relevance" })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <motion.div
              layout
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4"
            >
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
