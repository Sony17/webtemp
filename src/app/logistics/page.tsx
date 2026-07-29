"use client";

import * as React from "react";
import Link from "next/link";
import { Button, StatusBadge, EmptyState, ErrorState, Spinner, Card, CardContent } from "@/components/tocxi/tocxi-ui";
import { CancelModal } from "@/components/tocxi/cancel-modal";
import { cn } from "@/lib/shop/cn";

type Shipment = {
  id: string;
  shipmentId: string;
  partnerReference: string | null;
  status: string;
  estimatedPrice: number | null;
  trackingUrl: string | null;
  createdAt: string;
};

type PageData = {
  content: Shipment[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export default function LogisticsDashboard() {
  const [data, setData] = React.useState<PageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [cancelTarget, setCancelTarget] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const size = 20;

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), size: String(size) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/tocxi/shipments?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Failed to fetch shipments");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const handleCancel = async (reason: string) => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/tocxi/shipments/${cancelTarget}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Cancel failed");
      setCancelTarget(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipments</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? `${data.totalElements} total shipment(s)` : "Manage your Tocxi deliveries"}
          </p>
        </div>
        <Link href="/logistics/create">
          <Button>Create Shipment</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by ID or reference..."
                className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <select
              className="flex h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PICKED_UP">Picked Up</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="DELIVERED">Delivered</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={fetchData} />}

      {!loading && !error && data && data.content.length === 0 && (
        <EmptyState
          title="No shipments yet"
          description="Create your first shipment to get started with Tocxi Logistics."
          action={<Link href="/logistics/create"><Button>Create Shipment</Button></Link>}
        />
      )}

      {!loading && !error && data && data.content.length > 0 && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Shipment ID</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Est. Price</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.content.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/logistics/${s.shipmentId}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                          {s.shipmentId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {s.partnerReference || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                        {s.estimatedPrice != null ? `₹${s.estimatedPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(s.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/logistics/${s.shipmentId}`}>
                            <Button variant="ghost" size="sm">View</Button>
                          </Link>
                          {(s.status === "PENDING" || s.status === "CONFIRMED") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCancelTarget(s.shipmentId)}
                              className="text-red-600 border-red-200 hover:bg-red-50"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {data.page + 1} of {data.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <CancelModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        loading={cancelling}
      />
    </div>
  );
}
