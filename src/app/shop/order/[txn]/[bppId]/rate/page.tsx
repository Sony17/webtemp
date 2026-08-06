"use client";

// Buyer-app RATING — submits star ratings per ONDC rating category via
// POST /api/ondc/rating. The seller may return a feedback form on on_rating.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Star, CheckCircle2 } from "lucide-react";
import { Button, Card } from "@/components/shop/ui";
import { EmptyState, Spinner } from "@/components/shop/widgets";
import { useShopState } from "@/lib/shop/useShopState";
import { useShop } from "@/lib/shop/store";
import * as api from "@/lib/shop/api";

const CATS = [
  { id: "Order", label: "Overall order" },
  { id: "Fulfillment", label: "Delivery" },
  { id: "Provider", label: "Seller" },
];

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star`}>
          <Star
            className={`h-7 w-7 ${
              n <= value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export default function RatePage() {
  const { txn, bppId } = useParams<{ txn: string; bppId: string }>();
  const transactionId = decodeURIComponent(txn);
  const bpp = decodeURIComponent(bppId);
  const router = useRouter();

  const { state } = useShopState(transactionId, { maxMs: 6000, bppId: bpp });
  const bppState = state?.bpps.find((b) => b.bppId === bpp);
  const bppUri = bppState?.bppUri;
  const { orders } = useShop();
  const orderDomain = orders.find(
    (o) => o.transactionId === transactionId && o.bppId === bpp
  )?.domain;
  const orderId = bppState?.order?.orderId;

  const [values, setValues] = React.useState<Record<string, number>>({
    Order: 5,
    Fulfillment: 5,
    Provider: 5,
  });
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!state) return <Spinner label="Loading…" />;
  if (!bppUri) {
    return (
      <EmptyState
        title="Order not ready"
        description="You can rate once the order is confirmed."
      />
    );
  }
  if (done) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-7 w-7" />}
        title="Thanks for your feedback!"
        action={
          <Button onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}>
            Back to order
          </Button>
        }
      />
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.rating({
        transactionId,
        bppId: bpp,
        bppUri,
        domain: orderDomain,
        ratings: CATS.map((c) => ({
          id: orderId ?? transactionId,
          ratingCategory: c.id,
          value: values[c.id],
        })),
      });
      if (res.status === "NACK")
        throw new Error(res.error?.message ?? "Rating rejected.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit rating.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-lg font-semibold">Rate your order</h1>
      <div className="space-y-3">
        {CATS.map((c) => (
          <Card key={c.id} className="flex items-center justify-between p-4">
            <span className="text-sm font-medium">{c.label}</span>
            <Stars
              value={values[c.id]}
              onChange={(v) => setValues((s) => ({ ...s, [c.id]: v }))}
            />
          </Card>
        ))}
      </div>
      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button className="w-full" size="lg" disabled={busy} onClick={submit}>
        {busy ? "Submitting…" : "Submit rating"}
      </Button>
    </div>
  );
}
