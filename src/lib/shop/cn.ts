import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn-style className combiner used across the buyer app.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Minimal INR formatter — buyer app prices are rupee amounts (numbers or
// ONDC string values). Falls back gracefully on bad input.
export function formatINR(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}
