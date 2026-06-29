"use client";

// Buyer-app HOME — recovered from the approved buyer-app design: a gradient hero
// with blurred orbs and gradient headline, a search entry, and grocery category
// tiles. Discovery is async on ONDC, so tapping search/category routes to the
// /shop/search screen which fires the ONDC search and renders incoming catalogs.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Sparkles, ShieldCheck, Truck, BadgeIndianRupee } from "lucide-react";
import { Card } from "@/components/shop/ui";
import { RecentlyViewed } from "@/components/shop/RecentlyViewed";
import { CATEGORIES } from "@/lib/shop/categories";

export default function ShopHome() {
  const router = useRouter();
  const [q, setQ] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(`/shop/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-border px-6 py-10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/70 via-card to-card" />
        <div className="absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 -z-10 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="max-w-2xl">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Powered by the ONDC network
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Shop fresh from{" "}
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
              local sellers
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            One open marketplace, many sellers. Compare prices, pick the best
            offer, and get it delivered — all on India&apos;s open commerce
            network.
          </p>

          <form onSubmit={submit} className="mt-7 max-w-xl">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search for rice, milk, vegetables…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Search
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Categories */}
      <section>
        <h2 className="mb-3 text-base font-semibold tracking-tight">
          Shop by category
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/shop/search?q=${encodeURIComponent(c.query)}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 text-center transition-colors hover:bg-accent"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-accent/60 text-xl">
                {c.emoji}
              </span>
              <span className="text-[11px] font-medium leading-tight">
                {c.label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recently viewed */}
      <RecentlyViewed />

      {/* Trust strip */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { icon: BadgeIndianRupee, title: "Best price", sub: "Compare sellers" },
          { icon: Truck, title: "Fast delivery", sub: "Local fulfilment" },
          { icon: ShieldCheck, title: "ONDC secure", sub: "Open & verified" },
        ].map((f) => (
          <Card key={f.title} className="p-4 text-center">
            <f.icon className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-xs font-semibold">{f.title}</p>
            <p className="text-[11px] text-muted-foreground">{f.sub}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
