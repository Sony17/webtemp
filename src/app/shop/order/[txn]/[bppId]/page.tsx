"use client";

// Buyer-app ORDER detail + success hub. Doubles as the order-success screen
// (?placed=1) and the live order view. Polls /api/shop/state for the order's
// progression (on_confirm → on_status → on_track → on_cancel/on_update) and
// surfaces every post-order action: status refresh, track, cancel, return,
// support, rate, raise a grievance.
import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Truck,
  XCircle,
  RotateCcw,
  Headphones,
  Star,
  MessageSquareWarning,
  Copy,
  RefreshCw,
} from "lucide-react";
import { Button, Card, Badge, Separator } from "@/components/shop/ui";
import {
  EmptyState,
  QuoteSummary,
  Spinner,
  Timeline,
  RefundSummary,
} from "@/components/shop/widgets";
import { useShopState } from "@/lib/shop/useShopState";
import {
  parseQuote,
  orderState,
  trackingUrl,
  buildOrderTimeline,
  parseOrderFulfillments,
  parseRefund,
  type BppState,
} from "@/lib/shop/types";
import * as api from "@/lib/shop/api";
import { formatINR } from "@/lib/shop/cn";

const CANCEL_REASONS = [
  { id: "001", label: "Price of one or more items has changed" },
  { id: "002", label: "Item not required anymore" },
  { id: "003", label: "Order placed by mistake" },
  { id: "004", label: "Delivery time too long" },
];

