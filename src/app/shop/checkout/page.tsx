"use client";

// Buyer-app CHECKOUT — orchestrates the ONDC order lifecycle end-to-end:
//   select  → on_select (binding quote)
//   init    → on_init   (final quote with delivery + taxes)
//   confirm → on_confirm (order placed, order_id assigned)
// Each step is asynchronous (the seller answers via a callback), so we fire the
// action then poll /api/shop/state until the matching record lands.
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Store,
  Bike,
  Clock,
  PackageOpen,
  IndianRupee,
} from "lucide-react";
import { Button, Card, Input, Label, Separator, Textarea } from "@/components/shop/ui";
import { EmptyState, QuoteSummary } from "@/components/shop/widgets";
import { Stepper } from "@/components/shop/Stepper";

const CHECKOUT_STEPS = ["Address", "Review", "Payment"];
import { useShop, type Address } from "@/lib/shop/store";
import {
  parseQuote,
  parseFulfillmentOptions,
  type ParsedQuote,
  type FulfillmentOption,
} from "@/lib/shop/types";
import * as api from "@/lib/shop/api";
import type { LogisticsQuoteResponse } from "@/lib/shop/api";

const FULFILLMENT_ICON: Record<string, typeof Truck> = {
  Delivery: Truck,
  "Self-Pickup": Store,
  "Buyer-Delivery": Bike,
};

type Step = "address" | "quoting" | "review" | "placing" | "error";

