"use client";

// ONDC Admin dashboard — overview + orders + payments (reconcile) + IGM + registry.
// Rendered full-bleed (Chrome skips the buyer header/nav for /shop/admin) and
// guarded client-side by the same admin flag as the other admin pages
// (localStorage "oi_admin"; admin/admin login). Demo-grade auth — the data APIs
// are ungated server-side; harden before production.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
type Payment = {
  transactionId: string;
  orderId?: string;
  amount?: number;
  paymentReference: string;
  status: "PENDING" | "PAID";
  bankReference?: string;
  createdAt: number;
};

type Tab = "overview" | "orders" | "payments" | "issues" | "registry";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "payments", label: "Payments" },
  { id: "issues", label: "Issues" },
  { id: "registry", label: "Registry" },
];

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

export default function OndcAdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [registry, setRegistry] = useState<unknown>(null);
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
      const [sRes, pRes] = await Promise.all([
        fetch("/api/shop/admin/summary", { cache: "no-store" }),
        fetch("/api/payments/list", { cache: "no-store" }),
      ]);
      const s = (await sRes.json()) as Summary & { error?: string };
      const p = (await pRes.json()) as { payments?: Payment[]; error?: string };
      if (!sRes.ok) throw new Error(s.error ?? "Failed to load summary");
      setSummary(s);
      setPayments(p.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const logout = () => {
    try {
      localStorage.removeItem("oi_admin");
    } catch {
      /* ignore */
    }
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
  tone?: "zinc" | "emerald" | "amber";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-300"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-zinc-700/40 text-zinc-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
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
