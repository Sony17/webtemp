"use client";

// Buyer-app RETURN / REPLACEMENT — drives POST /api/ondc/update in its `return`
// or `replacement` ergonomic mode. The backend derives any refund amount from
// the seller's on_cancel/on_update quote_trail, so we just collect intent.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { RotateCcw, Repeat, CheckCircle2, AlertTriangle, ImagePlus, X } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/shop/ui";
import { EmptyState, Spinner } from "@/components/shop/widgets";
import { useShopState } from "@/lib/shop/useShopState";
import * as api from "@/lib/shop/api";

const RETURN_REASONS = [
  { id: "001", label: "Item is defective / damaged" },
  { id: "002", label: "Wrong item delivered" },
  { id: "003", label: "Item does not match description" },
  { id: "004", label: "Quality not as expected" },
];

const CATEGORIES = [
  { c: "ITEM", s: "ITM01", label: "Item not received" },
  { c: "ITEM", s: "ITM02", label: "Defective / Damaged" },
  { c: "ITEM", s: "ITM03", label: "Expired / Poor quality" },
  { c: "ITEM", s: "ITM04", label: "Incorrect item" },
  { c: "ITEM", s: "ITM05", label: "Missing item / Parts" },
  { c: "FULFILLMENT", s: "FLM01", label: "Delayed delivery" },
  { c: "FULFILLMENT", s: "FLM04", label: "Package damaged" },
  { c: "PAYMENT", s: "PMT01", label: "Payment issue" },
  { c: "ORDER", s: "ORD01", label: "Order issue" },
];

export default function ReturnPage() {
  const { txn, bppId } = useParams<{ txn: string; bppId: string }>();
  const transactionId = decodeURIComponent(txn);
  const bpp = decodeURIComponent(bppId);
  const router = useRouter();

  const { state } = useShopState(transactionId, { maxMs: 6000, bppId: bpp });
  const order = state?.bpps.find((b) => b.bppId === bpp)?.order;
  const bppUri = state?.bpps.find((b) => b.bppId === bpp)?.bppUri;
  const orderId = order?.orderId;
  const fulfillments = order?.order
    ? (Array.isArray(order.order)
        ? order.order
        : typeof order.order === "object" && order.order !== null
          ? (order.order as Record<string, unknown>).fulfillments
          : undefined)
    : order?.fulfillments;
  const fulfillmentId = Array.isArray(fulfillments)
    ? (fulfillments[0] as Record<string, unknown>).id as string | undefined
    : undefined;

  const [mode, setMode] = React.useState<"return" | "replacement">("return");
  const [reasonId, setReasonId] = React.useState(RETURN_REASONS[0].id);
  const [itemId, setItemId] = React.useState("");
  const [quantity, setQuantity] = React.useState(1);
  const [cat, setCat] = React.useState(CATEGORIES[0]);
  const [photoImages, setPhotoImages] = React.useState<{ url: string; size_type?: string }[]>([]);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!state) return <Spinner label="Loading order…" />;
  if (!orderId || !bppUri) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Order not ready"
        description="This order has no confirmed order id yet, so a return can't be raised."
      />
    );
  }

  if (done) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-7 w-7" />}
        title={mode === "return" ? "Return requested" : "Replacement requested"}
        description="The seller will respond on the order. You can track it from the order page."
        action={
          <Button onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}>
            Back to order
          </Button>
        }
      />
    );
  }

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setPhotoImages((prev) => [...prev, { url, size_type: "original" }]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeImage = (idx: number) => {
    setPhotoImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        orderId,
        fulfillmentId,
        itemId: itemId.trim() || undefined,
        quantity,
        reasonId,
        category: cat.c,
        subCategory: cat.s,
      };
      const res =
        mode === "return"
          ? await api.update({
              transactionId,
              bppId: bpp,
              bppUri,
              return: {
                ...payload,
                images: photoImages.length > 0 ? photoImages.map((i) => i.url) : undefined,
              },
            })
          : await api.update({
              transactionId,
              bppId: bpp,
              bppUri,
              replacement: payload,
            });
      if (res.status === "NACK")
        throw new Error(res.error?.message ?? "Request rejected by seller.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-lg font-semibold">Return or replace</h1>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { key: "return", label: "Return", icon: RotateCcw },
            { key: "replacement", label: "Replacement", icon: Repeat },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium ${
              mode === m.key
                ? "border-primary bg-accent/40 ring-1 ring-primary"
                : "border-border"
            }`}
          >
            <m.icon className="h-4 w-4" /> {m.label}
          </button>
        ))}
      </div>

      <Card className="space-y-4 p-4">
        <div>
          <Label className="mb-1.5 block">Category</Label>
          <div className="flex flex-wrap gap-1.5">
            {["ITEM", "FULFILLMENT", "PAYMENT", "ORDER"].map((group) => {
              const items = CATEGORIES.filter((c) => c.c === group);
              return (
                <div key={group} className="w-full">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group === "ITEM"
                      ? "Item Issues"
                      : group === "FULFILLMENT"
                        ? "Delivery Issues"
                        : group === "PAYMENT"
                          ? "Payment"
                          : "Order"}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((c) => (
                      <button
                        key={c.s}
                        onClick={() => setCat(c)}
                        className={`rounded-lg border px-2.5 py-2 text-left text-sm leading-tight ${
                          cat.s === c.s
                            ? "border-primary bg-accent/40 ring-1 ring-primary"
                            : "border-border"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">Reason</Label>
          <div className="space-y-2">
            {RETURN_REASONS.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reason"
                  checked={reasonId === r.id}
                  onChange={() => setReasonId(r.id)}
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block">Item id (optional)</Label>
            <Input
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="I1"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Quantity</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>

        {mode === "return" ? (
          <div>
            <Label className="mb-1.5 block">Photos (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {photoImages.map((img, i) => (
                <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border">
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/50 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-primary">
                <ImagePlus className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={addImage}
                />
              </label>
            </div>
          </div>
        ) : null}
      </Card>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button className="w-full" size="lg" disabled={busy} onClick={submit}>
        {busy
          ? "Submitting…"
          : mode === "return"
            ? "Request return"
            : "Request replacement"}
      </Button>
    </div>
  );
}
