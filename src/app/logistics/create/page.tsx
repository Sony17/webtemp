"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Input, Select, Spinner } from "@/components/tocxi/tocxi-ui";

export default function CreateShipmentPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{ shipmentId: string; trackingUrl: string } | null>(null);

  const [form, setForm] = React.useState({
    partnerReference: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupAddressLine: "",
    pickupPincode: "",
    pickupLatitude: "",
    pickupLongitude: "",
    dropContactName: "",
    dropContactPhone: "",
    dropAddressLine: "",
    dropPincode: "",
    dropLatitude: "",
    dropLongitude: "",
    packageDescription: "",
    parcelSize: "SMALL",
    weightKg: "",
    declaredValue: "",
    cod: false,
    codAmount: "",
  });

  const update = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const body = {
        partnerReference: form.partnerReference,
        pickup: {
          contactName: form.pickupContactName,
          contactPhone: form.pickupContactPhone,
          addressLine: form.pickupAddressLine,
          pincode: form.pickupPincode,
          latitude: parseFloat(form.pickupLatitude),
          longitude: parseFloat(form.pickupLongitude),
        },
        drop: {
          contactName: form.dropContactName,
          contactPhone: form.dropContactPhone,
          addressLine: form.dropAddressLine,
          pincode: form.dropPincode,
          latitude: parseFloat(form.dropLatitude),
          longitude: parseFloat(form.dropLongitude),
        },
        packageDescription: form.packageDescription || undefined,
        parcelSize: form.parcelSize,
        weightKg: form.weightKg ? parseFloat(form.weightKg) : undefined,
        declaredValue: form.declaredValue ? parseFloat(form.declaredValue) : undefined,
        cod: form.cod,
        codAmount: form.cod ? parseFloat(form.codAmount) : undefined,
      };

      const res = await fetch("/api/tocxi/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.details?.join(", ") || "Failed to create shipment");
      }

      setSuccess({ shipmentId: data.shipmentId, trackingUrl: data.trackingUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-col items-center text-center py-8">
              <div className="rounded-full bg-green-100 p-4 mb-4">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Shipment Created!</h2>
              <p className="text-sm text-gray-500 mt-2">
                Shipment ID: <span className="font-mono font-medium text-gray-700">{success.shipmentId}</span>
              </p>
              {success.trackingUrl && (
                <a
                  href={success.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  Track Shipment →
                </a>
              )}
              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => router.push("/logistics")}>
                  Back to Dashboard
                </Button>
                <Button onClick={() => { setSuccess(null); setForm({
                  partnerReference: "", pickupContactName: "", pickupContactPhone: "",
                  pickupAddressLine: "", pickupPincode: "", pickupLatitude: "", pickupLongitude: "",
                  dropContactName: "", dropContactPhone: "", dropAddressLine: "", dropPincode: "",
                  dropLatitude: "", dropLongitude: "", packageDescription: "", parcelSize: "SMALL",
                  weightKg: "", declaredValue: "", cod: false, codAmount: "",
                }); }}>
                  Create Another
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inputClass = "flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Shipment</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <Label htmlFor="partnerReference">Partner Reference *</Label>
              <Input
                id="partnerReference"
                required
                placeholder="e.g. order-88213"
                value={form.partnerReference}
                onChange={(e) => update("partnerReference", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pickup Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="pickupContactName">Contact Name *</Label>
                <Input id="pickupContactName" required value={form.pickupContactName}
                  onChange={(e) => update("pickupContactName", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pickupContactPhone">Contact Phone *</Label>
                <Input id="pickupContactPhone" required value={form.pickupContactPhone}
                  onChange={(e) => update("pickupContactPhone", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="pickupAddressLine">Address *</Label>
                <Input id="pickupAddressLine" required value={form.pickupAddressLine}
                  onChange={(e) => update("pickupAddressLine", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pickupPincode">Pincode *</Label>
                <Input id="pickupPincode" required value={form.pickupPincode}
                  onChange={(e) => update("pickupPincode", e.target.value)} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="pickupLatitude">Latitude *</Label>
                  <Input id="pickupLatitude" required type="number" step="any" value={form.pickupLatitude}
                    onChange={(e) => update("pickupLatitude", e.target.value)} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="pickupLongitude">Longitude *</Label>
                  <Input id="pickupLongitude" required type="number" step="any" value={form.pickupLongitude}
                    onChange={(e) => update("pickupLongitude", e.target.value)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drop Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dropContactName">Contact Name *</Label>
                <Input id="dropContactName" required value={form.dropContactName}
                  onChange={(e) => update("dropContactName", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dropContactPhone">Contact Phone *</Label>
                <Input id="dropContactPhone" required value={form.dropContactPhone}
                  onChange={(e) => update("dropContactPhone", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dropAddressLine">Address *</Label>
                <Input id="dropAddressLine" required value={form.dropAddressLine}
                  onChange={(e) => update("dropAddressLine", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dropPincode">Pincode *</Label>
                <Input id="dropPincode" required value={form.dropPincode}
                  onChange={(e) => update("dropPincode", e.target.value)} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="dropLatitude">Latitude *</Label>
                  <Input id="dropLatitude" required type="number" step="any" value={form.dropLatitude}
                    onChange={(e) => update("dropLatitude", e.target.value)} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="dropLongitude">Longitude *</Label>
                  <Input id="dropLongitude" required type="number" step="any" value={form.dropLongitude}
                    onChange={(e) => update("dropLongitude", e.target.value)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Package Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="packageDescription">Description</Label>
                <Input id="packageDescription" placeholder="e.g. Groceries, Electronics"
                  value={form.packageDescription} onChange={(e) => update("packageDescription", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="parcelSize">Parcel Size</Label>
                <Select id="parcelSize" value={form.parcelSize}
                  onChange={(e) => update("parcelSize", e.target.value)}>
                  <option value="SMALL">Small</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LARGE">Large</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="weightKg">Weight (kg)</Label>
                <Input id="weightKg" type="number" step="0.1" min="0" value={form.weightKg}
                  onChange={(e) => update("weightKg", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="declaredValue">Declared Value (₹)</Label>
                <Input id="declaredValue" type="number" step="1" min="0" value={form.declaredValue}
                  onChange={(e) => update("declaredValue", e.target.value)} placeholder="Optional — marks shipment insured" />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex items-center gap-2 pb-2">
                  <input
                    type="checkbox"
                    id="cod"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={form.cod}
                    onChange={(e) => update("cod", e.target.checked)}
                  />
                  <Label htmlFor="cod" className="mb-0">Cash on Delivery</Label>
                </div>
                {form.cod && (
                  <div className="flex-1">
                    <Label htmlFor="codAmount">COD Amount (₹) *</Label>
                    <Input id="codAmount" type="number" step="1" min="0" required
                      value={form.codAmount} onChange={(e) => update("codAmount", e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => router.push("/logistics")}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? <><Spinner className="mr-2" /> Creating...</> : "Create Shipment"}
          </Button>
        </div>
      </form>
    </div>
  );
}
