"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Clock, Star, ArrowUpRight } from "lucide-react";
import type { FeaturedSeller } from "@/mock/sellers";

export function SellerSpotlightCard({ seller }: { seller: FeaturedSeller }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      <Link
        href={`/search?q=${encodeURIComponent(seller.category)}`}
        className="group relative block w-[260px] overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-shadow hover:shadow-soft-lg"
      >
        <div className="relative h-28 overflow-hidden">
          <Image
            src={seller.cover}
            alt=""
            fill
            sizes="260px"
            loading="lazy"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <span className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>

        <div className="relative px-4 pb-4">
          <div className="relative -mt-7 mb-2 h-14 w-14 overflow-hidden rounded-xl border-2 border-background bg-muted shadow-soft">
            <Image src={seller.logo} alt={seller.name} fill sizes="56px" className="object-cover" />
          </div>
          <h3 className="text-sm font-semibold">{seller.name}</h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">{seller.tagline}</p>
          <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-success/12 px-1.5 py-0.5 font-medium text-success">
              {seller.rating.toFixed(1)} <Star className="h-3 w-3 fill-current" />
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {seller.etaText}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
