"use client";

// ONDC Admin dashboard — overview + orders + payments (reconcile) + IGM + registry.
// Rendered full-bleed (Chrome skips the buyer header/nav for /shop/admin) and
// guarded client-side by the same admin flag as the other admin pages
// (localStorage "oi_admin"; admin/admin login). Demo-grade auth — the data APIs
// are ungated server-side; harden before production.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sortSellersByDistance, formatDistance } from "@/lib/shop/types";
import { detectCurrentLocation } from "@/lib/shop/geolocate";

// This admin page synchronizes with external systems (the admin flag in
// localStorage + the dashboard data endpoints), so the auth-guard and data-load
// effects legitimately setState — the documented exception to the rule.
/* eslint-disable react-hooks/set-state-in-effect */

type Counts = {
  transactions: number;
  orders: number;
  payments: { pending: number; paid: number; total: number };
  issues: { total: number; open: number };
};
type OrderRow = {
  transactionId: string;
  bppId: string;
  orderId: string | null;
  stage: string;
  state: string;
  amount: number | null;
  updatedAt: number;
};
type IssueRow = {
  issueId: string;
  transactionId: string;
  bppId: string;
  orderId: string | null;
  category: string | null;
  status: string;
  updatedAt: number;
};
type Summary = { counts: Counts; orders: OrderRow[]; issues: IssueRow[] };
// One deduped seller (ONDC provider), as returned by GET /api/shop/admin/sellers.
// Mirrors the Seller shape (src/lib/shop/types.ts) — folded from every stored
// on_search catalog slice into one row per unique (bppId, providerId).
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
  gps?: string; // "lat,long" of the seller's first location — drives distance sort
  panIndia?: boolean; // ships country-wide per catalog serviceability
  serviceRadiusKm?: number; // declared delivery radius
  itemCount: number; // items across catalog slices (0 = empty storefront)
};
// One seller's order-rejection roll-up, as returned by GET
// /api/shop/admin/seller-nacks — how often it NACKed select/init/confirm and the
// most recent error. The signal behind a checkout dead-end.
type SellerNack = {
  bppId: string;
  providerId?: string;
  name?: string;
  total: number;
  byAction: Record<string, number>;
  lastAt: string;
  lastAction: string;
  lastCode?: string;
  lastMessage?: string;
};
type Payment = {
  transactionId: string;
  orderId?: string;
  amount?: number;
  paymentReference: string;
  status: "PENDING" | "PAID";
  bankReference?: string;
  createdAt: number;
};

// One tracked Tocxi shipment, as returned by GET /api/logistics/shipments. Mirrors
// the ShipmentRecord shape (src/lib/logistics/store-json.ts) — only the fields the
// console renders are typed here.
type ShipmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";
type Shipment = {
  partnerReference: string;
  shipmentId: string;
  transactionId?: string;
  status: ShipmentStatus;
  trackingUrl?: string;
  awbNo?: string;
  estimatedPrice?: number;
  cod: boolean;
  codAmount?: number;
  createdAt: number;
};

type Tab =
  | "overview"
  | "orders"
  | "sellers"
  | "health"
  | "payments"
  | "logistics"
  | "issues"
  | "registry";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "sellers", label: "Sellers" },
  { id: "health", label: "Seller health" },
  { id: "payments", label: "Payments" },
  { id: "logistics", label: "Logistics" },
  { id: "issues", label: "Issues" },
  { id: "registry", label: "Registry" },
];

// A shipment is cancellable only before pickup — PENDING or CONFIRMED. Past that,
// Tocxi refuses (the cancel route returns 409), so we hide the button.
const CANCELLABLE: ReadonlySet<ShipmentStatus> = new Set([
  "PENDING",
  "CONFIRMED",
]);
// Map a shipment status to a Badge tone: delivered = good, terminal exception =
// bad, everything in-flight = neutral.
function shipmentTone(s: ShipmentStatus): "zinc" | "emerald" | "amber" | "rose" {
  if (s === "DELIVERED") return "emerald";
  if (s === "CANCELLED" || s === "FAILED") return "rose";
  return "amber";
}

