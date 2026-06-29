"use client";

// Buyer-app CHECKOUT — orchestrates the ONDC order lifecycle end-to-end:
//   select  → on_select (binding quote)
//   init    → on_init   (final quote with delivery + taxes)
//   confirm → on_confirm (order placed, order_id assigned)
// Each step is asynchronous (the seller answers via a callback), so we fire the
// action then poll /api/shop/state until the matching record lands.
import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button, Card, Input, Label, Separator } from "@/components/shop/ui";
import { EmptyState, QuoteSummary } from "@/components/shop/widgets";
import { useShop, type Address } from "@/lib/shop/store";
import { parseQuote, type ParsedQuote } from "@/lib/shop/types";
import * as api from "@/lib/shop/api";

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
  const [error, setError] = React.useState<string | null>(null);
  const [statusMsg, setStatusMsg] = React.useState("");

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
    setError(null);
    setAddress(form);
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
        { intervalMs: 2000, maxMs: 25_000 }
      );
      const q = parseQuote(
        state.bpps.find((b) => b.bppId === cartBpp.bppId)?.quote
      );
      setQuote(q);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get a quote.");
      setStep("error");
    }
  };

  // Step 3+4: init (final quote) then confirm (place order).
  const placeOrder = async () => {
    if (!cartBpp || !transactionId) return;
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
        fulfillment,
      });
      if (initRes.status === "NACK") {
        throw new Error(initRes.error?.message ?? "Init was rejected.");
      }
      await api.waitFor(
        transactionId,
        (s) => !!s.bpps.find((b) => b.bppId === cartBpp.bppId)?.order,
        { intervalMs: 2000, maxMs: 25_000 }
      );

      setStatusMsg("Placing your order…");
      const confirmRes = await api.confirm({
        transactionId,
        bppId: cartBpp.bppId,
        bppUri: cartBpp.bppUri,
      });
      if (confirmRes.status === "NACK") {
        throw new Error(confirmRes.error?.message ?? "Confirm was rejected.");
      }
      const finalState = await api.waitFor(
        transactionId,
        (s) => !!s.bpps.find((b) => b.bppId === cartBpp.bppId)?.order?.orderId,
        { intervalMs: 2000, maxMs: 30_000 }
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
    }
  };

  if (step === "error") {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Checkout couldn't complete"
        description={error ?? "Something went wrong with the seller."}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("address")}>
              Edit details
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
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Price confirmed by seller
          </p>
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
        <Field label="GPS (lat,long)">
          <Input
            value={form.gps ?? ""}
            onChange={(e) => update("gps", e.target.value)}
            placeholder="12.9716,77.5946"
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
