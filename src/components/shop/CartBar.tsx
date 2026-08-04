"use client";

// Floating "View cart" bar — the signature quick-commerce conversion element
// (Blinkit/Zepto). It rides above the mobile bottom-nav and as a centred pill on
// desktop, showing live item count + running total + the seller the cart
// belongs to. Rendered globally by Chrome but self-gating: it only appears on
// the discovery surfaces (home + search) and only when the cart has items — the
// cart/checkout/product screens have their own sticky action bars, so it stays
// out of their way to avoid stacking two bars.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, ArrowRight } from "lucide-react";
import { useShop } from "@/lib/shop/store";
import { formatINR, pluralize } from "@/lib/shop/cn";

export function CartBar() {
  const pathname = usePathname();
  const { cartCount, cartTotal, lines } = useShop();

  const onDiscovery =
    pathname === "/shop" || (pathname?.startsWith("/shop/search") ?? false);

  if (!onDiscovery || cartCount === 0) return null;

  const seller = lines[0]?.product.providerName;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 px-4 md:bottom-6 md:px-6"
      role="region"
      aria-label="Cart summary"
    >
      <div className="mx-auto max-w-2xl md:max-w-md">
        <Link
          href="/shop/cart"
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-soft-lg ring-1 ring-black/5 transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
              <ShoppingCart className="h-4 w-4" />
              <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-background px-1 text-[10px] font-bold text-primary">
                {cartCount}
              </span>
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-bold tabular-nums">
                {cartCount} {pluralize(cartCount, "item")} ·{" "}
                {formatINR(cartTotal)}
              </span>
              {seller ? (
                <span className="truncate text-[11px] font-medium text-primary-foreground/80">
                  {seller}
                </span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-bold">
            View cart
            <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      </div>
    </div>
  );
}
