"use client";

import { Star, ThumbsUp, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/** UI-only customer reviews block. Reviews are illustrative mock content. */
const SAMPLE_REVIEWS = [
  { name: "Priya M.", rating: 5, date: "2 days ago", text: "Exactly as described and delivered super fast. Will order again!", helpful: 24, verified: true },
  { name: "Rahul K.", rating: 4, date: "1 week ago", text: "Good quality for the price. Packaging could be a little better.", helpful: 11, verified: true },
  { name: "Ananya S.", rating: 5, date: "2 weeks ago", text: "Loved it. The seller was responsive and the ETA was accurate.", helpful: 8, verified: false },
];

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="h-full rounded-full bg-primary"
      />
    </div>
  );
}

export function Reviews({ product }: { product: Product }) {
  const dist = [72, 18, 6, 3, 1]; // 5★ → 1★ distribution (illustrative)

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Ratings & reviews</h2>
      <div className="grid gap-6 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-[200px_1fr]">
        {/* Summary */}
        <div className="flex flex-col items-center justify-center gap-1 border-border sm:border-r sm:pr-5">
          <span className="text-4xl font-semibold tracking-tight">{product.rating.toFixed(1)}</span>
          <div className="flex">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  "h-4 w-4",
                  i < Math.round(product.rating) ? "fill-amber-400 text-amber-400" : "text-muted"
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {product.ratingCount.toLocaleString("en-IN")} ratings
          </span>
        </div>

        {/* Distribution */}
        <div className="space-y-2">
          {dist.map((pct, i) => (
            <div key={i} className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex w-6 items-center gap-0.5">
                {5 - i}
                <Star className="h-3 w-3 fill-current" />
              </span>
              <Bar pct={pct} />
              <span className="w-8 text-right tabular-nums">{pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Review list */}
      <div className="mt-4 space-y-3">
        {SAMPLE_REVIEWS.map((r, i) => (
          <motion.div
            key={r.name}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="rounded-xl border border-border bg-card p-4 shadow-soft"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-semibold">
                  {r.name.charAt(0)}
                </span>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {r.name}
                    {r.verified && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-success">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.date}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-0.5 rounded-md bg-success/12 px-1.5 py-0.5 text-xs font-medium text-success">
                {r.rating}.0 <Star className="h-3 w-3 fill-current" />
              </span>
            </div>
            <p className="mt-2.5 text-sm text-muted-foreground">{r.text}</p>
            <button className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary">
              <ThumbsUp className="h-3.5 w-3.5" /> Helpful ({r.helpful})
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
