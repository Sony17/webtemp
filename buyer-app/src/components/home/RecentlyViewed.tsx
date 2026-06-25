"use client";

import { Carousel } from "@/components/Carousel";
import { ProductCard } from "@/components/ProductCard";
import { SectionHeader } from "@/components/layout/PageContainer";
import { useRecentlyViewed } from "@/hooks/use-recently-viewed";
import { products } from "@/mock/products";

/** Client section — reads the recently-viewed store and shows matching products. */
export function RecentlyViewed() {
  const ids = useRecentlyViewed();
  const items = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is (typeof products)[number] => Boolean(p));

  if (items.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Recently viewed"
        subtitle="Pick up where you left off"
      />
      <Carousel ariaLabel="Recently viewed products" itemClassName="w-[160px] sm:w-[200px]">
        {items.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </Carousel>
    </section>
  );
}
