"use client";

// Buyer-app HOME — a grocery-web landing (Blinkit/Zepto/Zomato style on the
// web): a gradient hero with a prominent search + popular-search chips, a
// responsive SVG category grid, a recently-viewed rail, and a trust strip.
// Discovery is async on ONDC, so tapping search/category routes to the
// /shop/search screen which fires the ONDC search and renders incoming catalogs.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Sparkles,
  ShieldCheck,
  Truck,
  BadgeIndianRupee,
  ArrowRight,
  Store,
  Clock,
} from "lucide-react";
import { Card } from "@/components/shop/ui";
import { CategoryTile } from "@/components/shop/widgets";
import { RecentlyViewed } from "@/components/shop/RecentlyViewed";
import { Carousel } from "@/components/shop/Carousel";
import { Reveal } from "@/components/shop/motion";
import { CATEGORIES } from "@/lib/shop/categories";
import { cn } from "@/lib/shop/cn";

const POPULAR = [
  "Milk",
  "Bread",
  "Eggs",
  "Rice",
  "Bananas",
  "Onions",
  "Atta",
  "Curd",
];

// Promotional banners (Blinkit/Zepto-style). Real photos on the Unsplash CDN
// with a brand-gradient fallback if an image fails to load.
const PROMOS = [
  {
    title: "Fresh fruits & vegetables",
    sub: "Handpicked, farm-fresh every day",
    query: "vegetables",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=70&auto=format&fit=crop",
    gradient: "from-emerald-950/80 via-emerald-900/40",
  },
  {
    title: "Your monthly grocery run",
    sub: "Staples, snacks & essentials — delivered",
    query: "rice",
    image:
      "https://images.unsplash.com/photo-1607349913338-fca6f7fc42d0?w=800&q=70&auto=format&fit=crop",
    gradient: "from-blue-950/80 via-blue-900/40",
  },
  {
    title: "Dairy & bakery daily",
    sub: "Milk, bread, eggs & butter",
    query: "milk",
    image:
      "https://images.unsplash.com/photo-1543168256-418811576931?w=800&q=70&auto=format&fit=crop",
    gradient: "from-amber-950/80 via-amber-900/40",
  },
];

function PromoBanner({
  promo,
}: {
  promo: (typeof PROMOS)[number];
}) {
  const [failed, setFailed] = React.useState(false);
  return (
    <Link
      href={`/shop/search?q=${encodeURIComponent(promo.query)}`}
      className="group relative block aspect-[16/9] overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary to-blue-600 shadow-soft sm:aspect-[21/9]"
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={promo.image}
          alt={promo.title}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : null}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r to-transparent",
          promo.gradient
        )}
      />
      <div className="absolute inset-0 flex flex-col justify-center gap-1 p-5 sm:p-7">
        <h3 className="max-w-[70%] text-lg font-semibold leading-tight text-white sm:text-2xl">
          {promo.title}
        </h3>
        <p className="max-w-[70%] text-xs text-white/80 sm:text-sm">
          {promo.sub}
        </p>
        <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-primary">
          Shop now
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

export default function ShopHome() {
  const router = useRouter();
  const [q, setQ] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(`/shop/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  return (
    <div className="space-y-6 md:space-y-10">
      {/* Hero — desktop only. On mobile the app bar already carries the
          location + search, so the home leads straight into promos + categories
          (dense, utility-first, like Blinkit/Zepto). */}
      <section className="relative hidden overflow-hidden rounded-[1.75rem] border border-border px-6 py-10 sm:px-10 sm:py-14 md:block">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/70 via-card to-card" />
        <div className="absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 -z-10 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="mx-auto max-w-3xl text-center">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Powered by the ONDC network
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Groceries & essentials from{" "}
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
              local sellers
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            One open marketplace, many sellers. Compare prices, pick the best
            offer, and get it delivered — all on India&apos;s open commerce
            network.
          </p>

          <form onSubmit={submit} className="mx-auto mt-7 max-w-xl">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background py-1.5 pl-4 pr-1.5 shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search for rice, milk, vegetables…"
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground">Popular:</span>
            {POPULAR.map((term) => (
              <Link
                key={term}
                href={`/shop/search?q=${encodeURIComponent(term)}`}
                className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium backdrop-blur-md transition-colors hover:border-primary/40 hover:text-primary"
              >
                {term}
              </Link>
            ))}
          </div>

          {/* Reassurance micro-row — quick, honest trust signals right under the
              fold (icons only, no emoji per the buyer-app rule). */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Delivered by local stores
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5 text-primary" />
              Compare across sellers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Secure ONDC payments
            </span>
          </div>
        </div>
      </section>

      {/* Promotional banners */}
      <Reveal as="section">
        <Carousel
          ariaLabel="Offers and collections"
          itemClassName="w-[86%] sm:w-[540px]"
        >
          {PROMOS.map((p) => (
            <PromoBanner key={p.title} promo={p} />
          ))}
        </Carousel>
      </Reveal>

      {/* Categories */}
      <Reveal as="section">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Shop by category
          </h2>
          <Link
            href="/shop/search"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {CATEGORIES.map((c) => (
            <CategoryTile key={c.id} category={c} />
          ))}
        </div>
      </Reveal>

      {/* Browse stores — nearest-first seller directory */}
      <Reveal as="section" delay={0.05}>
        <Link
          href="/shop/sellers"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/30"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Browse stores near you</p>
            <p className="truncate text-xs text-muted-foreground">
              Every seller on the network, sorted by distance
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </Reveal>

      {/* Recently viewed */}
      <RecentlyViewed />

      {/* Trust strip */}
      <Reveal as="section" delay={0.05}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: BadgeIndianRupee,
              title: "Best prices",
              sub: "Compare offers across sellers",
            },
            {
              icon: Truck,
              title: "Fast delivery",
              sub: "Fulfilled by local stores",
            },
            {
              icon: ShieldCheck,
              title: "ONDC secure",
              sub: "Open, verified network",
            },
          ].map((f) => (
            <Card key={f.title} className="flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/60 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="truncate text-xs text-muted-foreground">{f.sub}</p>
              </div>
            </Card>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
