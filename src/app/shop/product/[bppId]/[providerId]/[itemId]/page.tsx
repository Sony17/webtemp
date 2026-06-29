"use client";

// Buyer-app PRODUCT DETAIL + SELLER SELECTION. ONDC has no global SKU, so the
// "same" product can be offered by several sellers at different prices — this
// screen shows the chosen item plus a compare-sellers list (cheapest first).
// The product data comes from the active discovery transaction's catalogs.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, ShoppingCart, Store, Star, PackageSearch } from "lucide-react";
import { Button, Card, Separator, Badge } from "@/components/shop/ui";
import {
  EmptyState,
  ProductThumb,
  QuantityStepper,
  Spinner,
} from "@/components/shop/widgets";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
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
  const { transactionId, addToCart } = useShop();

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

  const product = products.find(
    (p) =>
      p.bppId === bppId && p.providerId === providerId && p.itemId === itemId
  );

  // Which seller offer is currently selected (defaults to the one in the URL).
  const [selected, setSelected] = React.useState<SellerOffer | null>(null);
  const [qty, setQty] = React.useState(1);

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
    if (polling) return <Spinner label="Loading product…" />;
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

  const add = (then?: "cart" | "checkout") => {
    addToCart(toAdd, qty);
    if (then === "checkout") router.push("/shop/cart");
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
          {activeOffer!.providerName}
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

      <Separator />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Quantity</span>
        <QuantityStepper value={qty} onChange={(v) => setQty(Math.max(1, v))} min={1} />
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-[3.25rem] z-20 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="outline" className="flex-1" onClick={() => add()}>
            <ShoppingCart className="h-4 w-4" /> Add to cart
          </Button>
          <Button className="flex-1" onClick={() => add("checkout")}>
            Buy now
          </Button>
        </div>
      </div>
    </div>
  );
}
