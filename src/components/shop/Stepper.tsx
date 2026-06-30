"use client";

// Step indicator — migrated from the prototype. Animated progress, optional
// click-back on completed steps. Rewired to @/lib/shop/cn.
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/shop/cn";

export function Stepper({
  steps,
  current,
  onStepClick,
}: {
  steps: string[];
  current: number;
  /** When provided, completed steps become clickable to navigate back. */
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const isLast = i === steps.length - 1;
        const clickable = Boolean(onStepClick) && done;

        const circle = (
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold transition-colors",
              done && "border-primary bg-primary text-primary-foreground",
              active && "border-primary text-primary",
              !done && !active && "border-border text-muted-foreground"
            )}
          >
            {done ? <Check className="h-4 w-4" /> : i + 1}
          </span>
        );

        return (
          <li
            key={label}
            className={cn("flex items-center", !isLast && "flex-1")}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick!(i)}
                className="group/step flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Go back to ${label}`}
              >
                {circle}
                <span className="hidden text-sm font-medium text-muted-foreground transition-colors group-hover/step:text-primary sm:block">
                  {label}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {circle}
                <span
                  className={cn(
                    "hidden text-sm font-medium sm:block",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
            )}
            {!isLast && (
              <span className="mx-2 h-0.5 flex-1 origin-left overflow-hidden rounded-full bg-border sm:mx-3">
                <motion.span
                  className="block h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ scaleX: done ? 1 : 0 }}
                  style={{ transformOrigin: "left" }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
