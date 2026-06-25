import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
        <ShoppingBag className="h-5 w-5" />
      </span>
      {!compact && (
        <span className="text-lg font-semibold tracking-tight">
          Open<span className="text-primary">Idea</span>
        </span>
      )}
    </Link>
  );
}
