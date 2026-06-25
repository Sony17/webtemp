"use client";

import Link from "next/link";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

type LucideIcon = React.ComponentType<{ className?: string }>;

export function CategoryChip({
  category,
  active,
  href,
}: {
  category: Category;
  active?: boolean;
  href?: string;
}) {
  const Icon = ((Icons as unknown as Record<string, LucideIcon>)[category.icon] ??
    Icons.Tag) as LucideIcon;

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-soft"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent/40"
      )}
    >
      <Icon className="h-4 w-4" />
      {category.name}
    </span>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}
