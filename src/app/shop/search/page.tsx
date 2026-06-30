"use client";

// Buyer-app SEARCH — fires an ONDC `search` (broadcast to the gateway), then
// polls /api/shop/state as `on_search` catalogs stream in asynchronously from
// multiple sellers. Results render incrementally; we keep polling for a short
// window because more sellers may answer over time (ONDC has no single "done").
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, SearchX, Store } from "lucide-react";
import { Button } from "@/components/shop/ui";
import { EmptyState, ProductCard, Spinner } from "@/components/shop/widgets";
import { ErrorState } from "@/components/shop/ErrorState";
import { ProductGridSkeleton } from "@/components/shop/Skeletons";
import { FilterSheet } from "@/components/shop/Filters";
import { Stagger, StaggerItem } from "@/components/shop/motion";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import {
  parseCatalogs,
  filterByQuery,
  filterAndSortProducts,
  priceCeiling,
  type Product,
  type ShopFilters,
} from "@/lib/shop/types";
import * as api from "@/lib/shop/api";

function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const { address, addToCart, setTransactionId } = useShop();

  const [q, setQ] = React.useState(initialQ);
  // The query that the CURRENT results are filtered against — set when a search
  // actually fires (not on every keystroke), so editing the box without
  // submitting doesn't re-filter the visible catalog mid-type.
  const [activeQuery, setActiveQuery] = React.useState(initialQ.trim());
  const [txn, setTxn] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<ShopFilters>({ sort: "relevance" });

  const runSearch = React.useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setActiveQuery(trimmed);
      setSearching(true);
      setError(null);
      setTxn(null);
      try {
        const res = await api.search({
          query: trimmed,
          deliveryAreaCode: address?.areaCode,
          deliveryGps: address?.gps,
        });
        if (res.status === "NACK") {
          setError(res.error?.message ?? "The network rejected the search.");
        } else {
          setTxn(res.transactionId);
          setTransactionId(res.transactionId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        setSearching(false);
      }
    },
    [address, setTransactionId]
  );

  // Fire the initial search from the ?q= seed once. runSearch kicks off a
  // network request (external system) and updates state from its result.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (initialQ) runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Poll for catalogs for ~30s after a search; sellers answer over time.
  const { state, polling } = useShopState(txn, {
    intervalMs: 2000,
    maxMs: 30_000,
    enabled: !!txn,
  });

  const products: Product[] = React.useMemo(
    () => (state ? parseCatalogs(state.catalogs) : []),
    [state]
  );
  // Narrow the seller's full catalog to the user's query FIRST (ONDC returns the
  // whole catalog), THEN apply the price/sort filters on top of the matches.
  const matched = React.useMemo(
    () => filterByQuery(products, activeQuery),
    [products, activeQuery]
  );
  const ceiling = React.useMemo(() => priceCeiling(matched), [matched]);
  const shown = React.useMemo(
    () => filterAndSortProducts(matched, filters),
    [matched, filters]
  );
  const sellerCount = state
    ? new Set(state.catalogs.map((c) => c.bppId)).size
    : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.replace(`/shop/search?q=${encodeURIComponent(q.trim())}`);
    runSearch(q);
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="sticky top-14 z-20 -mx-4 bg-background/80 px-4 py-2 backdrop-blur-md"
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <SearchIcon className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus={!initialQ}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" className="text-sm font-medium text-primary">
            Search
          </button>
        </div>
      </form>

      {/* Status line + filters */}
      {txn ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Store className="h-3.5 w-3.5" />
            {sellerCount} seller{sellerCount === 1 ? "" : "s"} ·{" "}
            {shown.length} item{shown.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            {polling ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Finding more…
              </span>
            ) : null}
            {products.length > 0 ? (
              <FilterSheet
                filters={filters}
                onApply={setFilters}
                maxPriceCeiling={ceiling}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* States */}
      {error ? (
        <ErrorState
          title="Search couldn't complete"
          description={error}
          onRetry={() => runSearch(q)}
        />
      ) : searching && !txn ? (
        <ProductGridSkeleton />
      ) : !txn ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search the ONDC network"
          description="Type what you need above. Sellers across the network will respond with their catalogs."
        />
      ) : products.length === 0 ? (
        polling ? (
          <ProductGridSkeleton />
        ) : (
          <EmptyState
            icon={<SearchX className="h-7 w-7" />}
            title="No results yet"
            description="No sellers returned a catalog for this search. Try a different term or check your delivery location."
          />
        )
      ) : matched.length === 0 ? (
        // Sellers responded, but nothing in their catalogs matches the query.
        // Keep showing the skeleton while more sellers may still answer; once
        // polling stops, show a definitive "No products found" instead of the
        // unmatched full catalog.
        polling ? (
          <ProductGridSkeleton />
        ) : (
          <EmptyState
            icon={<SearchX className="h-7 w-7" />}
            title="No products found"
            description={`No products matched "${activeQuery}". Try a different search term.`}
          />
        )
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<SearchX className="h-7 w-7" />}
          title="No items match your filters"
          description="Try widening the price range or clearing the filters."
          action={
            <Button
              variant="outline"
              onClick={() => setFilters({ sort: "relevance" })}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <Stagger className="grid grid-cols-2 gap-3">
          {shown.map((p, i) => (
            <StaggerItem key={`${p.bppId}:${p.providerId}:${p.itemId}`}>
              <ProductCard product={p} onAdd={addToCart} priority={i < 4} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SearchScreen />
    </Suspense>
  );
}
