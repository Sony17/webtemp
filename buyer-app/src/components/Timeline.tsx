"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderTimelineStep } from "@/types";

export function Timeline({ steps }: { steps: OrderTimelineStep[] }) {
  const reduce = useReducedMotion();
  // The last step with a timestamp is the current/active one.
  const lastDoneIndex = steps.reduce((acc, s, i) => (s.timestamp ? i : acc), -1);
  const isCancelled = steps.some((s) => s.status === "cancelled" && s.timestamp);

  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const done = Boolean(step.timestamp);
        const isCurrent = i === lastDoneIndex && !isCancelled;
        const isLast = i === steps.length - 1;
        const cancelledNode = step.status === "cancelled";

        return (
          <motion.li
            key={`${step.status}-${i}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            className="flex gap-4 pb-6 last:pb-0"
          >
            <div className="relative flex flex-col items-center">
              <span
                className={cn(
                  "z-10 grid h-7 w-7 place-items-center rounded-full border-2 transition-colors",
                  cancelledNode && done
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground",
                  isCurrent && "ring-4 ring-primary/15"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current" />}
              </span>
              {!isLast && (
                <span
                  className={cn(
                    "absolute top-7 h-[calc(100%-1.75rem)] w-0.5",
                    done && steps[i + 1]?.timestamp ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>

            <div className={cn("flex-1 pt-0.5", !done && "opacity-60")}>
              <p className={cn("text-sm font-medium", isCurrent && "text-primary")}>{step.label}</p>
              {step.description && (
                <p className="text-xs text-muted-foreground">{step.description}</p>
              )}
              {step.timestamp && (
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(step.timestamp)}</p>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
