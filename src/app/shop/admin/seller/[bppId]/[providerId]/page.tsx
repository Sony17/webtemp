"use client";

// ONDC Admin — SELLER DETAIL. A drill-down from the admin Sellers tab: one
// provider's aggregated identity, location, network ids, and full catalog folded
// from every stored on_search slice (GET /api/shop/admin/sellers/{bppId}/{providerId}).
// Rendered full-bleed in the admin's dark theme (Chrome skips the buyer shell for
// /shop/admin/*) and guarded client-side by the same admin flag as the dashboard.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// The auth-guard + data-load effects legitimately setState from an external
// system (localStorage flag + the detail endpoint) — the documented exception.
/* eslint-disable react-hooks/set-state-in-effect */

type Seller = {
  bppId: string;
  bppUri: string;
  providerId: string;
  name: string;
  image?: string;
  shortDesc?: string;
  rating?: number;
  locality?: string;
  city?: string;
  areaCode?: string;
  gps?: string;
};
type Item = {
  itemId: string;
  name: string;
  description?: string;
  image?: string;
  categoryId?: string;
  price: number;
  maxPrice?: number;
  currency?: string;
  unit?: string;
  available?: boolean;
};
type Detail = {
  seller: Seller;
  items: Item[];
  transactions: string[];
  itemCount: number;
};

function inr(n?: number, currency = "INR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${n.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminSellerDetailPage() {
  const params = useParams<{ bppId: string; providerId: string }>();
  const router = useRouter();
  const bppId = decodeURIComponent(params.bppId);
  const providerId = decodeURIComponent(params.providerId);

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ok = false;
    try {
      ok = localStorage.getItem("oi_admin") === "1";
    } catch {
      /* ignore */
    }
    if (!ok) {
      router.replace(
        `/admin/login?next=/shop/admin/seller/${encodeURIComponent(
          bppId
        )}/${encodeURIComponent(providerId)}`
      );
      return;
    }
    setAuthed(true);
  }, [router, bppId, providerId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shop/admin/sellers/${encodeURIComponent(
          bppId
        )}/${encodeURIComponent(providerId)}`,
        { cache: "no-store" }
      );
      const d = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load seller.");
    } finally {
      setLoading(false);
    }
  }, [bppId, providerId]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  // Group the catalog by category for a storefront-style detail layout.
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of detail?.items ?? []) {
      const k = it.categoryId ?? "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return [...m.entries()];
  }, [detail]);

  if (authed === null) return <main className="min-h-screen bg-zinc-950" />;

  const s = detail?.seller;
  const place = s
    ? [s.locality, s.city, s.areaCode].filter(Boolean).join(" · ")
    : "";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <button
            onClick={() => router.back()}
            className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            ← Back
          </button>
          <Link
            href="/shop/admin"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ONDC Admin
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        {!detail && loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : null}

        {s ? (
          <>
            {/* Identity header */}
            <div className="flex items-start gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <SellerAvatar name={s.name} image={s.image} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold leading-tight">{s.name}</h1>
                {s.shortDesc ? (
                  <p className="mt-1 text-sm text-zinc-400">{s.shortDesc}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                  {s.rating != null ? (
                    <span className="text-amber-300">★ {s.rating.toFixed(1)}</span>
                  ) : null}
                  {place ? <span>{place}</span> : null}
                </div>
              </div>
            </div>

            {/* Roll-up stats */}
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Catalog items" value={detail.itemCount} />
              <Stat label="Searches seen in" value={detail.transactions.length} />
              <Stat
                label="Location"
                value={s.gps ? "Geocoded" : "—"}
                sub={s.gps ?? s.areaCode}
              />
            </div>

            {/* Network identifiers */}
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-200">
                Network identity
              </h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <IdRow label="BPP id" value={s.bppId} />
                <IdRow label="Provider id" value={s.providerId} />
                <IdRow label="BPP URI" value={s.bppUri} wide />
                <IdRow label="GPS" value={s.gps ?? "—"} />
                <IdRow label="Area code" value={s.areaCode ?? "—"} />
              </dl>
            </div>

            {/* Catalog */}
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold text-zinc-200">
                Catalog ({detail.itemCount})
              </h2>
              {detail.itemCount === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
                  No items in the stored catalog for this seller.
                </p>
              ) : (
                <div className="space-y-6">
                  {groups.map(([cat, list]) => (
                    <section key={cat}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        {cat}
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((it) => (
                          <div
                            key={it.itemId}
                            className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <ItemThumb name={it.name} image={it.image} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-100">
                                {it.name}
                              </p>
                              {it.unit ? (
                                <p className="text-[11px] text-zinc-500">
                                  {it.unit}
                                </p>
                              ) : null}
                              <p className="mt-1 text-sm font-semibold text-zinc-200">
                                {inr(it.price, it.currency)}
                                {it.maxPrice && it.maxPrice > it.price ? (
                                  <span className="ml-1.5 text-xs font-normal text-zinc-500 line-through">
                                    {inr(it.maxPrice, it.currency)}
                                  </span>
                                ) : null}
                              </p>
                              {it.available === false ? (
                                <p className="mt-0.5 text-[11px] text-rose-400">
                                  Out of stock
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : !loading && !error ? (
          <p className="text-sm text-zinc-500">Seller not found.</p>
        ) : null}
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub ? (
        <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function IdRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-zinc-300">
        {value}
      </dd>
    </div>
  );
}

// Seller logo with a graceful fallback to the name's initial (native <img> +
// onError — ONDC images come from arbitrary seller hosts; no emoji fallback).
function SellerAvatar({ name, image }: { name: string; image?: string }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        onError={() => setFailed(true)}
        loading="lazy"
        decoding="async"
        className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-zinc-700"
      />
    );
  }
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-xl font-semibold text-zinc-300 ring-1 ring-zinc-700">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// Small catalog-item thumbnail with the same fallback treatment.
function ItemThumb({ name, image }: { name: string; image?: string }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        onError={() => setFailed(true)}
        loading="lazy"
        decoding="async"
        className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-zinc-800"
      />
    );
  }
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-sm font-semibold text-zinc-400 ring-1 ring-zinc-800">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
