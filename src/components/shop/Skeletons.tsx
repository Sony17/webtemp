// Loading skeletons — migrated from the prototype. Rewired to the shop Skeleton
// primitive + cn. Used while ONDC catalogs/products stream in.
import { Skeleton } from "@/components/shop/ui";
import { cn } from "@/lib/shop/cn";

export function ProductCardSkeleton({ shimmer }: { shimmer?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft",
        shimmer && "skeleton-shimmer"
      )}
    >
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function ProductGridSkeleton({
  count = 10,
  className,
  shimmer,
}: {
  count?: number;
  className?: string;
  // Adds a moving sheen sweep on top of the pulse — a more premium "still
  // loading" feel for the longer ONDC discovery wait.
  shimmer?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} shimmer={shimmer} />
      ))}
    </div>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
      <div className="space-y-3">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

// A soft card wrapper that carries the moving-sheen sweep on top of the child
// skeletons' pulse — the shared "premium loading" look for the route skeletons
// below (shown instantly on navigation via each route's loading.tsx).
function ShimmerCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-2xl border border-border bg-card p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

// ORDER DETAIL — mirrors the order/success hub: a hero CTA card, a status
// timeline, the quote summary, and the secondary-action grid.
export function OrderDetailSkeleton() {
  return (
    <div className="space-y-5">
      <ShimmerCard>
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      </ShimmerCard>

      <ShimmerCard className="space-y-3">
        <Skeleton className="h-4 w-28" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </ShimmerCard>

      <ShimmerCard className="space-y-3">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-14" />
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </ShimmerCard>

      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// CART — seller line, cart items, price summary, and the checkout bar.
export function CartSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer flex gap-3 rounded-xl border border-border bg-card p-3"
          >
            <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
              <div className="mt-auto flex items-center justify-between">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <ShimmerCard className="space-y-2.5 rounded-xl p-4">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </ShimmerCard>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

// CHECKOUT — delivery address, order items, price summary, and pay CTA.
export function CheckoutSkeleton() {
  return (
    <div className="space-y-4">
      <ShimmerCard className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </ShimmerCard>
      <ShimmerCard className="space-y-3">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </ShimmerCard>
      <ShimmerCard className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-14" />
          </div>
        ))}
      </ShimmerCard>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

// SEARCH — a static search-bar + status row above the shimmering product grid.
// Shown for the brief chunk-load before the interactive SearchLoader radar takes
// over the real ONDC discovery wait.
export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-soft">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <ProductGridSkeleton shimmer />
    </div>
  );
}

// ACCOUNT — profile header, stat tiles, and setting rows.
export function AccountSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// HOME — hero (desktop), promo banner, category grid, and trust strip.
export function HomeSkeleton() {
  return (
    <div className="space-y-6 md:space-y-10">
      <Skeleton className="hidden h-56 w-full rounded-[1.75rem] md:block" />
      <Skeleton className="aspect-[16/9] w-full rounded-2xl sm:aspect-[21/9]" />
      <div>
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-16 w-16 rounded-2xl" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ORDERS LIST — heading + rows (thin wrapper over ListSkeleton).
export function OrdersListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-36" />
      <ListSkeleton count={4} />
    </div>
  );
}
