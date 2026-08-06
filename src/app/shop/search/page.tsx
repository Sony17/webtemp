"use client";

// Buyer-app SEARCH — fires an ONDC `search` (broadcast to the gateway), then
// polls /api/shop/state as `on_search` catalogs stream in asynchronously from
// multiple sellers. Results render incrementally; we keep polling for a short
// window because more sellers may answer over time (ONDC has no single "done").
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Navigation,
  RefreshCw,
  Search as SearchIcon,
  SearchX,
  Store,
} from "lucide-react";
import { Button } from "@/components/shop/ui";
import { EmptyState, ProductCard, Spinner } from "@/components/shop/widgets";
import { ErrorState } from "@/components/shop/ErrorState";
import { SearchLoader } from "@/components/shop/SearchLoader";
import { FilterSheet } from "@/components/shop/Filters";
import { Stagger, StaggerItem } from "@/components/shop/motion";
import { useShop, type Address } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import {
  parseCatalogs,
  filterByQuery,
  filterAndSortProducts,
  priceCeiling,
  type Product,
  type ShopFilters,
  type CatalogRecord,
} from "@/lib/shop/types";
import { detectCurrentLocation } from "@/lib/shop/geolocate";
import { departmentLabel } from "@/lib/shop/categories";
import * as api from "@/lib/shop/api";

// Discovery city routing. "*" = pan-India: the network returns every serviceable
// seller regardless of city, and the app sorts them by distance from the buyer.
// This deliberately avoids pinning discovery to one city (which locked a Noida
// buyer to Bangalore-only results). Operators can force a specific STD city via
// the server's ONDC_SEARCH_CITY env var, which takes precedence over this.
const DISCOVERY_CITY = "*";

// The shop store hydrates `address` from localStorage in a mount effect, one
// tick after the seeded search fires — so read the persisted address directly
// here to avoid re-detecting location for a returning user. Mirrors the direct
// localStorage read in Chrome's first-visit prompt (same LS key).
const LS_ADDRESS = "shop.address.v1";
function readSavedAddress(): Address | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_ADDRESS);
    return raw ? (JSON.parse(raw) as Address) : null;
  } catch {
    return null;
  }
}

// Translate a raw ONDC gateway NACK into buyer-facing copy. The most common one
// on a non-grocery department is the registry rejecting our bap_id for a domain we
// aren't enrolled for ("Invalid bap_id ... for domain ONDC:RET12") — that's an
// ONDC subscriber-registration gap, not a user error, so we say so plainly instead
// of surfacing the raw protocol string.
function friendlyNack(msg: string | undefined, domain?: string): string {
  const m = (msg ?? "").trim();
  if (/bap_id/i.test(m) && /domain/i.test(m)) {
    const dept = departmentLabel(domain);
    return dept
      ? `${dept} isn't available on this network yet — this app isn't registered with ONDC for ${domain}.`
      : `This category isn't available on this network yet (ONDC registration pending${domain ? ` for ${domain}` : ""}).`;
  }
  return m || "The network rejected the search.";
}

