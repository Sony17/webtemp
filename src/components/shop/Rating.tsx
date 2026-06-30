// Read-only rating badge — migrated from the prototype. Adapted to emerald
// (the current theme has no --success token). Rewired to @/lib/shop/cn.
import { Star } from "lucide-react";
import { cn } from "@/lib/shop/cn";

export function Rating({
  value,
  count,
  className,
  size = "sm",
}: {
  value: number;
  count?: number;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        size === "sm" ? "text-xs" : "text-sm",
        className
      )}
    >
      <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        {value.toFixed(1)}
        <Star
          className={cn(
            size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
            "fill-current"
          )}
        />
      </span>
      {count != null ? (
        <span className="text-muted-foreground">
          ({count.toLocaleString("en-IN")})
        </span>
      ) : null}
    </span>
  );
}
