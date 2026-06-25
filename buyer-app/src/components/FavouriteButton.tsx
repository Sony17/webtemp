"use client";

import { Heart } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useIsFavourite, toggleFavourite } from "@/hooks/use-favourites";
import { cn } from "@/lib/utils";

export function FavouriteButton({
  productId,
  className,
  size = "md",
}: {
  productId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const fav = useIsFavourite(productId);
  const reduce = useReducedMotion();
  const dim = size === "sm" ? "h-8 w-8" : "h-9 w-9";

  return (
    <motion.button
      type="button"
      aria-label={fav ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={fav}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavourite(productId);
      }}
      whileTap={reduce ? undefined : { scale: 0.8 }}
      className={cn(
        "grid place-items-center rounded-full border border-border/60 bg-background/70 text-muted-foreground shadow-soft backdrop-blur-md transition-colors hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dim,
        className
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={fav ? "on" : "off"}
          initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
        >
          <Heart
            className={cn(size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]", fav && "fill-rose-500 text-rose-500")}
          />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
