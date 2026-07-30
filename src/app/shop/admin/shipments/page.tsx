"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Shipment = {
  id: string;
  shipmentId: string;
  partnerReference: string | null;
  status: string;
  estimatedPrice: number | null;
  trackingUrl: string | null;
  awbNo: string | null;
  createdAt: string;
  updatedAt: string;
};

type PageData = {
  content: Shipment[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

function when(d: string): string {
  try {
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  PICKED_UP: "bg-indigo-100 text-indigo-800",
  IN_TRANSIT: "bg-purple-100 text-purple-800",
  OUT_FOR_DELIVERY: "bg-orange-100 text-orange-800",
  DELIVERED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  FAILED: "bg-red-100 text-red-800",
};

export default function AdminShipmentsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let ok = false;
    try {
      ok = localStorage.getItem("oi_admin") === "1";
    } catch {
      /* ignore */
    }
    if (!ok) {
      router.replace("/admin/login?next=/shop/admin/shipments");
      return;
    }
    setAuthed(true);
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), size: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/tocxi/shipments?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shipments");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    if (authed) refresh();
  }, [authed, refresh]);

  const cancelShipment = async (shipmentId: string) => {
    if (!confirm("Cancel this shipment?")) return;
    setBusyId(shipmentId);
    try {
      const res = await fetch(`/api/tocxi/shipments/${encodeURIComponent(shipmentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by admin" }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  };

  if (authed === null) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Shipments</h1>
            <p className="text-sm text-zinc-400 mt-1">Tocxi logistics shipments</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/logistics/create")}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              Create Shipment
            </button>
            <button
              onClick={() => router.push("/shop/admin")}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
            >
              Back to Admin
            </button>
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by ID or reference…"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PICKED_UP">Picked Up</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-900/30 border border-red-800 p-4 text-sm text-red-300 mb-4">{error}</div>
        ) : null}

        {loading ? (
          <div className="text-center py-12 text-zinc-500">Loading shipments…</div>
        ) : data && data.content.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">No shipments found.</div>
        ) : data ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900">
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Shipment ID</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Order Ref</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">AWB</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Price</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Created</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.content.map((s) => (
                    <tr key={s.id} className="border-b border-zinc-800 hover:bg-zinc-900/50">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-300">{s.shipmentId}</td>
                      <td className="px-4 py-3 text-zinc-300">{s.partnerReference ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            STATUS_COLORS[s.status] ?? "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{s.awbNo ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-300">
                        {s.estimatedPrice != null ? `₹${s.estimatedPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{when(s.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {s.trackingUrl ? (
                            <a
                              href={s.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                            >
                              Track
                            </a>
                          ) : null}
                          {s.status !== "CANCELLED" && s.status !== "DELIVERED" && s.status !== "FAILED" ? (
                            <button
                              onClick={() => cancelShipment(s.shipmentId)}
                              disabled={busyId === s.shipmentId}
                              className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded transition-colors disabled:opacity-50"
                            >
                              {busyId === s.shipmentId ? "…" : "Cancel"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 text-sm text-zinc-400">
              <span>
                Page {data.page + 1} of {Math.max(1, data.totalPages)} ({data.totalElements} total)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={data.page <= 0}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={data.page + 1 >= data.totalPages}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
