"use client";

// Admin payment RECONCILE console — the "recall system".
//
// Lists every tracked payment (from the shared Postgres store via
// /api/payments/list) and lets an operator flip a PENDING payment to PAID after
// checking the HDFC account — calling the existing POST /api/payments/reconcile.
// Guarded client-side by the same admin flag as the other admin pages
// (localStorage "oi_admin"); demo-grade, matching the app's admin/admin login.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Payment = {
  transactionId: string;
  orderId?: string;
  amount?: number;
  paymentReference: string;
  status: "PENDING" | "PAID";
  bankReference?: string;
  verifiedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type Filter = "PENDING" | "PAID" | "ALL";

function inr(n?: number): string {
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

export default function AdminPaymentsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  // Same client-side guard as the other admin pages.
  useEffect(() => {
    let ok = false;
    try {
      ok = localStorage.getItem("oi_admin") === "1";
    } catch {
      /* ignore */
    }
    if (!ok) {
      router.replace("/admin/login?next=/sai-admin");
      return;
    }
    setAuthed(true);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/payments/list${qs}`, { cache: "no-store" });
      const data = (await res.json()) as { payments?: Payment[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setPayments(data.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const markPaid = async (p: Payment) => {
    const bankReference =
      window.prompt(
        `Mark ${p.paymentReference} as PAID.\nOptional: enter the bank/UPI reference (UTR):`,
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark paid.");
    } finally {
      setBusyRef(null);
    }
  };

  if (authed === null) {
    return <main className="min-h-screen bg-zinc-950" />;
  }

  const pendingCount = payments.filter((p) => p.status === "PENDING").length;

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Payments — Reconcile</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Confirm payments received in the HDFC account, then mark them Paid.
            </p>
          </div>
          <Link href="/sai-admin" className="text-sm text-zinc-400 hover:text-zinc-200">
            ← Admin
          </Link>
        </div>

        <div className="mb-4 flex items-center gap-2">
          {(["PENDING", "PAID", "ALL"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                filter === f
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {f === "PENDING" ? "Pending" : f === "PAID" ? "Paid" : "All"}
            </button>
          ))}
          <button
            onClick={() => load()}
            className="ml-auto rounded-full bg-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-900/70 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Order / Txn</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {payments.map((p) => (
                <tr key={p.paymentReference} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3 font-mono text-xs">{p.paymentReference}</td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-200">{p.orderId ?? "—"}</div>
                    <div className="font-mono text-[11px] text-zinc-500">
                      {p.transactionId.slice(0, 12)}…
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{inr(p.amount)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.status === "PAID"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.bankReference ? (
                      <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                        UTR {p.bankReference}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{when(p.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.status === "PENDING" ? (
                      <button
                        onClick={() => markPaid(p)}
                        disabled={busyRef === p.paymentReference}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {busyRef === p.paymentReference ? "Marking…" : "Mark as Paid"}
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-500">Settled</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                    No {filter === "ALL" ? "" : filter.toLowerCase()} payments.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          {payments.length} shown · {pendingCount} pending. Marking Paid records
          the settlement (write-once) and the buyer's payment screen flips to Paid.
        </p>
      </div>
    </main>
  );
}