function inr(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function when(ms: number): string {
  try {
    return new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}
const short = (s: string, n = 10) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Human place label for a seller — locality · city · pincode, whichever are set.
function sellerPlace(s: Seller): string | undefined {
  const parts = [s.locality, s.city, s.areaCode].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : undefined;
}

export default function OndcAdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [registry, setRegistry] = useState<unknown>(null);
  const [sellers, setSellers] = useState<Seller[] | null>(null);
  const [nacks, setNacks] = useState<SellerNack[] | null>(null);
  // Reference point for the Sellers tab's distance sort. Empty → sort by name.
  const [nearGps, setNearGps] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  useEffect(() => {
    let ok = false;
    try {
      ok = localStorage.getItem("oi_admin") === "1";
    } catch {
      /* ignore */
    }
    if (!ok) {
      router.replace("/admin/login?next=/shop/admin");
      return;
    }
    setAuthed(true);
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, pRes, lRes] = await Promise.all([
        fetch("/api/shop/admin/summary", { cache: "no-store" }),
        fetch("/api/payments/list", { cache: "no-store" }),
        fetch("/api/logistics/shipments?limit=200", { cache: "no-store" }),
      ]);
      // Session cookie expired or absent: the data APIs are gated server-side
      // (requireAdmin), so a 401 here means re-login — the localStorage flag
      // alone grants nothing.
      if (sRes.status === 401) {
        try {
          localStorage.removeItem("oi_admin");
        } catch {
          // ignore storage errors
        }
        router.replace("/admin/login?next=/shop/admin");
        return;
      }
      const s = (await sRes.json()) as Summary & { error?: string };
      const p = (await pRes.json()) as { payments?: Payment[]; error?: string };
      const l = (await lRes.json()) as { shipments?: Shipment[]; error?: string };
      if (!sRes.ok) throw new Error(s.error ?? "Failed to load summary");
      setSummary(s);
      setPayments(p.payments ?? []);
      // Shipments are best-effort: a missing/unconfigured logistics store must
      // not blank the whole dashboard, so we tolerate its failure.
      setShipments(lRes.ok ? l.shipments ?? [] : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  useEffect(() => {
    if (authed && tab === "registry" && registry === null) {
      fetch("/api/ondc/registry-status", { cache: "no-store" })
        .then((r) => r.json())
        .then(setRegistry)
        .catch(() => setRegistry({ error: "Failed to load registry status." }));
    }
  }, [authed, tab, registry]);

  // Sellers are lazy-loaded on first open of the tab (like registry): the roll-up
  // scans every stored catalog slice, so we don't pull it on every dashboard load.
  useEffect(() => {
    if (authed && tab === "sellers" && sellers === null) {
      fetch("/api/shop/admin/sellers", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { sellers?: Seller[] }) => setSellers(d.sellers ?? []))
        .catch(() => setSellers([]));
    }
  }, [authed, tab, sellers]);

  // Seller-health (order rejections) lazy-loaded on first open of its tab.
  useEffect(() => {
    if (authed && tab === "health" && nacks === null) {
      fetch("/api/shop/admin/seller-nacks", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { sellers?: SellerNack[] }) => setNacks(d.sellers ?? []))
        .catch(() => setNacks([]));
    }
  }, [authed, tab, nacks]);

  // Sellers ordered by distance from the reference point (nearest first). With no
  // reference set, sortSellersByDistance falls back to a stable name sort.
  const sortedSellers = useMemo(
    () => (sellers ? sortSellersByDistance(sellers, nearGps.trim() || undefined) : null),
    [sellers, nearGps]
  );

  // Prefill the reference point from the browser's location (admin isn't a buyer,
  // so "distance from buyer" needs a point to measure from — this or a typed gps).
  const useMyLocation = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const loc = await detectCurrentLocation();
      setNearGps(loc.gps);
    } catch {
      setError("Couldn't get your location — enter a lat,long manually.");
    } finally {
      setLocating(false);
    }
  }, []);

  const markPaid = async (p: Payment) => {
    const bankReference =
      window.prompt(
        `Mark ${p.paymentReference} as PAID.\nOptional: bank/UPI reference (UTR):`,
        ""
      ) ?? undefined;
    setBusyRef(p.paymentReference);
    try {
      const res = await fetch("/api/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentReference: p.paymentReference,
          status: "PAID",
          bankReference: bankReference?.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Failed (${res.status})`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark paid.");
    } finally {
      setBusyRef(null);
    }
  };

  // Cancel a shipment before pickup (POST /api/logistics/shipments/{id}/cancel).
  // The route returns 409 if it's already been picked up — surface that message
  // rather than a generic failure.
  const cancelShipment = async (s: Shipment) => {
    const reason =
      window.prompt(
        `Cancel shipment ${s.shipmentId} (order ${s.partnerReference}).\nReason:`,
        "cancelled by merchant"
      ) ?? undefined;
    if (reason === undefined) return; // dismissed
    setBusyRef(s.shipmentId);
    try {
      const res = await fetch(
        `/api/logistics/shipments/${encodeURIComponent(s.shipmentId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() || undefined }),
        }
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Failed (${res.status})`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel shipment.");
    } finally {
      setBusyRef(null);
    }
  };

  const logout = () => {
    try {
      localStorage.removeItem("oi_admin");
    } catch {
      /* ignore */
    }
    // Clear the server-side session cookie too (best-effort; the redirect
    // must not wait on it).
    void fetch("/api/admin/login", { method: "DELETE" }).catch(() => {});
    router.replace("/admin/login");
  };

  if (authed === null) return <main className="min-h-screen bg-zinc-950" />;
  const c = summary?.counts;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="border-b border-zinc-800 bg-zinc-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">ONDC Admin</h1>
            <p className="text-xs text-zinc-500">openidea.co.in · RET10 · Buyer App</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="rounded-full bg-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={logout}
              className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Log out
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.id
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
              {t.id === "payments" && c?.payments.pending
                ? ` (${c.payments.pending})`
                : ""}
              {t.id === "issues" && c?.issues.open ? ` (${c.issues.open})` : ""}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        {/* OVERVIEW */}
        {tab === "overview" ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Transactions" value={c?.transactions ?? "—"} />
              <Stat label="Orders" value={c?.orders ?? "—"} />
              <Stat
                label="Payments"
                value={c ? `${c.payments.paid}/${c.payments.total}` : "—"}
                sub={c ? `${c.payments.pending} pending` : undefined}
                accent={c && c.payments.pending > 0 ? "amber" : "emerald"}
              />
              <Stat
                label="IGM issues"
                value={c?.issues.total ?? "—"}
                sub={c ? `${c.issues.open} open` : undefined}
                accent={c && c.issues.open > 0 ? "amber" : "emerald"}
              />
            </div>
            <TestEmailCard />
          </>
        ) : null}

        {/* ORDERS */}
        {tab === "orders" ? (
          <Table
            head={["Order", "Seller", "State", "Amount", "Updated"]}
            empty={summary && summary.orders.length === 0 ? "No orders yet." : null}
            rows={(summary?.orders ?? []).map((o) => [
              <span key="o" className="font-mono text-xs">
                {o.orderId ?? "—"}
                <div className="text-[11px] text-zinc-500">{short(o.transactionId, 12)}</div>
              </span>,
              <span key="s" className="text-xs">{o.bppId}</span>,
              <Badge key="st" text={o.state} />,
              <span key="a" className="text-right block font-medium">{inr(o.amount)}</span>,
              <span key="u" className="text-xs text-zinc-400">{when(o.updatedAt)}</span>,
            ])}
            alignRight={[3]}
          />
        ) : null}

        {/* SELLERS (deduped ONDC providers seen across every search) */}
        {tab === "sellers" ? (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              Every seller (ONDC provider) that has answered a search on this
              network, deduped across all transactions. The network has no global
              directory — a seller appears here only after it returns a catalog.
              {sortedSellers ? ` ${sortedSellers.length} seen.` : ""}
            </p>

            {/* Distance-sort reference. Admin isn't a buyer, so nearest-first
                needs a point to measure from: type a lat,long or use this device. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={nearGps}
                onChange={(e) => setNearGps(e.target.value)}
                placeholder="Sort near lat,long (e.g. 12.9716,77.5946)"
                inputMode="decimal"
                className="w-72 max-w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-600"
              />
              <button
                onClick={useMyLocation}
                disabled={locating}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
              >
                {locating ? "Locating…" : "Use my location"}
              </button>
              {nearGps ? (
                <button
                  onClick={() => setNearGps("")}
                  className="rounded-lg px-2 py-2 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear
                </button>
              ) : (
                <span className="text-xs text-zinc-600">
                  or sorted A–Z until a reference is set
                </span>
              )}
            </div>

            {sortedSellers === null ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : (
              <Table
                head={["Seller", "BPP", "Location", "Distance", "Rating"]}
                empty={
                  sortedSellers.length === 0
                    ? "No sellers discovered yet — run a search first."
                    : null
                }
                rows={sortedSellers.map((s) => [
                  <Link
                    key="n"
                    href={`/shop/admin/seller/${encodeURIComponent(
                      s.bppId
                    )}/${encodeURIComponent(s.providerId)}`}
                    className="flex items-center gap-2.5 hover:opacity-90"
                  >
                    <SellerAvatar name={s.name} image={s.image} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-emerald-300 hover:underline">
                        {s.name}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {s.shortDesc ?? s.providerId}
                      </span>
                    </span>
                  </Link>,
                  <span key="b" className="font-mono text-xs">
                    {short(s.bppId, 22)}
                  </span>,
                  <span key="l" className="text-xs text-zinc-400">
                    {sellerPlace(s) ?? "—"}
                  </span>,
                  <span key="d" className="block text-right text-xs text-zinc-300">
                    {formatDistance(s.distanceKm) ?? "—"}
                  </span>,
                  <span key="r" className="block text-right font-medium">
                    {s.rating != null ? s.rating.toFixed(1) : "—"}
                  </span>,
                ])}
                alignRight={[3, 4]}
              />
            )}
          </>
        ) : null}

        {/* SELLER HEALTH — sellers that rejected orders (NACKed the lifecycle) */}
        {tab === "health" ? (
          <>
            <p className="mb-3 text-sm text-zinc-400">
              Sellers that synchronously REJECTED an order (a NACK on
              select&nbsp;/&nbsp;init&nbsp;/&nbsp;confirm) — the exact reason a
              checkout dead-ends. Ranked by how often they fail; the last error is
              the seller&apos;s own reason. Use it to fix a mapping on our side or
              denylist a persistently-broken seller.
              {nacks ? ` ${nacks.length} sellers with rejections.` : ""}
            </p>
            {nacks === null ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : (
              <Table
                head={["Seller", "BPP", "Rejections", "Last error", "When"]}
                empty={
                  nacks.length === 0
                    ? "No seller rejections recorded — every order the buyers placed was accepted."
                    : null
                }
                rows={nacks.map((n) => [
                  n.providerId ? (
                    <Link
                      key="n"
                      href={`/shop/admin/seller/${encodeURIComponent(
                        n.bppId
                      )}/${encodeURIComponent(n.providerId)}`}
                      className="font-medium text-emerald-300 hover:underline"
                    >
                      {n.name ?? n.providerId}
                    </Link>
                  ) : (
                    <span key="n" className="font-medium text-zinc-300">
                      {n.name ?? "—"}
                    </span>
                  ),
                  <span key="b" className="font-mono text-xs">
                    {short(n.bppId, 22)}
                  </span>,
                  <span key="c" className="flex items-center gap-2">
                    <Badge text={String(n.total)} tone="rose" />
                    <span className="text-[11px] text-zinc-500">
                      {Object.entries(n.byAction)
                        .map(([a, c]) => `${a} ${c}`)
                        .join(" · ")}
                    </span>
                  </span>,
                  <span key="e" className="block max-w-xs">
                    {n.lastCode ? (
                      <span className="font-mono text-xs text-rose-300">
                        {n.lastCode}
                      </span>
                    ) : null}
                    {n.lastMessage ? (
                      <span className="block truncate text-xs text-zinc-400">
                        {n.lastMessage}
                      </span>
                    ) : !n.lastCode ? (
                      <span className="text-xs text-zinc-600">—</span>
                    ) : null}
                  </span>,
                  <span key="w" className="whitespace-nowrap text-xs text-zinc-500">
                    {new Date(n.lastAt).toLocaleString()}
                  </span>,
                ])}
              />
            )}
          </>
        ) : null}

        {/* PAYMENTS (reconcile) */}
        {tab === "payments" ? (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              Confirm payments received in the HDFC account (UPI 7838832332.1@hdfc),
              then mark them Paid — the buyer&apos;s payment screen flips to Paid.
            </p>
            <Table
              head={["Reference", "Order / Txn", "Amount", "Status", "Created", "Action"]}
              empty={payments.length === 0 ? "No payments yet." : null}
              rows={payments.map((p) => [
                <span key="r" className="font-mono text-xs">{p.paymentReference}</span>,
                <span key="o" className="text-xs">
                  {p.orderId ?? "—"}
                  <div className="text-[11px] text-zinc-500">{short(p.transactionId, 12)}</div>
                </span>,
                <span key="a" className="block text-right font-medium">{inr(p.amount)}</span>,
                <span key="s">
                  <Badge text={p.status} tone={p.status === "PAID" ? "emerald" : "amber"} />
                  {p.bankReference ? (
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-500">UTR {p.bankReference}</div>
                  ) : null}
                </span>,
                <span key="c" className="text-xs text-zinc-400">{when(p.createdAt)}</span>,
                <span key="ac" className="block text-right">
                  {p.status === "PENDING" ? (
                    <button
                      onClick={() => markPaid(p)}
                      disabled={busyRef === p.paymentReference}
                      className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {busyRef === p.paymentReference ? "Marking…" : "Mark as Paid"}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500">Settled</span>
                  )}
                </span>,
              ])}
              alignRight={[2, 5]}
            />
          </>
        ) : null}

        {/* LOGISTICS (Tocxi shipments) */}
        {tab === "logistics" ? (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              Last-mile courier shipments booked through Tocxi. Book a delivery
              by hand below (pilot: Delhi NCR, COD). Status updates arrive live
              over webhooks. Cancel is available before pickup only.
            </p>
            <BookShipmentCard onBooked={refresh} />
            <Table
              head={[
                "Shipment",
                "Order / Txn",
                "Status",
                "Tracking",
                "Price",
                "Created",
                "Action",
              ]}
              empty={shipments.length === 0 ? "No shipments booked yet." : null}
              rows={shipments.map((s) => [
                <span key="s" className="font-mono text-xs">
                  {s.shipmentId}
                  {s.awbNo ? (
                    <div className="text-[11px] text-zinc-500">AWB {s.awbNo}</div>
                  ) : null}
                </span>,
                <span key="o" className="text-xs">
                  {s.partnerReference}
                  {s.transactionId ? (
                    <div className="text-[11px] text-zinc-500">
                      {short(s.transactionId, 12)}
                    </div>
                  ) : null}
                </span>,
                <span key="st">
                  <Badge text={s.status} tone={shipmentTone(s.status)} />
                  {s.cod ? (
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      COD {inr(s.codAmount)}
                    </div>
                  ) : null}
                </span>,
                <span key="t" className="text-xs">
                  {s.trackingUrl ? (
                    <a
                      href={s.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 hover:underline"
                    >
                      Track
                    </a>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </span>,
                <span key="p" className="block text-right font-medium">
                  {inr(s.estimatedPrice)}
                </span>,
                <span key="c" className="text-xs text-zinc-400">
                  {when(s.createdAt)}
                </span>,
                <span key="ac" className="block text-right">
                  {CANCELLABLE.has(s.status) ? (
                    <button
                      onClick={() => cancelShipment(s)}
                      disabled={busyRef === s.shipmentId}
                      className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"
                    >
                      {busyRef === s.shipmentId ? "Cancelling…" : "Cancel"}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500">—</span>
                  )}
                </span>,
              ])}
              alignRight={[4, 6]}
            />
          </>
        ) : null}

        {/* ISSUES */}
        {tab === "issues" ? (
          <Table
            head={["Issue", "Order", "Category", "Status", "Updated"]}
            empty={summary && summary.issues.length === 0 ? "No IGM issues raised." : null}
            rows={(summary?.issues ?? []).map((i) => [
              <span key="i" className="font-mono text-xs">
                {short(i.issueId, 14)}
                <div className="text-[11px] text-zinc-500">{short(i.transactionId, 12)}</div>
              </span>,
              <span key="o" className="font-mono text-xs">{i.orderId ?? "—"}</span>,
              <span key="c" className="text-xs">{i.category ?? "—"}</span>,
              <Badge
                key="s"
                text={i.status}
                tone={["CLOSED", "RESOLVED"].includes(i.status) ? "emerald" : "amber"}
              />,
              <span key="u" className="text-xs text-zinc-400">{when(i.updatedAt)}</span>,
            ])}
          />
        ) : null}

        {/* REGISTRY */}
        {tab === "registry" ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold">ONDC Registry / Subscribe status</h2>
            {registry === null ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
                {JSON.stringify(registry, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
      </div>

      <p className="mx-auto max-w-6xl px-6 pb-8 text-center text-xs text-zinc-600">
        Demo-grade admin (admin/admin). Data from the shared Postgres store.{" "}
        <Link href="/shop" className="text-zinc-400 hover:text-zinc-200">
          ← Buyer app
        </Link>
      </p>
    </main>
  );
}

function TestEmailCard() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!email.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; id?: string };
      setStatus(d.ok ? { ok: true, msg: `Sent! ID: ${d.id}` } : { ok: false, msg: d.error ?? "Failed" });
    } catch {
      setStatus({ ok: false, msg: "Network error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-1 text-sm font-semibold text-zinc-200">Test Email (Resend)</h3>
      <p className="mb-3 text-xs text-zinc-500">Send a test email to verify Resend is configured and working.</p>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-600"
        />
        <button
          onClick={send}
          disabled={sending || !email.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send Test"}
        </button>
      </div>
      {status ? (
        <p className={`mt-2 text-xs ${status.ok ? "text-emerald-400" : "text-rose-400"}`}>
          {status.msg}
        </p>
      ) : null}
    </div>
  );
}

// Manual booking form for the Logistics tab (roadmap T-23). An admin enters the
// order id + pickup/drop + COD, optionally checks serviceability & price, then
// books — POST /api/logistics/shipments (idempotent on the order id). This is the
// pilot's booking path in lieu of auto-book-on-paid; the live order/payment flow
// is untouched. On success the pickup (store) is kept so the next booking only
// needs a new order id + drop.
type FormCoord = {
  contactName: string;
  contactPhone: string;
  addressLine: string;
  pincode: string;
  latitude: string;
  longitude: string;
};
const EMPTY_COORD: FormCoord = {
  contactName: "",
  contactPhone: "",
  addressLine: "",
  pincode: "",
  latitude: "",
  longitude: "",
};

// Parse a trimmed numeric input, or undefined when blank/invalid.
function toNum(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// Validate + normalize a pickup/drop form group into the wire Address shape.
function coordToAddress(
  c: FormCoord
):
  | {
      ok: true;
      address: {
        contactName: string;
        contactPhone: string;
        addressLine?: string;
        pincode?: string;
        latitude: number;
        longitude: number;
      };
    }
  | { ok: false; error: string } {
  const latitude = toNum(c.latitude);
  const longitude = toNum(c.longitude);
  if (!c.contactName.trim() || !c.contactPhone.trim()) {
    return { ok: false, error: "contact name and phone are required" };
  }
  if (latitude === undefined || longitude === undefined) {
    return { ok: false, error: "latitude and longitude must be numbers" };
  }
  return {
    ok: true,
    address: {
      contactName: c.contactName.trim(),
      contactPhone: c.contactPhone.trim(),
      addressLine: c.addressLine.trim() || undefined,
      pincode: c.pincode.trim() || undefined,
      latitude,
      longitude,
    },
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "tel" | "text";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-600"
      />
    </label>
  );
}

function BookShipmentCard({ onBooked }: { onBooked: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [pickup, setPickup] = useState<FormCoord>(EMPTY_COORD);
  const [drop, setDrop] = useState<FormCoord>(EMPTY_COORD);
  const [parcelSize, setParcelSize] = useState<"SMALL" | "MEDIUM" | "LARGE">("MEDIUM");
  const [weightKg, setWeightKg] = useState("");
  const [packageDescription, setPackageDescription] = useState("Groceries");
  const [cod, setCod] = useState(true);
  const [codAmount, setCodAmount] = useState("");

  type Quote = {
    serviceable: boolean;
    totalPrice: number;
    codFee: number;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
    currency: string;
  };
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Update one field of a pickup/drop group.
  const set =
    (setter: React.Dispatch<React.SetStateAction<FormCoord>>, key: keyof FormCoord) =>
    (v: string) =>
      setter((prev) => ({ ...prev, [key]: v }));

  const coordFields = (
    legend: string,
    state: FormCoord,
    setter: React.Dispatch<React.SetStateAction<FormCoord>>
  ) => (
    <fieldset className="rounded-lg border border-zinc-800 p-3">
      <legend className="px-1 text-xs font-semibold text-zinc-300">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Contact name" value={state.contactName} onChange={set(setter, "contactName")} required />
        <Field label="Contact phone" value={state.contactPhone} onChange={set(setter, "contactPhone")} inputMode="tel" required />
        <Field label="Address line" value={state.addressLine} onChange={set(setter, "addressLine")} />
        <Field label="Pincode" value={state.pincode} onChange={set(setter, "pincode")} placeholder="110001" inputMode="numeric" />
        <Field label="Latitude" value={state.latitude} onChange={set(setter, "latitude")} placeholder="28.6304" inputMode="decimal" required />
        <Field label="Longitude" value={state.longitude} onChange={set(setter, "longitude")} placeholder="77.2177" inputMode="decimal" required />
      </div>
    </fieldset>
  );

  const checkQuote = async () => {
    const p = coordToAddress(pickup);
    if (!p.ok) return setMsg({ ok: false, text: `Pickup: ${p.error}` });
    const d = coordToAddress(drop);
    if (!d.ok) return setMsg({ ok: false, text: `Drop: ${d.error}` });
    setQuoting(true);
    setMsg(null);
    setQuote(null);
    try {
      const res = await fetch("/api/logistics/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupLatitude: p.address.latitude,
          pickupLongitude: p.address.longitude,
          dropLatitude: d.address.latitude,
          dropLongitude: d.address.longitude,
          parcelSize,
          weightKg: toNum(weightKg),
          cod,
          codAmount: cod ? toNum(codAmount) : undefined,
        }),
      });
      const data = (await res.json()) as Quote & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setQuote(data);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Quote failed" });
    } finally {
      setQuoting(false);
    }
  };

  const book = async () => {
    if (!orderId.trim()) return setMsg({ ok: false, text: "Order id is required." });
    const p = coordToAddress(pickup);
    if (!p.ok) return setMsg({ ok: false, text: `Pickup: ${p.error}` });
    const d = coordToAddress(drop);
    if (!d.ok) return setMsg({ ok: false, text: `Drop: ${d.error}` });
    const amt = toNum(codAmount);
    if (cod && (amt === undefined || amt < 0)) {
      return setMsg({ ok: false, text: "COD amount is required for a COD shipment." });
    }
    setBooking(true);
    setMsg(null);
    try {
      const res = await fetch("/api/logistics/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerReference: orderId.trim(),
          transactionId: transactionId.trim() || undefined,
          pickup: p.address,
          drop: d.address,
          packageDescription: packageDescription.trim() || undefined,
          parcelSize,
          weightKg: toNum(weightKg),
          cod,
          codAmount: cod ? amt : undefined,
        }),
      });
      const data = (await res.json()) as {
        shipment?: { shipmentId: string; status: string };
        error?: string;
      };
      if (!res.ok || !data.shipment) {
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      setMsg({ ok: true, text: `Booked ${data.shipment.shipmentId} · ${data.shipment.status}` });
      // Keep pickup (the store rarely changes); clear the order-specific fields.
      setOrderId("");
      setTransactionId("");
      setDrop(EMPTY_COORD);
      setCodAmount("");
      setQuote(null);
      await onBooked();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Booking failed" });
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-zinc-200">Book a shipment</span>
        <span className="text-xs text-zinc-500">{open ? "Hide" : "New booking"}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-zinc-800 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Order id (partnerReference)" value={orderId} onChange={setOrderId} placeholder="order-88213" required />
            <Field label="Transaction id (optional)" value={transactionId} onChange={setTransactionId} placeholder="ONDC txn" />
          </div>

          {coordFields("Pickup (store)", pickup, setPickup)}
          {coordFields("Drop (buyer)", drop, setDrop)}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
                Parcel size
              </span>
              <select
                value={parcelSize}
                onChange={(e) =>
                  setParcelSize(e.target.value as "SMALL" | "MEDIUM" | "LARGE")
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-600"
              >
                <option value="SMALL">SMALL</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LARGE">LARGE</option>
              </select>
            </label>
            <Field label="Weight (kg)" value={weightKg} onChange={setWeightKg} placeholder="4.0" inputMode="decimal" />
            <Field label="Package" value={packageDescription} onChange={setPackageDescription} />
            <Field label="COD amount (₹)" value={codAmount} onChange={setCodAmount} placeholder="640" inputMode="decimal" required={cod} />
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={cod}
              onChange={(e) => setCod(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-emerald-600"
            />
            Cash on delivery (required for the pilot)
          </label>

          {quote ? (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                quote.serviceable
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {quote.serviceable
                ? `Serviceable · ${inr(quote.totalPrice)} (COD fee ${inr(quote.codFee)}) · ~${quote.estimatedDurationMin} min · ${quote.estimatedDistanceKm} km`
                : "Not serviceable for this pickup/drop."}
            </div>
          ) : null}

          {msg ? (
            <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {msg.text}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              onClick={checkQuote}
              disabled={quoting || booking}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
            >
              {quoting ? "Checking…" : "Check price"}
            </button>
            <button
              onClick={book}
              disabled={booking || quoting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {booking ? "Booking…" : "Book shipment"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "zinc",
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "zinc" | "emerald" | "amber";
}) {
  const tone =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
        ? "text-emerald-300"
        : "text-white";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

function Badge({
  text,
  tone = "zinc",
}: {
  text: string;
  tone?: "zinc" | "emerald" | "amber" | "rose";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-300"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-300"
        : tone === "rose"
          ? "bg-rose-500/15 text-rose-300"
          : "bg-zinc-700/40 text-zinc-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
}

// Seller logo (descriptor.symbol / first catalog image) with a graceful fallback
// to the name's initial. Native <img> + onError mirrors ProductThumb — ONDC
// images come from arbitrary seller hosts next/image would reject. No emoji: the
// fallback is the seller's first letter.
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
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-zinc-700"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-700">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Table({
  head,
  rows,
  empty,
  alignRight = [],
}: {
  head: string[];
  rows: ReactNode[][];
  empty: string | null;
  alignRight?: number[];
}) {
  const ar = new Set(alignRight);
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-zinc-900/70 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-3 ${ar.has(i) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-zinc-900/40">
              {r.map((cell, ci) => (
                <td key={ci} className={`px-4 py-3 ${ar.has(ci) ? "text-right" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-10 text-center text-sm text-zinc-500">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
