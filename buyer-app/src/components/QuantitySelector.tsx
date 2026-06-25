"use client";

import { Minus, Plus } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface QuantitySelectorProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}

export function QuantitySelector({
  value,
  onChange,
  min = 0,
  max = 99,
  size = "md",
  className,
}: QuantitySelectorProps) {
  const reduce = useReducedMotion();
  const dim = size === "sm" ? "h-8" : "h-10";
  const btn = size === "sm" ? "w-8" : "w-10";

  return (
    <div
      className={cn(
        "inline-flex select-none items-center rounded-lg border border-primary/30 bg-primary/5 font-semibold text-primary",
        dim,
        className
      )}
    >
      <motion.button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        whileTap={reduce ? undefined : { scale: 0.85 }}
        className={cn(
          "grid place-items-center rounded-l-lg transition-colors hover:bg-primary/15 disabled:opacity-40",
          dim,
          btn
        )}
      >
        <Minus className="h-4 w-4" />
      </motion.button>

      <span className="relative grid min-w-7 place-items-center overflow-hidden text-center text-sm tabular-nums">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={reduce ? { opacity: 0 } : { y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: -10, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>

      <motion.button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        whileTap={reduce ? undefined : { scale: 0.85 }}
        className={cn(
          "grid place-items-center rounded-r-lg transition-colors hover:bg-primary/15 disabled:opacity-40",
          dim,
          btn
        )}
      >
        <Plus className="h-4 w-4" />
      </motion.button>
    </div>
  );
}
