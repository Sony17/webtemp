"use client";

// Lightweight, dependency-free snap carousel — migrated from the prototype.
// Rewired to @/lib/shop/cn. Children become snap-aligned items; desktop gets
// hover arrow controls and edge fades.
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/shop/cn";

export function Carousel({
  children,
  className,
  itemClassName,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(true);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  function scrollBy(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.round(el.clientWidth * 0.8),
      behavior: "smooth",
    });
  }

  return (
    <div className={cn("group/carousel relative", className)}>
      <div
        ref={ref}
        aria-label={ariaLabel}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 scrollbar-none sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
        {React.Children.map(children, (child) => (
          <div className={cn("snap-start shrink-0", itemClassName)}>{child}</div>
        ))}
      </div>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 hidden w-12 bg-gradient-to-r from-background to-transparent transition-opacity sm:block",
          canLeft ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-gradient-to-l from-background to-transparent transition-opacity sm:block",
          canRight ? "opacity-100" : "opacity-0"
        )}
      />

      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-1)}
        className={cn(
          "absolute -left-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/90 shadow-soft-lg backdrop-blur-md transition-all hover:bg-background lg:grid",
          canLeft
            ? "opacity-0 group-hover/carousel:opacity-100"
            : "pointer-events-none opacity-0"
        )}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(1)}
        className={cn(
          "absolute -right-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/90 shadow-soft-lg backdrop-blur-md transition-all hover:bg-background lg:grid",
          canRight
            ? "opacity-0 group-hover/carousel:opacity-100"
            : "pointer-events-none opacity-0"
        )}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
