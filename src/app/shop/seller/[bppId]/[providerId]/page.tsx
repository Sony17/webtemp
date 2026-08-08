"use client";

// Buyer-app SELLER PROFILE — a seller's storefront: a header (name, area,
// rating, item count) plus every item they offer, grouped by category. ONDC
// sellers answer a `search` with their FULL catalog, so a seller's items are
// already in the active discovery session's accumulated catalogs — we just
// filter to this provider. No separate provider-scoped call is needed.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Store, MapPin, Tags, PackageSearch } from "lucide-react";
import { Button } from "@/components/shop/ui";
import {
  EmptyState,
  ProductCard,
  ProductThumb,
  SectionHeader,
} from "@/components/shop/widgets";
import { Rating } from "@/components/shop/Rating";
import { ProductGridSkeleton } from "@/components/shop/Skeletons";
import { Stagger, StaggerItem } from "@/components/shop/motion";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import {
  parseCatalogs,
  findSeller,
  itemsForProvider,
  type Product,
} from "@/lib/shop/types";

export default function SellerPage() {
  const params = useParams<{ bppId: string; providerId: string }>();
  const router = useRouter();
  const { transactionId, addToCart } = useShop();

  const bppId = decodeURIComponent(params.bppId);
  const providerId = decodeURIComponent(params.providerId);

  const { state, polling } = useShopState(transactionId, {
    intervalMs: 3000,
    maxMs: 8000,
    enabled: !!transactionId,
  });

  const products = React.useMemo(
    () => (state ? parseCatalogs(state.catalogs) : []),
    [state]
  );
  const seller = React.useMemo(
    () => (state ? findSeller(state.catalogs, bppId, providerId) : undefined),
    [state, bppId, providerId]
  );
  const items = React.useMemo(
    () => itemsForProvider(products, bppId, providerId),
    [products, bppId, providerId]
  );

  // Group the seller's items by category for a storefront-style layout.
  const groups = React.useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of items) {
      const key = p.categoryId ?? "Other";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return [...m.entries()];
  }, [items]);

  // No items for this seller in the live catalog: either the discovery window
  // aged out / this is a deep link with no active session, or we're still
  // waiting on on_search to land.
  if (items.length === 0) {
    if (polling) return <ProductGridSkeleton shimmer />;
    return (
      <EmptyState
        icon={<PackageSearch className="h-7 w-7" />}
        title="Seller not available"
        description="This seller isn't in the current search results. Run a search to see live sellers and their catalogs."
        action={
          <Button variant="outline" onClick={() => router.push("/shop/search")}>
            Back to search
          </Button>
        }
      />
    );
  }

  const name = seller?.name ?? items[0]?.providerName ?? "Seller";
  const place = [seller?.locality, seller?.city].filter(Boolean).join(", ");

  return (
    <div className="space-y-5">
      {/* Seller header */}
      <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
          {seller?.image ? (
            <ProductThumb
              src={seller.image}
              alt={name}
              className="h-full w-full"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-primary">
              <Store className="h-7 w-7" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">{name}</h1>
          {seller?.shortDesc ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {seller.shortDesc}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {seller?.rating ? <Rating value={seller.rating} /> : null}
            {place ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {place}
                {seller?.areaCode ? ` · ${seller.areaCode}` : ""}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Tags className="h-3.5 w-3.5" />
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
            {/* Delivery reach declared in the seller's catalog. */}
            {seller?.panIndia ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                Ships across India
              </span>
            ) : seller?.serviceRadiusKm != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
                Delivers within {Math.round(seller.serviceRadiusKm)} km
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Items grouped by category */}
      {groups.map(([cat, list]) => (
        <section key={cat}>
          <SectionHeader title={cat} />
          <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((p, i) => (
              <StaggerItem key={p.itemId}>
                <ProductCard product={p} onAdd={addToCart} priority={i < 5} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ))}
    </div>
  );
}
