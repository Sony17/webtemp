"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Input, Select, Spinner } from "@/components/tocxi/tocxi-ui";

type QResult = {
  serviceable: boolean;
  totalPrice: number;
  codFee: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  currency: string;
};

export default function QuotePage() {
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<"serviceability" | "quote">("serviceability");
  const [result, setResult] = React.useState<QResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    pickupLatitude: "",
    pickupLongitude: "",
    dropLatitude: "",
    dropLongitude: "",
    parcelSize: "SMALL",
    weightKg: "",
    cod: false,
    codAmount: "",
  });

  const update = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = {
        pickupLatitude: parseFloat(form.pickupLatitude),
        pickupLongitude: parseFloat(form.pickupLongitude),
        dropLatitude: parseFloat(form.dropLatitude),
        dropLongitude: parseFloat(form.dropLongitude),
        parcelSize: form.parcelSize,
        weightKg: parseFloat(form.weightKg),
        cod: form.cod,
        codAmount: form.cod ? parseFloat(form.codAmount) : 0,
      };

      const endpoint = mode === "serviceability" ? "/api/tocxi/serviceability" : "/api/tocxi/quote";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details?.join(", ") || "Request failed");

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Serviceability &amp; Quote</h1>

      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="flex gap-2">
            <Button
              variant={mode === "serviceability" ? "default" : "outline"}
              onClick={() => setMode("serviceability")}
              size="sm"
            >
              Check Serviceability
            </Button>
            <Button
              variant={mode === "quote" ? "default" : "outline"}
              onClick={() => setMode("quote")}
              size="sm"
            >
              Get Quote
            </Button>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {mode === "serviceability"
              ? "Check if Tocxi can deliver between these locations."
              : "Get a delivery price quote for this route."}
          </p>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Pickup Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="pickupLatitude">Latitude *</Label>
                <Input id="pickupLatitude" required type="number" step="any" value={form.pickupLatitude}
                  onChange={(e) => update("pickupLatitude", e.target.value)} placeholder="e.g. 28.6139" />
              </div>
              <div>
                <Label htmlFor="pickupLongitude">Longitude *</Label>
                <Input id="pickupLongitude" required type="number" step="any" value={form.pickupLongitude}
                  onChange={(e) => update("pickupLongitude", e.target.value)} placeholder="e.g. 77.2090" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drop Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dropLatitude">Latitude *</Label>
                <Input id="dropLatitude" required type="number" step="any" value={form.dropLatitude}
                  onChange={(e) => update("dropLatitude", e.target.value)} placeholder="e.g. 28.5355" />
              </div>
              <div>
                <Label htmlFor="dropLongitude">Longitude *</Label>
                <Input id="dropLongitude" required type="number" step="any" value={form.dropLongitude}
                  onChange={(e) => update("dropLongitude", e.target.value)} placeholder="e.g. 77.3910" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parcel Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="weightKg">Weight (kg) *</Label>
                <Input id="weightKg" required type="number" step="0.1" min="0" value={form.weightKg}
                  onChange={(e) => update("weightKg", e.target.value)} />
              </div>
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
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={loading} className="min-w-[160px]">
            {loading ? <><Spinner className="mr-2" /> Checking...</> : mode === "serviceability" ? "Check Serviceability" : "Get Quote"}
          </Button>
        </div>
      </form>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>
              {mode === "serviceability" ? "Serviceability Result" : "Quote Result"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">Serviceable:</span>
                {result.serviceable ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Yes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-red-700">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    No
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase font-medium">Distance</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    {result.estimatedDistanceKm.toFixed(1)} km
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase font-medium">ETA</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    {result.estimatedDurationMin >= 60
                      ? `${Math.floor(result.estimatedDurationMin / 60)}h ${result.estimatedDurationMin % 60}m`
                      : `${result.estimatedDurationMin} min`}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase font-medium">Total Price</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    ₹{result.totalPrice.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs text-gray-500 uppercase font-medium">COD Fee</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    ₹{result.codFee.toFixed(2)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-400">All prices in {result.currency}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