function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";
  // ONDC domain to discover in (grocery unless a fashion/beauty/electronics
  // department or category seeded it). Threaded into every search on this screen.
  const searchDomain = params.get("domain") ?? undefined;
  const { address, addToCart, setAddress, setTransactionId, setDomain } = useShop();

  const [q, setQ] = React.useState(initialQ);
  // True while we're acquiring the buyer's live GPS before a search fires.
  const [locating, setLocating] = React.useState(false);
  // The query that the CURRENT results are filtered against — set when a search
  // actually fires (not on every keystroke), so editing the box without
  // submitting doesn't re-filter the visible catalog mid-type.
  const [activeQuery, setActiveQuery] = React.useState(initialQ.trim());
  const [txn, setTxn] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<ShopFilters>({ sort: "relevance" });
  const [refreshing, setRefreshing] = React.useState(false);

  const refreshCatalog = React.useCallback(async () => {
    if (!txn) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.search({
        query: activeQuery,
        domain: searchDomain,
        // Pan-India discovery — not pinned to any single city (see DISCOVERY_CITY).
        city: DISCOVERY_CITY,
        deliveryAreaCode: address?.areaCode,
        deliveryGps: address?.gps,
        deliveryCity: address?.city,
        deliveryLocality: address?.locality,
        deliveryState: address?.state,
        incremental: true,
        incrementalMode: "pull",
        transactionId: txn,
      });
      if (res.status === "NACK") {
        setError(friendlyNack(res.error?.message, searchDomain) ?? "Refresh rejected by the network.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [txn, activeQuery, address, searchDomain]);

  // ACCUMULATED catalog slices for the current search, keyed by (bppId,messageId).
  // Each /api/shop/state poll is load-balanced to one serverless instance and
  // returns only the slices THAT instance persisted (the JSON /tmp store isn't
  // shared across instances). By merging every poll's slices across the ~30s
  // window we recover the full seller set instead of showing whichever single
  // instance answered last. (Belt-and-suspenders until the shared DB is on.)
  const [accum, setAccum] = React.useState<Map<string, CatalogRecord>>(new Map());

  const runSearch = React.useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setActiveQuery(trimmed);
      // Record the discovery domain so items added from these results carry it
      // into the order lifecycle (grocery when unset).
      setDomain(searchDomain ?? null);
      setSearching(true);
      setError(null);
      setTxn(null);
      setAccum(new Map()); // fresh search → discard the previous seller set

      // Carry the buyer's live location into the ONDC intent so sellers serving
      // their area respond (RET10 serviceability is keyed on GPS). If no GPS is
      // saved yet, detect it now (permission-gated) and persist it — keeping any
      // pincode the buyer typed manually. A denied/failed fix just searches with
      // whatever we already have (pincode, or nothing). `saved` prefers the
      // hydrated store value, falling back to localStorage for the first-tick.
      const saved = address ?? readSavedAddress();
      let gps = saved?.gps;
      let areaCode = saved?.areaCode;
      // The buyer's place (city / locality / state) rides along so the dev mock
      // catalog can locate its sellers where the buyer actually is. Seeded from
      // the saved address, upgraded from a fresh reverse-geocode when we detect.
      let city = saved?.city;
      let locality = saved?.locality;
      let state = saved?.state;
      if (!gps) {
        setLocating(true);
        try {
          const loc = await detectCurrentLocation();
          gps = loc.gps;
          areaCode = areaCode ?? loc.areaCode;
          city = city ?? loc.city;
          locality = locality ?? loc.locality;
          state = state ?? loc.state;
          setAddress({
            ...(saved ?? { name: "", phone: "" }),
            gps: loc.gps,
            areaCode: saved?.areaCode ?? loc.areaCode,
            locality: saved?.locality ?? loc.locality,
            city: saved?.city ?? loc.city,
            state: saved?.state ?? loc.state,
          });
        } catch {
          // No live fix — fall through and search with the saved pincode (if any).
        } finally {
          setLocating(false);
        }
      }

      try {
        const res = await api.search({
          query: trimmed,
          domain: searchDomain,
          // Pan-India discovery — not pinned to any single city (see DISCOVERY_CITY).
          city: DISCOVERY_CITY,
          deliveryAreaCode: areaCode,
          deliveryGps: gps,
          deliveryCity: city,
          deliveryLocality: locality,
          deliveryState: state,
        });
        if (res.status === "NACK") {
          setError(friendlyNack(res.error?.message, searchDomain));
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
    [address, setAddress, setTransactionId, setDomain, searchDomain]
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

  // Merge each poll's catalog slices into the accumulator (external system:
  // async ONDC callbacks landing across instances over time).
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    const cats = state?.catalogs;
    if (!cats || cats.length === 0) return;
    setAccum((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const c of cats) {
        const k = `${c.bppId}|${c.messageId}`;
        if (!next.has(k)) {
          next.set(k, c);
          changed = true;
        }
      }
      return changed ? next : prev; // no new slices → keep ref (avoids re-render)
    });
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const products: Product[] = React.useMemo(
    () => parseCatalogs([...accum.values()]),
    [accum]
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
  const sellerCount = new Set(
    [...accum.values()].map((c) => c.bppId)
  ).size;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Preserve the active department so a typed query stays within Fashion/Beauty/
    // Electronics rather than silently falling back to grocery.
    const suffix = searchDomain ? `&domain=${encodeURIComponent(searchDomain)}` : "";
    router.replace(`/shop/search?q=${encodeURIComponent(q.trim())}${suffix}`);
    runSearch(q);
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="sticky top-14 z-20 -mx-4 bg-background/80 px-4 py-2 backdrop-blur-md md:top-16 md:-mx-6 md:px-6"
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

      {/* Active department chip — shows which ONDC domain these results come from
          when it's not the default grocery (Fashion / Beauty / Electronics). */}
      {departmentLabel(searchDomain) ? (
        <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
          <Store className="h-3.5 w-3.5" />
          {departmentLabel(searchDomain)}
        </p>
      ) : null}

      {/* Live-location line: shows we're acquiring GPS, then where we're
          searching from once a delivery location is set. */}
      {locating ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 animate-pulse text-primary" />
          Detecting your current location…
        </p>
      ) : address?.gps || address?.areaCode ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 text-primary" />
          Sellers near{" "}
          <span className="font-medium text-foreground">
            {address.city ?? address.locality ?? address.areaCode}
          </span>
        </p>
      ) : null}

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
            ) : products.length > 0 ? (
              <button
                type="button"
                disabled={refreshing}
                onClick={refreshCatalog}
                className="inline-flex items-center gap-1 text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3${refreshing ? " animate-spin" : ""}`}
                />
                Refresh
              </button>
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
        <SearchLoader />
      ) : !txn ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search the ONDC network"
          description="Type what you need above. Sellers across the network will respond with their catalogs."
        />
      ) : products.length === 0 ? (
        polling ? (
          <SearchLoader />
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
          <SearchLoader />
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
        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((p, i) => (
            <StaggerItem key={`${p.bppId}:${p.providerId}:${p.itemId}`}>
              <ProductCard product={p} onAdd={addToCart} priority={i < 5} />
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
