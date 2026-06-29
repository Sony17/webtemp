"use client";

// "Recently viewed" horizontal row (migrated from the prototype's home section).
// Reads the localStorage snapshot store. Cards link to a fresh search for the
// product name — robust across discovery sessions (a deep link to the product
// route can go stale when the active transaction changes).
import Link from "next/link";
import { useRecentlyViewed } from "@/lib/shop/hooks/use-recently-viewed";
import { ProductThumb } from "@/components/shop/widgets";
import { Carousel } from "@/components/shop/Carousel";
import { formatINR } from "@/lib/shop/cn";

export function RecentlyViewed() {
  const items = useRecentlyViewed();
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold tracking-tight">
        Recently viewed
      </h2>
      <Carousel ariaLabel="Recently viewed products" itemClassName="w-28">
        {items.map((p) => (
          <Link
            key={`${p.bppId}:${p.providerId}:${p.itemId}`}
            href={`/shop/search?q=${encodeURIComponent(p.name)}`}
            className="block"
          >
            <div className="aspect-square w-28 overflow-hidden rounded-xl border border-border bg-card">
              <ProductThumb
                src={p.image}
                alt={p.name}
                className="h-full w-full"
              />
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">{formatINR(p.price)}</p>
          </Link>
        ))}
      </Carousel>
    </section>
  );
}
