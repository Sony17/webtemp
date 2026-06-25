/** Indian Rupee formatter — whole rupees by default. */
export function formatINR(amount: number, opts?: { decimals?: boolean }): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(amount);
}

/** "12 Jun 2026" */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** "12 Jun, 4:30 PM" */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Render a delivery ETA range in minutes as friendly text. */
export function formatEta(minMins: number, maxMins?: number): string {
  if (!maxMins || maxMins === minMins) {
    if (minMins >= 60) return `${Math.round(minMins / 60)} hr`;
    return `${minMins} min`;
  }
  return `${minMins}–${maxMins} min`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
