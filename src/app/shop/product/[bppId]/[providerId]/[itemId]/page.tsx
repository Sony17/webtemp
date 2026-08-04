"use client";

// Buyer-app PRODUCT DETAIL + SELLER SELECTION. ONDC has no global SKU, so the
// "same" product can be offered by several sellers at different prices — this
// screen shows the chosen item plus a compare-sellers list (cheapest first).
// The product data comes from the active discovery transaction's catalogs.
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Store, Star, PackageSearch, Truck, Tags, Zap } from "lucide-react";
import { Button, Card, Badge } from "@/components/shop/ui";
import {
  EmptyState,
  ProductThumb,
  CartControl,
} from "@/components/shop/widgets";
import { Disclosure } from "@/components/shop/Disclosure";
import { DetailSkeleton } from "@/components/shop/Skeletons";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import { recordView, useRecentlyViewed } from "@/lib/shop/hooks/use-recently-viewed";
import {
  offersForProduct,
  parseCatalogs,
  type Product,
  type SellerOffer,
} from "@/lib/shop/types";
import { formatINR } from "@/lib/shop/cn";

export default function ProductPage() {
  const params = useParams<{
    bppId: string;
    providerId: string;
    itemId: string;
  }>();
  const router = useRouter();
  const { transactionId, addToCart, lines } = useShop();

  const bppId = decodeURIComponent(params.bppId);
  const providerId = decodeURIComponent(params.providerId);
  const itemId = decodeURIComponent(params.itemId);

  const { state, polling } = useShopState(transactionId, {
    intervalMs: 3000,
    maxMs: 8000,
    enabled: !!transactionId,
  });

  const products = React.useMemo(
    () => (state ? parseCatalogs(state.catalogs) : []),
    [state]
  );

  const liveProduct = products.find(
    (p) =>
      p.bppId === bppId && p.providerId === providerId && p.itemId === itemId
  );

  // Fall back to the recently-viewed snapshot when the live discovery catalog
  // no longer carries this item (search window aged out, or a deep-link/refresh
  // with no active transaction). The snapshot keeps the purchase-critical
  // identity (incl. bppUri), so add-to-cart → checkout still works.
  const recent = useRecentlyViewed();
  const product: Product | undefined = React.useMemo(() => {
    if (liveProduct) return liveProduct;
    const snap = recent.find(
      (r) => r.bppId === bppId && r.providerId === providerId && r.itemId === itemId
    );
    if (!snap?.bppUri) return undefined; // not purchasable without a bppUri
    return {
      bppId: snap.bppId,
      bppUri: snap.bppUri,
      providerId: snap.providerId,
      providerName: snap.providerName ?? "Seller",
      itemId: snap.itemId,
      locationId: snap.locationId,
      name: snap.name,
      description: snap.description,
      image: snap.image,
      price: snap.price,
      maxPrice: snap.maxPrice,
      currency: snap.currency,
      unit: snap.unit,
    };
  }, [liveProduct, recent, bppId, providerId, itemId]);

  // Record this product as recently viewed (snapshot) once it resolves. Keyed on
  // the stable ids so it fires once per product, not on every poll tick.
  React.useEffect(() => {
    if (product) recordView(product);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.bppId, product?.providerId, product?.itemId]);

  // Which seller offer is currently selected (defaults to the one in the URL).
  const [selected, setSelected] = React.useState<SellerOffer | null>(null);

  const offers = product ? offersForProduct(products, product) : [];
  const activeOffer: SellerOffer | null =
    selected ??
    offers.find(
      (o) => o.bppId === bppId && o.providerId === providerId
    ) ??
    (product
      ? {
          bppId: product.bppId,
          bppUri: product.bppUri,
          providerId: product.providerId,
          providerName: product.providerName,
          itemId: product.itemId,
          locationId: product.locationId,
          price: product.price,
          maxPrice: product.maxPrice,
          currency: product.currency,
        }
      : null);

  if (!product) {
    if (polling) return <DetailSkeleton />;
    return (
      <EmptyState
        icon={<PackageSearch className="h-7 w-7" />}
        title="Product not available"
        description="This item is no longer in the current search results. Run a new search to see live offers."
        action={
          <Button onClick={() => router.push("/shop/search")} variant="outline">
            Back to search
          </Button>
        }
      />
    );
  }

  // Build the Product to add, reflecting the selected seller offer.
  const toAdd: Product = {
    ...product,
    bppId: activeOffer!.bppId,
    bppUri: activeOffer!.bppUri,
    providerId: activeOffer!.providerId,
    providerName: activeOffer!.providerName,
    itemId: activeOffer!.itemId,
    locationId: activeOffer!.locationId,
    price: activeOffer!.price,
    maxPrice: activeOffer!.maxPrice,
  };

  // How many of THIS offer are already in the cart (drives the add→stepper
  // control and lets "Buy now" skip a redundant add).
  const inCart =
    lines.find(
      (l) => l.product.itemId === toAdd.itemId && l.product.bppId === toAdd.bppId
    )?.quantity ?? 0;

  const buyNow = () => {
    if (inCart === 0) addToCart(toAdd, 1);
    router.push("/shop/cart");
  };

  const discount =
    toAdd.maxPrice && toAdd.maxPrice > toAdd.price
      ? Math.round(((toAdd.maxPrice - toAdd.price) / toAdd.maxPrice) * 100)
      : 0;

  return (
    <div className="space-y-5 pb-24">
      <Card className="overflow-hidden">
        <div className="aspect-[4/3] w-full bg-muted">
          <ProductThumb
            src={product.image}
            alt={product.name}
            className="h-full w-full"
          />
        </div>
      </Card>

      <div>
        <h1 className="text-xl font-semibold leading-snug">{product.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {product.unit ? `${product.unit} · ` : ""}Sold by{" "}
          <Link
            href={`/shop/seller/${encodeURIComponent(
              activeOffer!.bppId
            )}/${encodeURIComponent(activeOffer!.providerId)}`}
            className="font-medium text-primary hover:underline"
          >
            {activeOffer!.providerName}
          </Link>
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-2xl font-semibold">
            {formatINR(toAdd.price)}
          </span>
          {discount > 0 ? (
            <>
              <span className="text-sm text-muted-foreground line-through">
                {formatINR(toAdd.maxPrice)}
              </span>
              <Badge variant="success">{discount}% off</Badge>
            </>
          ) : null}
        </div>
        {product.description ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {product.description}
          </p>
        ) : null}
      </div>

      {/* Delivery & returns */}
      <Disclosure title="Delivery & returns" icon={<Truck className="h-4 w-4 text-primary" />}>
        Sold and fulfilled by {activeOffer!.providerName} on the ONDC network.
        Delivery options and final charges are confirmed by the seller at
        checkout. Returns, replacements and cancellations are handled per the
        seller&apos;s policy — you can raise them from your order after delivery.
      </Disclosure>

      {/* Seller comparison */}
      {offers.length > 1 ? (
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Store className="h-4 w-4" /> Compare {offers.length} sellers
          </h2>
          <div className="space-y-2">
            {offers.map((o) => {
              const isActive =
                o.bppId === activeOffer!.bppId &&
                o.providerId === activeOffer!.providerId;
              return (
                <button
                  key={`${o.bppId}:${o.providerId}:${o.itemId}`}
                  onClick={() => setSelected(o)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-accent/40 ring-1 ring-primary"
                      : "border-border hover:bg-accent/30"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{o.providerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.rating ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {o.rating.toFixed(1)} ·{" "}
                        </span>
                      ) : null}
                      {o.bppId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {formatINR(o.price)}
                    </span>
                    {isActive ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* More from this seller — grouped by category */}
      {(() => {
        const sameProvider = products.filter(
          (p) => p.bppId === bppId && p.providerId === providerId && p.itemId !== itemId
        );
        if (sameProvider.length === 0) return null;
        const groups = new Map<string, Product[]>();
        for (const p of sameProvider) {
          const key = p.categoryId ?? "Other";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p);
        }
        return (
          <div>
            <h2 className="mb-2 flex items-center justify-between gap-1.5 text-sm font-semibold">
              <span className="flex items-center gap-1.5">
                <Tags className="h-4 w-4" /> More from {product.providerName}
              </span>
              <Link
                href={`/shop/seller/${encodeURIComponent(
                  bppId
                )}/${encodeURIComponent(providerId)}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                View store
              </Link>
            </h2>
            <div className="space-y-3">
              {[...groups.entries()].map(([cat, items]) => (
                <div key={cat}>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {cat}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((p) => (
                      <button
                        key={p.itemId}
                        onClick={() =>
                          router.push(
                            `/shop/product/${encodeURIComponent(bppId)}/${encodeURIComponent(providerId)}/${encodeURIComponent(p.itemId)}`
                          )
                        }
                        className="rounded-lg border border-border px-2.5 py-2 text-left text-sm leading-tight hover:bg-accent/30"
                      >
                        <p className="font-medium">{p.name}</p>
                        {p.price ? (
                          <p className="text-xs text-muted-foreground">
                            ₹{p.price.toLocaleString("en-IN")}
                            {p.unit ? ` / ${p.unit}` : ""}
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Sticky action bar — price on the left, the signature add→stepper
          control (in-cart quantity, adjustable in place), and Buy now. */}
      <div className="fixed inset-x-0 bottom-[3.25rem] z-20 border-t border-border bg-background/95 backdrop-blur-md md:bottom-0">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex shrink-0 flex-col leading-tight">
            <span className="text-[11px] text-muted-foreground">Price</span>
            <span className="text-lg font-semibold">{formatINR(toAdd.price)}</span>
          </div>
          <CartControl product={toAdd} size="lg" className="flex-1" />
          <Button size="lg" className="flex-1" onClick={buyNow}>
            <Zap className="h-4 w-4" /> Buy now
          </Button>
        </div>
      </div>
    </div>
  );
}
