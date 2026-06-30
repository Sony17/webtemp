"use client";

// Buyer-app CART. Single-seller (ONDC orders are per-provider). Shows lines,
// quantity controls and an indicative total (the BINDING price comes later from
// the seller's on_select quote at checkout — ONDC prices are late-binding).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, ShoppingCart, Store } from "lucide-react";
import { Button, Card, Separator } from "@/components/shop/ui";
import { EmptyState, ProductThumb, QuantityStepper } from "@/components/shop/widgets";
import { AnimatedNumber } from "@/components/shop/motion";
import { useShop } from "@/lib/shop/store";
import { formatINR } from "@/lib/shop/cn";

export default function CartPage() {
  const router = useRouter();
  const { lines, setQuantity, removeFromCart, cartTotal, cartCount } = useShop();

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart className="h-7 w-7" />}
        title="Your cart is empty"
        description="Find something you like and add it here."
        action={
          <Button onClick={() => router.push("/shop/search")}>
            Start shopping
          </Button>
        }
      />
    );
  }

  const seller = lines[0].product.providerName;

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Store className="h-4 w-4" /> Sold by{" "}
        <span className="font-medium text-foreground">{seller}</span>
      </div>

      <div className="space-y-3">
        {lines.map(({ product, quantity }) => (
          <Card
            key={`${product.bppId}:${product.itemId}`}
            className="flex gap-3 p-3"
          >
            <Link
              href={`/shop/product/${encodeURIComponent(
                product.bppId
              )}/${encodeURIComponent(product.providerId)}/${encodeURIComponent(
                product.itemId
              )}`}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted"
            >
              <ProductThumb
                src={product.image}
                alt={product.name}
                className="h-full w-full"
              />
            </Link>
            <div className="flex flex-1 flex-col">
              <p className="line-clamp-2 text-sm font-medium">{product.name}</p>
              <p className="text-xs text-muted-foreground">
                {product.unit ?? ""}
              </p>
              <div className="mt-auto flex items-center justify-between pt-2">
                <span className="text-sm font-semibold">
                  {formatINR(product.price * quantity)}
                </span>
                <div className="flex items-center gap-2">
                  <QuantityStepper
                    value={quantity}
                    min={1}
                    onChange={(v) =>
                      setQuantity(product.itemId, product.bppId, v)
                    }
                  />
                  <button
                    aria-label="Remove"
                    onClick={() => removeFromCart(product.itemId, product.bppId)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Item total ({cartCount} item{cartCount === 1 ? "" : "s"})
          </span>
          <span className="font-medium">{formatINR(cartTotal)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Taxes &amp; delivery are confirmed by the seller at checkout.
        </p>
        <Separator className="my-3" />
        <div className="flex items-center justify-between">
          <span className="font-semibold">Estimated total</span>
          <span className="text-lg font-semibold">{formatINR(cartTotal)}</span>
        </div>
      </Card>

      {/* Sticky checkout */}
      <div className="fixed inset-x-0 bottom-[3.25rem] z-20 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <AnimatedNumber
              value={cartTotal}
              format={(v) => formatINR(v)}
              className="text-base font-semibold"
            />
          </div>
          <Button className="flex-1" onClick={() => router.push("/shop/checkout")}>
            Proceed to checkout
          </Button>
        </div>
      </div>
    </div>
  );
}
