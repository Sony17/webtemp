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

// ── Date / misc formatters (migrated from the prototype's lib/format) ───────

/** "12 Jun 2026" */
export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** "12 Jun, 4:30 PM" */
export function formatDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Render a delivery ETA range in minutes as friendly text. */
export function formatEta(minMins: number, maxMins?: number): string {
  if (!maxMins || maxMins === minMins) {
    if (minMins >= 60) return `${Math.round(minMins / 60)} hr`;
    return `${minMins} min`;
  }
  return `${minMins}–${maxMins} min`;
}

export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
