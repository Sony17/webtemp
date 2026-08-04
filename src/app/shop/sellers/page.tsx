"use client";

// Buyer-app BROWSE SELLERS — every store answering the buyer's active search,
// ordered nearest-first from the saved delivery location. ONDC discovery is
// per-session: the sellers here come from the same accumulated on_search
// catalogs the product grid reads (useShopState), so this needs a live search to
// populate. Each row deep-links to the seller's storefront
// (/shop/seller/[bppId]/[providerId]). Distance is computed client-side from the
// buyer's saved gps; with no location set, the list falls back to a name sort.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Navigation, Store, PackageSearch, Tags } from "lucide-react";
import { Button } from "@/components/shop/ui";
import { EmptyState, ProductThumb } from "@/components/shop/widgets";
import { Rating } from "@/components/shop/Rating";
import { ProductGridSkeleton } from "@/components/shop/Skeletons";
import { Stagger, StaggerItem } from "@/components/shop/motion";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import {
  parseCatalogs,
  parseProviders,
  sortSellersByDistance,
  formatDistance,
} from "@/lib/shop/types";

export default function SellersPage() {
  const router = useRouter();
  const { transactionId, address } = useShop();

  const { state, polling } = useShopState(transactionId, {
    intervalMs: 3000,
    maxMs: 8000,
    enabled: !!transactionId,
  });

  // Item count per (bppId|providerId) so each store card shows its catalog size.
  const itemCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    if (!state) return m;
    for (const p of parseCatalogs(state.catalogs)) {
      const k = `${p.bppId}|${p.providerId}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [state]);

  const sellers = React.useMemo(
    () =>
      state
        ? sortSellersByDistance(parseProviders(state.catalogs), address?.gps)
        : [],
    [state, address?.gps]
  );

  // No sellers in the live catalog: either a deep link with no active session /
  // an aged-out discovery window, or on_search hasn't landed yet.
  if (sellers.length === 0) {
    if (polling) return <ProductGridSkeleton shimmer />;
    return (
      <EmptyState
        icon={<PackageSearch className="h-7 w-7" />}
        title="No stores yet"
        description="Run a search to discover live sellers on the network near you."
        action={
          <Button onClick={() => router.push("/shop/search")}>
            Search groceries
          </Button>
        }
      />
    );
  }

  const located = !!address?.gps;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Stores near you</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {sellers.length} store{sellers.length === 1 ? "" : "s"} on the network
          {located ? " · nearest first" : ""}
        </p>
      </div>

      {!located ? (
        <button
          type="button"
          onClick={() => router.push("/shop/search")}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/40"
        >
          <Navigation className="h-4 w-4 shrink-0 text-primary" />
          <span>Set your delivery location to sort stores by distance.</span>
        </button>
      ) : null}

      <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sellers.map((s) => {
          const place = [s.locality, s.city].filter(Boolean).join(", ");
          const count = itemCounts.get(`${s.bppId}|${s.providerId}`) ?? 0;
          const dist = formatDistance(s.distanceKm);
          return (
            <StaggerItem key={`${s.bppId}|${s.providerId}`}>
              <Link
                href={`/shop/seller/${encodeURIComponent(
                  s.bppId
                )}/${encodeURIComponent(s.providerId)}`}
                className="flex h-full items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/30"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {s.image ? (
                    <ProductThumb
                      src={s.image}
                      alt={s.name}
                      className="h-full w-full"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-primary">
                      <Store className="h-6 w-6" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate font-semibold leading-tight">
                      {s.name}
                    </h2>
                    {dist ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        <Navigation className="h-3 w-3" />
                        {dist}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    {s.rating ? <Rating value={s.rating} /> : null}
                    {place ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{place}</span>
                      </span>
                    ) : null}
                  </div>
                  {count > 0 ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Tags className="h-3.5 w-3.5" />
                      {count} item{count === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
