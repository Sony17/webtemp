"use client";

// Buyer-facing courier tracking (roadmap T-21).
//
// Renders the live status of the last-mile Tocxi shipment booked for THIS order,
// read from our own ledger (GET /api/logistics/shipments/{id}) — never a call to
// Tocxi on render. The status advances as inbound webhooks land; a light poll +
// a manual refresh keep the view current while the shipment is in flight.
//
// It is deliberately INVISIBLE when no courier shipment exists for the order
// (the common case unless an admin booked one), so it can sit unconditionally on
// the order page without cluttering orders that have none. Distinct from the
// ONDC seller-fulfillment "Delivery" card above it — this is our own courier leg.
import * as React from "react";
import { Truck, RefreshCw, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { Card, Badge, Button } from "@/components/shop/ui";
import type { ShipmentStatus } from "@/lib/logistics/types";

type StatusEvent = { status: ShipmentStatus; at: number; eventTimestamp?: string };
type Shipment = {
  partnerReference: string;
  shipmentId: string;
  status: ShipmentStatus;
  trackingUrl?: string;
  awbNo?: string;
  cod: boolean;
  codAmount?: number;
  estimatedPrice?: number;
  statusHistory: StatusEvent[];
};

// The happy-path steps, in order, with buyer-friendly labels.
const STEPS: { status: ShipmentStatus; label: string }[] = [
  { status: "PENDING", label: "Booked" },
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "PICKED_UP", label: "Picked up" },
  { status: "IN_TRANSIT", label: "In transit" },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { status: "DELIVERED", label: "Delivered" },
];

function isTerminal(s: ShipmentStatus): boolean {
  return s === "DELIVERED" || s === "CANCELLED" || s === "FAILED";
}

function badgeVariant(s: ShipmentStatus): "success" | "destructive" | "secondary" {
  if (s === "DELIVERED") return "success";
  if (s === "CANCELLED" || s === "FAILED") return "destructive";
  return "secondary";
}

// A one-line, human hint for the current state.
function hintFor(s: ShipmentStatus): string {
  switch (s) {
    case "PENDING":
      return "Courier booked — assigning a rider.";
    case "CONFIRMED":
      return "A rider has been assigned.";
    case "PICKED_UP":
      return "Picked up from the store.";
    case "IN_TRANSIT":
      return "On the way.";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery — arriving soon.";
    case "DELIVERED":
      return "Delivered. Enjoy!";
    case "CANCELLED":
      return "This delivery was cancelled.";
    case "FAILED":
      return "Delivery could not be completed — contact support.";
    default:
      return "";
  }
}

function inr(n?: number): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CourierTracking({
  txn,
  orderId,
}: {
  txn: string;
  orderId?: string;
}) {
  const [shipment, setShipment] = React.useState<Shipment | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  // Stop polling once terminal — a delivered/cancelled shipment won't change.
  const doneRef = React.useRef(false);

  // Try the order id first (if known), then the txn — either resolves the same
  // shipment via the route's multi-key lookup. First hit wins.
  const load = React.useCallback(async () => {
    const candidates = [orderId, txn].filter((x): x is string => !!x);
    for (const id of candidates) {
      try {
        const res = await fetch(
          `/api/logistics/shipments/${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        if (!res.ok) continue; // 404 for this handle → try the next
        const data = (await res.json()) as { shipment?: Shipment };
        if (data.shipment) {
          setShipment(data.shipment);
          doneRef.current = isTerminal(data.shipment.status);
          return;
        }
      } catch {
        /* network hiccup — keep the current view, retry next tick */
      }
    }
  }, [orderId, txn]);

  React.useEffect(() => {
    // Legitimate data-load effect: load() only setStates AFTER an awaited fetch,
    // never synchronously during commit — the documented exception the rule is
    // too coarse to see (same rationale as the shop admin dashboard's loaders).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const iv = setInterval(() => {
      if (!doneRef.current) void load();
    }, 12_000);
    return () => clearInterval(iv);
  }, [load]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Nothing booked (or still loading the first time) → render nothing.
  if (!shipment) return null;

  const exception =
    shipment.status === "CANCELLED" || shipment.status === "FAILED";
  const currentIndex = STEPS.findIndex((s) => s.status === shipment.status);
  // Furthest happy-path step reached (from history), so an exception still shows
  // how far it got before failing/cancelling.
  const reachedIndex = shipment.statusHistory.reduce(
    (m, e) => Math.max(m, STEPS.findIndex((s) => s.status === e.status)),
    currentIndex
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="h-4 w-4" /> Courier delivery
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant(shipment.status)}>{shipment.status}</Badge>
          <button
            onClick={manualRefresh}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh courier status"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Progress stepper (happy path). An exception is shown as a banner below. */}
      {!exception ? (
        <ol className="mt-4 flex items-center">
          {STEPS.map((step, i) => {
            const done = i <= reachedIndex;
            const current = i === currentIndex;
            return (
              <li key={step.status} className="flex flex-1 items-center last:flex-none">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                    done
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  } ${current ? "ring-2 ring-primary/30" : ""}`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {i < STEPS.length - 1 ? (
                  <span
                    className={`mx-1 h-0.5 flex-1 rounded ${
                      i < reachedIndex ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          {hintFor(shipment.status)}
        </div>
      )}

      <p className="mt-3 text-sm font-medium">
        {STEPS.find((s) => s.status === shipment.status)?.label ?? shipment.status}
      </p>
      {!exception ? (
        <p className="text-xs text-muted-foreground">{hintFor(shipment.status)}</p>
      ) : null}

      {shipment.trackingUrl ? (
        <a
          href={shipment.trackingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block"
        >
          <Button size="sm" variant="outline">
            <ExternalLink className="h-3.5 w-3.5" /> Track shipment
          </Button>
        </a>
      ) : null}

      {/* Meta: AWB / COD / shipment id — small and muted. */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {shipment.awbNo ? <span>AWB {shipment.awbNo}</span> : null}
        {shipment.cod ? <span>COD {inr(shipment.codAmount)}</span> : null}
        <span className="font-mono">{shipment.shipmentId}</span>
      </div>
    </Card>
  );
}
