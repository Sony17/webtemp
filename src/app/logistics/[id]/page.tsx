"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, StatusBadge, Spinner, ErrorState, Badge } from "@/components/tocxi/tocxi-ui";
import { ShipmentTimeline } from "@/components/tocxi/shipment-timeline";
import { CancelModal } from "@/components/tocxi/cancel-modal";

type ShipmentDetail = {
  shipmentId: string;
  partnerReference?: string;
  status: string;
  estimatedPrice: number;
  trackingUrl: string;
  awbNo?: string;
  pickup?: { contactName: string; contactPhone: string; addressLine: string; pincode: string; latitude: number; longitude: number };
  drop?: { contactName: string; contactPhone: string; addressLine: string; pincode: string; latitude: number; longitude: number };
  packageDescription?: string;
  parcelSize?: string;
  weightKg?: number;
  declaredValue?: number;
  cod?: boolean;
  codAmount?: number;
  estimatedDistanceKm?: number;
  estimatedDurationMin?: number;
  codFee?: number;
  totalPrice?: number;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string;
};

export default function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const [data, setData] = React.useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showCancel, setShowCancel] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tocxi/shipments/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Failed to fetch shipment");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const handleCancel = async (reason: string) => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/tocxi/shipments/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Cancel failed");
      setShowCancel(false);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchData} />;
  }

  if (!data) {
    return <ErrorState message="Shipment not found" />;
  }

  const canCancel = data.status === "PENDING" || data.status === "CONFIRMED";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">
              ← Back to Dashboard
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{data.shipmentId}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={data.status} />
            {data.partnerReference && (
              <span className="text-sm text-gray-500">Ref: {data.partnerReference}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {data.trackingUrl && (
            <a href={data.trackingUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">Track</Button>
            </a>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={() => setShowCancel(true)}>
              Cancel Shipment
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Shipment Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ShipmentTimeline currentStatus={data.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pickup Address</CardTitle>
            </CardHeader>
            <CardContent>
              {data.pickup ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-gray-900">{data.pickup.contactName}</p>
                  <p className="text-gray-500">{data.pickup.contactPhone}</p>
                  <p className="text-gray-600">{data.pickup.addressLine}</p>
                  <p className="text-gray-500">Pincode: {data.pickup.pincode}</p>
                  <p className="text-gray-400 text-xs">
                    {data.pickup.latitude}, {data.pickup.longitude}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-400">Not available</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Drop Address</CardTitle>
            </CardHeader>
            <CardContent>
              {data.drop ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-gray-900">{data.drop.contactName}</p>
                  <p className="text-gray-500">{data.drop.contactPhone}</p>
                  <p className="text-gray-600">{data.drop.addressLine}</p>
                  <p className="text-gray-500">Pincode: {data.drop.pincode}</p>
                  <p className="text-gray-400 text-xs">
                    {data.drop.latitude}, {data.drop.longitude}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-400">Not available</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Package</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.packageDescription && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Description</p>
                  <p className="text-sm text-gray-900">{data.packageDescription}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase">Size</p>
                <p className="text-sm text-gray-900">{data.parcelSize ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Weight</p>
                <p className="text-sm text-gray-900">{data.weightKg ? `${data.weightKg} kg` : "—"}</p>
              </div>
              {data.declaredValue != null && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Declared Value</p>
                  <p className="text-sm text-gray-900">₹{data.declaredValue.toFixed(2)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Est. Price</span>
                <span className="text-sm font-medium text-gray-900">
                  {data.estimatedPrice != null ? `₹${data.estimatedPrice.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">COD Fee</span>
                <span className="text-sm text-gray-900">
                  {data.codFee != null ? `₹${data.codFee.toFixed(2)}` : "—"}
                </span>
              </div>
              {data.estimatedDistanceKm != null && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Distance</span>
                  <span className="text-sm text-gray-900">{data.estimatedDistanceKm.toFixed(1)} km</span>
                </div>
              )}
            </CardContent>
          </Card>

          {data.cod && (
            <Card>
              <CardHeader>
                <CardTitle>COD</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Amount</span>
                  <span className="text-sm font-medium text-gray-900">
                    ₹{data.codAmount?.toFixed(2) ?? "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {data.awbNo && (
            <Card>
              <CardHeader>
                <CardTitle>Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <p className="text-xs text-gray-500 uppercase">AWB Number</p>
                  <p className="text-sm font-mono text-gray-900">{data.awbNo}</p>
                </div>
                {data.trackingUrl && (
                  <a
                    href={data.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-sm text-blue-600 hover:text-blue-800"
                  >
                    Open Tracking Page →
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Timestamps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.createdAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-900">{new Date(data.createdAt).toLocaleString("en-IN")}</span>
                </div>
              )}
              {data.updatedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Updated</span>
                  <span className="text-gray-900">{new Date(data.updatedAt).toLocaleString("en-IN")}</span>
                </div>
              )}
              {data.cancelledAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Cancelled</span>
                  <span className="text-gray-900">{new Date(data.cancelledAt).toLocaleString("en-IN")}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CancelModal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        onConfirm={handleCancel}
        loading={cancelling}
      />
    </div>
  );
}