export default function CheckoutPage() {
  const router = useRouter();
  const {
    lines,
    cartBpp,
    cartTotal,
    address,
    setAddress,
    transactionId,
    clearCart,
    addOrder,
  } = useShop();

  const [step, setStep] = React.useState<Step>("address");
  const [form, setForm] = React.useState<Address>(
    address ?? {
      name: "",
      phone: "",
      email: "",
      building: "",
      locality: "",
      city: "",
      state: "",
      areaCode: "",
    }
  );
  const [quote, setQuote] = React.useState<ParsedQuote | null>(null);
  const [options, setOptions] = React.useState<FulfillmentOption[]>([]);
  const [chosenFf, setChosenFf] = React.useState<FulfillmentOption | null>(null);
  const [instructions, setInstructions] = React.useState(address?.instructions ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [statusMsg, setStatusMsg] = React.useState("");
  const [logistics, setLogistics] = React.useState<LogisticsQuoteResponse | null>(null);
  const [logisticsLoading, setLogisticsLoading] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  // Reentrancy guard for placeOrder (survives re-renders; not display state).
  const placingRef = React.useRef(false);

  // Capture the buyer's GPS. Most RET10 sellers define serviceability
  // hyperlocally (radius/polygon), so they can only price + return on_select
  // when the select carries the delivery GPS — a bare pincode isn't enough.
  // We read it from the browser (an external system) and write "lat,long".
  const detectLocation = React.useCallback((silent = false) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (!silent)
        setError("Location isn't available in this browser — enter GPS manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gps = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
        setForm((f) => ({ ...f, gps }));
        setLocating(false);
        if (!silent) setError(null);
      },
      () => {
        setLocating(false);
        if (!silent)
          setError(
            "Couldn't get your location. Allow location access, or type GPS as lat,long."
          );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 }
    );
  }, []);

  // Best-effort auto-detect once on mount when we don't already have a GPS, so
  // the delivery target is serviceability-ready without the buyer thinking about
  // it. Silent: a denied permission just leaves the field for manual entry.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!form.gps) detectLocation(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (lines.length === 0 && step === "address") {
    return (
      <EmptyState
        title="Nothing to check out"
        description="Your cart is empty."
        action={
          <Button onClick={() => router.push("/shop/search")}>Browse</Button>
        }
      />
    );
  }

  const update = (k: keyof Address, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const fulfillment = {
    type: "Delivery" as const,
    gps: form.gps,
    areaCode: form.areaCode,
  };

  // Step 1+2: persist address, fire select, await the binding quote.
  const getQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cartBpp || !transactionId) {
      setError(
        "No active discovery session. Please search and add items again so we can quote with the seller."
      );
      setStep("error");
      return;
    }
    if (!form.name || !form.phone || !form.areaCode) {
      setError("Name, phone and pincode are required.");
      return;
    }
    if (!/^\d{10}$/.test(form.phone.trim())) {
      setError("Phone must be a 10-digit number.");
      return;
    }
    if (!/^\d{6}$/.test(form.areaCode.trim())) {
      setError("Pincode must be a 6-digit number.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Enter a valid email address or leave it blank.");
      return;
    }
    // GPS is effectively required: RET10 serviceability is usually hyperlocal
    // (radius/polygon), so without the delivery GPS the seller can't determine
    // serviceability and never returns on_select (the "no price" dead end). Ask
    // for it here rather than sending a select the seller can only drop.
    if (!form.gps?.trim()) {
      setError(
        "We need your delivery location to get a price. Tap “Use my location”, or type GPS as lat,long."
      );
      return;
    }
    if (!/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(form.gps.trim())) {
      setError("GPS must be 'lat,long', e.g. 12.9716,77.5946.");
      return;
    }
    setError(null);
    setAddress({ ...form, instructions: instructions.trim() || undefined });
    setStep("quoting");
    setStatusMsg("Requesting a quote from the seller…");
    try {
      const res = await api.select({
        transactionId,
        bppId: cartBpp.bppId,
        bppUri: cartBpp.bppUri,
        providerId: cartBpp.providerId,
        items: lines.map((l) => ({
          id: l.product.itemId,
          quantity: l.quantity,
          locationId: l.product.locationId,
        })),
        fulfillment,
      });
      if (res.status === "NACK") {
        throw new Error(res.error?.message ?? "Seller rejected the selection.");
      }
      const state = await api.waitFor(
        transactionId,
        (s) => !!s.bpps.find((b) => b.bppId === cartBpp.bppId)?.quote,
        // Poll a touch past the select `ttl` (PT30S) so a slow-but-valid
        // on_select isn't cut off early.
        { intervalMs: 2000, maxMs: 32_000, bppId: cartBpp.bppId, bppUri: cartBpp.bppUri }
      );
      const quoteRecord = state.bpps.find((b) => b.bppId === cartBpp.bppId)?.quote;
      // No quote came back within the window — almost always a stale discovery
      // session (the search that minted this transaction has aged out of the
      // seller/network). Fail clearly and send the buyer back to search rather
      // than proceeding to "review" with a misleading local estimate.
      if (!quoteRecord) {
        throw new Error(
          "The seller didn't return a price — your search may have expired. Please search again to get live prices."
        );
      }
      setQuote(parseQuote(quoteRecord));
      // Surface the seller's offered fulfillment options (Home delivery /
      // Self-Pickup / Buyer-Delivery / slotted windows) for the buyer to choose.
      const ffOptions = parseFulfillmentOptions(quoteRecord);
      setOptions(ffOptions);
      setChosenFf(
        ffOptions.find((o) => o.type === "Delivery") ?? ffOptions[0] ?? null
      );

      // Call the logistics quote endpoint for delivery fee information.
      setLogisticsLoading(true);
      const gpsParts = form.gps?.split(",").map((s) => parseFloat(s.trim())) ?? [];
      if (gpsParts.length === 2 && !isNaN(gpsParts[0]) && !isNaN(gpsParts[1])) {
        api
          .logisticsQuote({
            pickupLatitude: 12.9716,
            pickupLongitude: 77.5946,
            dropLatitude: gpsParts[0],
            dropLongitude: gpsParts[1],
            parcelSize: "SMALL",
            weightKg: 0.5,
            cod: false,
            codAmount: 0,
          })
          .then(setLogistics)
          .catch(() => setLogistics(null))
          .finally(() => setLogisticsLoading(false));
      } else {
        setLogisticsLoading(false);
      }

      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get a quote.");
      setStep("error");
    }
  };

  // Step 3+4: init (final quote) then confirm (place order).
  const placeOrder = async () => {
    if (!cartBpp || !transactionId) return;
    // Guard against a double-tap firing two init/confirm chains before the
    // "placing" re-render swaps the button out.
    if (placingRef.current) return;
    placingRef.current = true;
    setStep("placing");
    setError(null);
    try {
      setStatusMsg("Confirming delivery & final price…");
      const initRes = await api.init({
        transactionId,
        bppId: cartBpp.bppId,
        bppUri: cartBpp.bppUri,
        providerId: cartBpp.providerId,
        items: lines.map((l) => ({
          id: l.product.itemId,
          quantity: l.quantity,
          locationId: l.product.locationId,
        })),
        billing: {
          name: form.name,
          phone: form.phone,
          email: form.email,
          building: form.building,
          locality: form.locality,
          city: form.city,
          state: form.state,
          areaCode: form.areaCode,
        },
        // Bind to the buyer's chosen fulfillment option (id + type) from the
        // on_select quote — covers Self-Pickup / Buyer-Delivery / slotted.
        fulfillment: {
          ...fulfillment,
          ...(chosenFf ? { id: chosenFf.id, type: chosenFf.type as typeof fulfillment.type } : {}),
        },
        instructions: instructions.trim() || undefined,
      });
      if (initRes.status === "NACK") {
        throw new Error(initRes.error?.message ?? "Init was rejected.");
      }
      // Wait for the on_init order (its inner ONDC order object) to surface.
      const initedState = await api.waitFor(
        transactionId,
        (s) => !!s.bpps.find((b) => b.bppId === cartBpp.bppId)?.order?.order,
        // Same reasoning as select: init `ttl` is PT30S, so wait a bit past it.
        { intervalMs: 2000, maxMs: 32_000, bppId: cartBpp.bppId, bppUri: cartBpp.bppUri }
      );
      const initedOrder = initedState.bpps.find(
        (b) => b.bppId === cartBpp.bppId
      )?.order?.order;
      if (!initedOrder) {
        throw new Error(
          "The seller hasn't finalised your order yet. Please try again in a moment."
        );
      }

      setStatusMsg("Placing your order…");
      // Thread the finalized on_init order straight into confirm. The confirm
      // route accepts it in the body, so placement no longer depends on the
      // server re-reading a persisted order (which the JSON `/tmp` store may
      // hold on a different serverless instance → the "no on_init order
      // persisted" 409). We already have it here from the poll above.
      const confirmRes = await api.confirm({
        transactionId,
        bppId: cartBpp.bppId,
        bppUri: cartBpp.bppUri,
        order: initedOrder,
      });
      if (confirmRes.status === "NACK") {
        throw new Error(confirmRes.error?.message ?? "Confirm was rejected.");
      }
      const finalState = await api.waitFor(
        transactionId,
        (s) => !!s.bpps.find((b) => b.bppId === cartBpp.bppId)?.order?.orderId,
        { intervalMs: 2000, maxMs: 30_000, bppId: cartBpp.bppId, bppUri: cartBpp.bppUri }
      );

      // Open an out-of-band payment record (manual settlement model).
      const order = finalState.bpps.find((b) => b.bppId === cartBpp.bppId)?.order;
      try {
        await api.createPayment({
          transactionId,
          orderId: order?.orderId,
          amount: quote?.total ?? cartTotal,
        });
      } catch {
        /* payment record is best-effort; order is already placed */
      }

      // Remember this order locally so it appears in the Orders list (backend
      // keys orders by transactionId and has no buyer identity).
      const title =
        lines.length === 1
          ? lines[0].product.name
          : `${lines[0].product.name} +${lines.length - 1} more`;
      addOrder({
        transactionId,
        bppId: cartBpp.bppId,
        bppUri: cartBpp.bppUri,
        providerName: lines[0].product.providerName,
        title,
        total: quote?.total ?? cartTotal,
        placedAt: Date.now(),
        fulfillmentLabel: chosenFf?.category ?? chosenFf?.type,
        instructions: instructions.trim() || undefined,
      });

      clearCart();
      router.push(
        `/shop/order/${encodeURIComponent(transactionId)}/${encodeURIComponent(
          cartBpp.bppId
        )}?placed=1`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order.");
      setStep("error");
    } finally {
      placingRef.current = false;
    }
  };

  if (step === "error") {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Checkout couldn't complete"
        description={error ?? "Something went wrong with the seller."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => setStep("address")}>
              Edit details
            </Button>
            <Button variant="outline" onClick={() => router.push("/shop/search")}>
              Search again
            </Button>
            <Button onClick={() => router.push("/shop/cart")}>Back to cart</Button>
          </div>
        }
      />
    );
  }

  if (step === "quoting" || step === "placing") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">{statusMsg}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The seller responds over the ONDC network — this can take a few
          seconds.
        </p>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="space-y-4 pb-28">
        <Stepper steps={CHECKOUT_STEPS} current={1} />
        <Card className="p-4">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-primary" />
            <div className="text-sm">
              <p className="font-medium">{form.name} · {form.phone}</p>
              <p className="text-muted-foreground">
                {[form.building, form.locality, form.city, form.areaCode]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <button
              onClick={() => setStep("address")}
              className="ml-auto text-xs font-medium text-primary"
            >
              Change
            </button>
          </div>
        </Card>

        {/* Logistics delivery fee — Tocxi quote */}
        {logisticsLoading ? (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking delivery serviceability…
            </div>
          </Card>
        ) : logistics ? (
          <Card className="p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <PackageOpen className="h-4 w-4" /> Delivery fee
            </h2>
            {logistics.serviceable ? (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Logistics fee</span>
                  <span className="font-medium">₹{logistics.totalPrice.toFixed(2)}</span>
                </div>
                {logistics.codFee > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">COD fee</span>
                    <span className="font-medium">₹{logistics.codFee.toFixed(2)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance</span>
                  <span className="font-medium">{logistics.estimatedDistanceKm.toFixed(1)} km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated delivery</span>
                  <span className="font-medium">{logistics.estimatedDurationMin} min</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Delivery not available to this address.</span>
              </div>
            )}
          </Card>
        ) : null}

        {/* Fulfillment options offered by the seller (on_select) */}
        {options.length > 0 ? (
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Truck className="h-4 w-4" /> Delivery method
            </h2>
            <div className="space-y-2">
              {options.map((o) => {
                const Icon = FULFILLMENT_ICON[o.type] ?? Truck;
                const active = chosenFf?.id === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => setChosenFf(o)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-accent/40 ring-1 ring-primary"
                        : "border-border hover:bg-accent/30"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{o.category}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {o.tat ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {o.tat}
                          </span>
                        ) : null}
                        {o.slotLabel ? <span>Slot: {o.slotLabel}</span> : null}
                        {o.slotted && !o.slotLabel ? <span>Scheduled</span> : null}
                      </p>
                    </div>
                    {active ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Order summary</h2>
          <div className="space-y-1.5">
            {lines.map((l) => (
              <div
                key={l.product.itemId}
                className="flex justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {l.product.name} × {l.quantity}
                </span>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          {quote ? (
            <QuoteSummary quote={quote} />
          ) : (
            <div className="flex items-center justify-between">
              <span className="font-semibold">Estimated total</span>
              <span className="text-lg font-semibold">
                ₹{cartTotal.toFixed(2)}
              </span>
            </div>
          )}
          {quote ? (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Price confirmed by seller
            </p>
          ) : null}
        </Card>

        <div className="fixed inset-x-0 bottom-[3.25rem] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto max-w-2xl">
            <Button className="w-full" size="lg" onClick={placeOrder}>
              Place order
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // step === "address"
  return (
    <form onSubmit={getQuote} className="space-y-4 pb-28">
      <Stepper steps={CHECKOUT_STEPS} current={0} />
      <h1 className="text-lg font-semibold">Delivery details</h1>
      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name" required>
          <Input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Aaqib Abdullah"
          />
        </Field>
        <Field label="Phone" required>
          <Input
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="9876543210"
            inputMode="tel"
          />
        </Field>
        <Field label="Email" className="col-span-2">
          <Input
            value={form.email ?? ""}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@email.com"
            type="email"
          />
        </Field>
        <Field label="Flat / Building" className="col-span-2">
          <Input
            value={form.building ?? ""}
            onChange={(e) => update("building", e.target.value)}
          />
        </Field>
        <Field label="Locality / Area" className="col-span-2">
          <Input
            value={form.locality ?? ""}
            onChange={(e) => update("locality", e.target.value)}
          />
        </Field>
        <Field label="City">
          <Input
            value={form.city ?? ""}
            onChange={(e) => update("city", e.target.value)}
          />
        </Field>
        <Field label="State">
          <Input
            value={form.state ?? ""}
            onChange={(e) => update("state", e.target.value)}
          />
        </Field>
        <Field label="Pincode" required>
          <Input
            value={form.areaCode ?? ""}
            onChange={(e) => update("areaCode", e.target.value)}
            placeholder="560001"
            inputMode="numeric"
          />
        </Field>
        <Field label="Delivery location (GPS)" required className="col-span-2">
          <div className="flex gap-2">
            <Input
              value={form.gps ?? ""}
              onChange={(e) => update("gps", e.target.value)}
              placeholder="12.9716,77.5946"
              inputMode="text"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => detectLocation(false)}
              disabled={locating}
              className="shrink-0"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              {locating ? "Locating…" : "Use my location"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sellers use your exact location to check delivery — required to get a
            price.
          </p>
        </Field>
        <Field label="Delivery instructions (optional)" className="col-span-2">
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Leave at the door, call on arrival"
          />
        </Field>
      </div>

      <div className="fixed inset-x-0 bottom-[3.25rem] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto max-w-2xl">
          <Button type="submit" className="w-full" size="lg">
            Get quote &amp; continue
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
