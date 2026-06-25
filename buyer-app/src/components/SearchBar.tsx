"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
  className?: string;
  /** Cycled animated placeholder suggestions (used when input is empty & unfocused). */
  suggestions?: string[];
  onSubmit?: (query: string) => void;
}

export function SearchBar({
  defaultValue = "",
  placeholder = "Search for products, brands and more",
  autoFocus,
  size = "md",
  className,
  suggestions,
  onSubmit,
}: SearchBarProps) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [value, setValue] = React.useState(defaultValue);
  const [focused, setFocused] = React.useState(false);
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    if (!suggestions?.length || reduce) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % suggestions.length), 2600);
    return () => clearInterval(t);
  }, [suggestions, reduce]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (onSubmit) return onSubmit(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  const showAnimatedHint = Boolean(suggestions?.length) && !value && !focused;

  return (
    <motion.form
      onSubmit={submit}
      initial={false}
      animate={reduce ? undefined : { scale: focused ? 1.01 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-full border bg-card px-4 shadow-soft transition-colors",
        focused ? "border-primary/60 shadow-soft-lg ring-2 ring-primary/15" : "border-border",
        size === "lg" ? "h-14" : "h-11",
        className
      )}
    >
      <Search
        className={cn(
          "h-5 w-5 shrink-0 transition-colors",
          focused ? "text-primary" : "text-muted-foreground"
        )}
      />

      <div className="relative h-full flex-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={showAnimatedHint ? "" : placeholder}
          autoFocus={autoFocus}
          aria-label="Search products"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {showAnimatedHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center text-sm text-muted-foreground">
            <span className="mr-1">Search</span>
            <span className="text-primary">&ldquo;</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={idx}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="font-medium text-foreground/80"
              >
                {suggestions![idx]}
              </motion.span>
            </AnimatePresence>
            <span className="text-primary">&rdquo;</span>
          </div>
        )}
      </div>

      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue("")}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        size === "lg" && (
          <button
            type="submit"
            aria-label="Search"
            className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft transition-transform active:scale-90"
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        )
      )}
    </motion.form>
  );
}
