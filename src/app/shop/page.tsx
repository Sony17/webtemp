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
} from "lucide-react";
import { Card } from "@/components/shop/ui";
import { CategoryTile } from "@/components/shop/widgets";
import { RecentlyViewed } from "@/components/shop/RecentlyViewed";
import { Reveal } from "@/components/shop/motion";
import { CATEGORIES } from "@/lib/shop/categories";

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

export default function ShopHome() {
  const router = useRouter();
  const [q, setQ] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(`/shop/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-border px-6 py-10 sm:px-10 sm:py-14">
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
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search for rice, milk, vegetables…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Search
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
        </div>
      </section>

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