export default function OrderPage() {
  const params = useParams<{ txn: string; bppId: string }>();
  const search = useSearchParams();
  const justPlaced = search.get("placed") === "1";

  const txn = decodeURIComponent(params.txn);
  const bppId = decodeURIComponent(params.bppId);

  const { state, polling, refetch } = useShopState(txn, {
    intervalMs: 4000,
    maxMs: 120_000,
    enabled: true,
    bppId,
    stopWhen: (s) => {
      const st = orderState(s.bpps.find((b) => b.bppId === bppId)?.order);
      return st === "Completed" || st === "Cancelled";
    },
  });

  const [pay, setPay] = React.useState<Awaited<
    ReturnType<typeof api.paymentInstructions>
  > | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [cancelReason, setCancelReason] = React.useState(CANCEL_REASONS[0].id);
  const [showCancel, setShowCancel] = React.useState(false);

  const bpp: BppState | undefined = state?.bpps.find((b) => b.bppId === bppId);
  const order = bpp?.order ?? null;
  const orderId = order?.orderId;
  const quote = parseQuote(order?.quote);
  const status = orderState(order);
  const track = trackingUrl(order);
  const timeline = buildOrderTimeline(order);
  const shipments = parseOrderFulfillments(order);
  const refund = parseRefund(order);

  React.useEffect(() => {
    api.paymentInstructions(txn).then(setPay).catch(() => setPay(null));
  }, [txn]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    // Snapshot the order revision before firing, then poll until the seller's
    // callback (on_status / on_track / on_cancel / on_support) actually lands —
    // instead of a fixed 1.5s guess that races a slow network.
    const beforeRev = order?.updatedAt;
    const hadSupport = !!bpp?.support;
    try {
      await fn();
      const deadline = Date.now() + 16_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await refetch();
        const b = s?.bpps.find((x) => x.bppId === bppId);
        // Order revision advanced, or support contact just arrived.
        const changed =
          b?.order?.updatedAt !== beforeRev || (!!b?.support && !hadSupport);
        if (changed || Date.now() > deadline) break;
      }
    } catch {
      /* surfaced via state polling */
    } finally {
      setBusy(null);
    }
  };

  if (!state && polling) return <Spinner label="Loading your order…" />;

  if (!order) {
    return (
      <EmptyState
        icon={<Loader2 className="h-7 w-7 animate-spin" />}
        title={justPlaced ? "Finalising your order…" : "Order not found yet"}
        description="Waiting for the seller to confirm. This view updates automatically."
      />
    );
  }

  const cancelled = status === "Cancelled";
  const completed = status === "Completed";

  return (
    <div className="space-y-4 pb-8">
      {/* Success / status banner */}
      <Card
        className={
          cancelled
            ? "border-destructive/30 bg-destructive/5 p-5"
            : "border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-900/10"
        }
      >
        <div className="flex items-center gap-3">
          {cancelled ? (
            <XCircle className="h-8 w-8 text-destructive" />
          ) : (
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          )}
          <div>
            <p className="font-semibold">
              {cancelled
                ? "Order cancelled"
                : justPlaced
                  ? "Order placed!"
                  : "Your order"}
            </p>
            <p className="text-sm text-muted-foreground">
              {orderId ? `Order #${orderId}` : "Awaiting order id…"}
            </p>
          </div>
          <Badge
            variant={cancelled ? "destructive" : completed ? "success" : "secondary"}
            className="ml-auto"
          >
            {status}
          </Badge>
        </div>
      </Card>

      {/* Live refresh row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {polling ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Live updates on
            </>
          ) : (
            "Updates paused"
          )}
        </span>
        {orderId ? (
          <button
            onClick={() =>
              act("status", () =>
                api.status({ transactionId: txn, bppId, bppUri: bpp!.bppUri, orderId })
              )
            }
            className="inline-flex items-center gap-1 font-medium text-primary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "status" ? "animate-spin" : ""}`} />
            Refresh status
          </button>
        ) : null}
      </div>

      {/* Quote */}
      {quote ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Bill details</h2>
          <QuoteSummary quote={quote} />
        </Card>
      ) : null}

      {/* Refund (RTO / cancellation / return settlement from quote_trail) */}
      {refund ? (
        <Card className="border-emerald-200 p-4 dark:border-emerald-900/40">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <RotateCcw className="h-4 w-4 text-emerald-600" /> Refund
          </h2>
          <RefundSummary refund={refund} />
        </Card>
      ) : null}

      {/* Payment instructions (manual settlement) */}
      {pay && !cancelled ? (
        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">Payment</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Pay using the reference below. Your order is reserved while payment
            settles.
          </p>
          <Row label="Amount" value={formatINR(pay.amount)} />
          <Row label="Reference" value={pay.paymentReference} copyable />
          {pay.upiId ? <Row label="UPI ID" value={pay.upiId} copyable /> : null}
          {pay.accountNumber ? (
            <>
              <Row label="A/C name" value={pay.accountName ?? "—"} />
              <Row label="A/C number" value={pay.accountNumber} copyable />
              <Row label="IFSC" value={pay.ifsc ?? "—"} />
            </>
          ) : null}
          {!pay.upiId && !pay.accountNumber ? (
            <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Seller bank/UPI details are not configured yet — contact support to
              complete payment.
            </p>
          ) : null}
          <Link
            href={`/shop/order/${encodeURIComponent(txn)}/${encodeURIComponent(
              bppId
            )}/payment`}
          >
            <Button variant="outline" className="mt-3 w-full">
              Manage payment
            </Button>
          </Link>
        </Card>
      ) : null}

      {/* Tracking */}
      {!cancelled && orderId ? (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Truck className="h-4 w-4" /> Delivery
            </h2>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "track"}
              onClick={() =>
                act("track", () =>
                  api.track({ transactionId: txn, bppId, bppUri: bpp!.bppUri, orderId })
                )
              }
            >
              {busy === "track" ? "Refreshing…" : "Track"}
            </Button>
          </div>
          {track ? (
            <a
              href={track.startsWith("http") ? track : undefined}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-sm text-primary underline-offset-2 hover:underline"
            >
              {track}
            </a>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Tracking will appear here once the seller ships your order.
            </p>
          )}
          {/* Per-shipment fulfillment status (multi-fulfillment aware) */}
          {shipments.length ? (
            <div className="mt-3 space-y-2">
              {shipments.map((f, i) => (
                <div
                  key={f.id ?? i}
                  className="rounded-lg border border-border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {shipments.length > 1 ? `Shipment ${i + 1}` : "Shipment"}
                      {f.type ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          · {f.type}
                        </span>
                      ) : null}
                    </span>
                    {f.isRTO ? (
                      <Badge variant="warning" className="ml-auto">
                        RTO
                      </Badge>
                    ) : f.state ? (
                      <Badge variant="secondary" className="ml-auto">
                        {f.state}
                      </Badge>
                    ) : null}
                  </div>
                  {f.agentName ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Agent: {f.agentName}
                    </p>
                  ) : null}
                  {f.trackingUrl ? (
                    <a
                      href={f.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-xs text-primary hover:underline"
                    >
                      Track this shipment
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Order timeline */}
      {timeline.length ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Order timeline</h2>
          <Timeline events={timeline} />
        </Card>
      ) : null}

      <Separator />

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        {!cancelled && !completed ? (
          <Button
            variant="outline"
            onClick={() => setShowCancel((s) => !s)}
            className="justify-start"
          >
            <XCircle className="h-4 w-4" /> Cancel order
          </Button>
        ) : null}
        <Link
          href={`/shop/order/${encodeURIComponent(txn)}/${encodeURIComponent(
            bppId
          )}/return`}
        >
          <Button variant="outline" className="w-full justify-start">
            <RotateCcw className="h-4 w-4" /> Return / Replace
          </Button>
        </Link>
        <Button
          variant="outline"
          className="justify-start"
          disabled={busy === "support"}
          onClick={() =>
            act("support", () =>
              api.support({
                transactionId: txn,
                bppId,
                bppUri: bpp!.bppUri,
                refId: orderId ?? txn,
              })
            )
          }
        >
          <Headphones className="h-4 w-4" /> Contact seller
        </Button>
        <Link
          href={`/shop/order/${encodeURIComponent(txn)}/${encodeURIComponent(
            bppId
          )}/issue`}
        >
          <Button variant="outline" className="w-full justify-start">
            <MessageSquareWarning className="h-4 w-4" /> Raise an issue
          </Button>
        </Link>
        {completed ? (
          <Link
            href={`/shop/order/${encodeURIComponent(txn)}/${encodeURIComponent(
              bppId
            )}/rate`}
          >
            <Button variant="outline" className="w-full justify-start">
              <Star className="h-4 w-4" /> Rate order
            </Button>
          </Link>
        ) : null}
      </div>

      {/* Support contact result */}
      {bpp?.support ? (
        (() => {
          const sup = bpp.support as {
            phone?: string;
            email?: string;
            uri?: string;
          };
          const hasAny = sup.phone || sup.email || sup.uri;
          return (
            <Card className="p-4 text-sm">
              <p className="font-medium">Seller support</p>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {sup.phone ? (
                  <p>
                    Phone:{" "}
                    <a href={`tel:${sup.phone}`} className="text-primary">
                      {sup.phone}
                    </a>
                  </p>
                ) : null}
                {sup.email ? (
                  <p>
                    Email:{" "}
                    <a href={`mailto:${sup.email}`} className="text-primary">
                      {sup.email}
                    </a>
                  </p>
                ) : null}
                {sup.uri ? (
                  <p>
                    Web:{" "}
                    <a
                      href={sup.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-primary hover:underline"
                    >
                      {sup.uri}
                    </a>
                  </p>
                ) : null}
                {!hasAny ? (
                  <p>The seller&apos;s contact details will appear here shortly.</p>
                ) : null}
              </div>
            </Card>
          );
        })()
      ) : null}

      {/* Inline cancel */}
      {showCancel ? (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Why are you cancelling?</h3>
          <div className="space-y-2">
            {CANCEL_REASONS.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cancel"
                  checked={cancelReason === r.id}
                  onChange={() => setCancelReason(r.id)}
                />
                {r.label}
              </label>
            ))}
          </div>
          <Button
            variant="destructive"
            disabled={busy === "cancel" || !orderId}
            onClick={() =>
              act("cancel", async () => {
                await api.cancel({
                  transactionId: txn,
                  bppId,
                  bppUri: bpp!.bppUri,
                  orderId: orderId!,
                  cancellationReasonId: cancelReason,
                });
                setShowCancel(false);
              })
            }
          >
            {busy === "cancel" ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium">
        {value}
        {copyable ? (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-primary"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {copied ? <span className="text-xs text-emerald-600">Copied</span> : null}
      </span>
    </div>
  );
}
