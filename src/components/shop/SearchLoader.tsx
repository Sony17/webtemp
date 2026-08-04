"use client";

// Buyer-app SEARCH LOADER — a "network discovery" animation shown while an ONDC
// `search` is in flight. ONDC discovery is genuinely slow: the request is
// broadcast to the gateway and sellers stream their catalogs back over a ~30s
// window (there is no single "done"). This loader makes that wait legible — a
// radar sweep reaching across the network, seller pins popping in as they
// "respond", and a rotating status caption — with the skeleton grid forming
// below so the page structure is already visible. Reduced-motion safe.
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Store, ShoppingBasket, MapPin, Tag, Truck } from "lucide-react";
import { EASE } from "@/components/shop/motion";
import { ProductGridSkeleton } from "@/components/shop/Skeletons";

const CAPTIONS = [
  "Reaching sellers across the network…",
  "Comparing catalogs & prices…",
  "Gathering the freshest offers…",
  "Lining up the best results…",
];

// Seller pins arranged on an orbit around the hub. Distinct icons + radii keep
// the ring from reading as a mechanical circle; each pops in on its own beat to
// suggest sellers answering independently over time.
const PINS = [
  { icon: Store, angle: -108, radius: 70 },
  { icon: ShoppingBasket, angle: -40, radius: 78 },
  { icon: Tag, angle: 34, radius: 68 },
  { icon: Truck, angle: 104, radius: 80 },
  { icon: MapPin, angle: 168, radius: 72 },
];

export function SearchLoader() {
  const reduce = useReducedMotion();
  const [caption, setCaption] = React.useState(0);

  // Rotate the status line so a long wait doesn't feel frozen.
  React.useEffect(() => {
    const id = setInterval(
      () => setCaption((c) => (c + 1) % CAPTIONS.length),
      2200
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent/50 via-card to-card px-6 py-8">
        <div className="absolute -right-16 -top-20 -z-0 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Radar: expanding rings + orbiting seller pins around a hub. */}
          <div className="relative h-44 w-44">
            {!reduce &&
              [0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30"
                  initial={{ scale: 0.35, opacity: 0.55 }}
                  animate={{ scale: 1.05, opacity: 0 }}
                  transition={{
                    duration: 2.4,
                    delay: i * 0.8,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
              ))}

            {/* Seller pins on the orbit */}
            {PINS.map((pin, i) => {
              const rad = (pin.angle * Math.PI) / 180;
              const x = Math.cos(rad) * pin.radius;
              const y = Math.sin(rad) * pin.radius;
              const Icon = pin.icon;
              return (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 grid h-9 w-9 place-items-center rounded-full border border-border bg-background text-primary shadow-soft"
                  style={{ marginLeft: x - 18, marginTop: y - 18 }}
                  initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0 }}
                  animate={
                    reduce
                      ? { opacity: 1 }
                      : { opacity: [0, 1, 1, 0.65], scale: [0, 1.18, 1, 1] }
                  }
                  transition={{
                    duration: 2.4,
                    delay: i * 0.28,
                    repeat: Infinity,
                    repeatDelay: 1.4,
                    ease: EASE,
                  }}
                >
                  <Icon className="h-4 w-4" />
                </motion.span>
              );
            })}

            {/* Hub — the buyer, reaching out */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              {!reduce && (
                <motion.span
                  className="absolute inset-0 -z-0 rounded-2xl bg-primary/25"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-soft-lg">
                <ShoppingBasket className="h-6 w-6" />
              </span>
            </div>
          </div>

          {/* Rotating status caption */}
          <div className="mt-5 flex h-5 items-center justify-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <AnimatePresence mode="wait">
              <motion.p
                key={caption}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="text-sm font-medium text-muted-foreground"
              >
                {CAPTIONS[caption]}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Sellers answer at their own pace — results appear as they arrive.
          </p>
        </div>
      </div>

      {/* Content placeholders forming beneath the radar */}
      <ProductGridSkeleton shimmer />
    </div>
  );
}
