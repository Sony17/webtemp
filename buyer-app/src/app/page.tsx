import Link from "next/link";
import Image from "next/image";
import { TrendingUp, Sparkles, ArrowRight, Search, Flame, Store, Truck, ShieldCheck, Tag } from "lucide-react";
import { PageContainer, SectionHeader } from "@/components/layout/PageContainer";
import { SearchBar } from "@/components/SearchBar";
import { CategoryChip } from "@/components/CategoryChip";
import { ProductCard } from "@/components/ProductCard";
import { DealCard } from "@/components/DealCard";
import { Carousel } from "@/components/Carousel";
import { SellerSpotlightCard } from "@/components/SellerSpotlightCard";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import { Reveal } from "@/components/motion/Motion";
import { Badge } from "@/components/ui/badge";
import {
  getCategories,
  getFeaturedCategories,
  getTrendingProducts,
} from "@/services/catalog";
import { products } from "@/mock/products";
import { featuredSellers, popularSearches } from "@/mock/sellers";

export default async function HomePage() {
  const [categories, featured, trending] = await Promise.all([
    getCategories(),
    getFeaturedCategories(),
    getTrendingProducts(),
  ]);

  // Deals derived from existing catalog (highest discount first) — UI-only, no service change.
  const deals = [...products]
    .filter((p) => p.mrp && p.mrp > p.startingPrice)
    .sort(
      (a, b) =>
        (b.mrp! - b.startingPrice) / b.mrp! - (a.mrp! - a.startingPrice) / a.mrp!
    )
    .slice(0, 8);

  return (
    <PageContainer className="space-y-12">
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-border px-6 py-10 sm:px-12 sm:py-16">
        {/* Gradient backdrop */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/70 via-card to-card dark:from-primary/10 dark:via-card dark:to-card" />
        <div className="absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 -z-10 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

        <Reveal className="max-w-2xl">
          <Badge variant="accent" className="mb-5 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5" /> Powered by the ONDC network
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Everything you need,
            <br />
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
              from sellers near you.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            One app, thousands of sellers. Compare prices and delivery across the open network —
            minimal, premium, fast.
          </p>

          <div className="mt-7 max-w-xl">
            <SearchBar size="lg" suggestions={popularSearches} />
          </div>

          {/* Popular searches */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-primary" /> Popular:
            </span>
            {popularSearches.slice(0, 6).map((q) => (
              <Link
                key={q}
                href={`/search?q=${encodeURIComponent(q)}`}
                className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium backdrop-blur-md transition-colors hover:border-primary/40 hover:text-primary"
              >
                {q}
              </Link>
            ))}
          </div>

          {/* Trust stats */}
          <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3">
            {[
              { icon: Store, label: "10,000+ sellers" },
              { icon: Truck, label: "Fast network delivery" },
              { icon: ShieldCheck, label: "Secure ONDC checkout" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" /> {label}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ───── Category chips ───── */}
      <section>
        <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
          {categories.map((c) => (
            <CategoryChip key={c.id} category={c} href={`/search?category=${c.id}`} />
          ))}
        </div>
      </section>

      {/* ───── Featured categories carousel ───── */}
      <Reveal as="section">
        <SectionHeader title="Shop by category" subtitle="Curated collections across the network" />
        <Carousel ariaLabel="Featured categories" itemClassName="w-[150px] sm:w-[200px]">
          {featured.map((c) => (
            <Link
              key={c.id}
              href={`/search?category=${c.id}`}
              className="group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl border border-border shadow-soft transition-shadow hover:shadow-soft-lg"
            >
              {c.image && (
                <Image
                  src={c.image}
                  alt={c.name}
                  fill
                  sizes="200px"
                  loading="lazy"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
              <span className="absolute bottom-3 left-3 right-3 text-sm font-semibold text-white">
                {c.name}
              </span>
            </Link>
          ))}
        </Carousel>
      </Reveal>

      {/* ───── Deals (distinct warm treatment) ───── */}
      <Reveal as="section">
        <div className="overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-50 via-card to-card p-5 sm:p-6 dark:from-amber-500/10">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500 text-white shadow-soft">
                <Flame className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Deals of the day</h2>
                <p className="text-sm text-muted-foreground">Biggest savings across sellers, today only</p>
              </div>
            </div>
            <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500">
              <Tag className="h-3.5 w-3.5" /> Up to 75% off
            </Badge>
          </div>
          <Carousel ariaLabel="Deals of the day" itemClassName="w-[150px] sm:w-[190px]">
            {deals.map((p, i) => (
              <DealCard key={p.id} product={p} index={i} />
            ))}
          </Carousel>
        </div>
      </Reveal>

      {/* ───── Recently viewed (client, conditional) ───── */}
      <RecentlyViewed />

      {/* ───── Trending ───── */}
      <Reveal as="section">
        <SectionHeader
          title="Trending now"
          subtitle="What people near you are buying"
          action={
            <Link href="/search" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />
        <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-primary" /> Updated for your location
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {trending.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      </Reveal>

      {/* ───── Recommended sellers ───── */}
      <Reveal as="section">
        <SectionHeader title="Recommended sellers" subtitle="Top-rated shops on the network near you" />
        <Carousel ariaLabel="Recommended sellers">
          {featuredSellers.map((s) => (
            <SellerSpotlightCard key={s.id} seller={s} />
          ))}
        </Carousel>
      </Reveal>

      {/* ───── Closing CTA ───── */}
      <Reveal as="section">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-6 py-10 text-center text-background sm:px-12">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Can&apos;t find it? Just search the network.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-balance text-sm text-background/70">
            OpenIdea connects you to sellers across India through ONDC — one search, every shop.
          </p>
          <Link
            href="/search"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-semibold text-foreground transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Search className="h-4 w-4" /> Start searching
          </Link>
        </div>
      </Reveal>
    </PageContainer>
  );
}
