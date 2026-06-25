import { notFound } from "next/navigation";
import Image from "next/image";
import { Store, MapPin, CreditCard, Truck, Clock, FileText, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { BackButton } from "@/components/BackButton";
import { Timeline } from "@/components/Timeline";
import { StatusBadge } from "@/components/StatusBadge";
import { PriceCard } from "@/components/PriceCard";
import { Rating } from "@/components/Rating";
import { Separator } from "@/components/ui/separator";
import { OrderActions } from "./OrderActions";
import { getOrderById } from "@/services/orders";
import { formatINR, formatDate, pluralize } from "@/lib/format";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) notFound();

  return (
    <PageContainer className="space-y-6">
      <BackButton label="Orders" />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{order.id}</h1>
          <p className="text-sm text-muted-foreground">
            Placed on {formatDate(order.createdAt)} · {order.items.length}{" "}
            {pluralize(order.items.length, "item")}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* ── Left: status, items, support ── */}
        <div className="space-y-6">
          {order.etaText && (
            <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-accent/40 p-3 text-sm font-medium text-accent-foreground">
              <Clock className="h-4 w-4" /> {order.etaText}
            </div>
          )}

          {/* Timeline */}
          <section id="order-status" className="scroll-mt-24 rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-4 text-sm font-semibold">Order status</h2>
            <Timeline steps={order.timeline} />
          </section>

          {/* Items */}
          <section className="rounded-xl border border-border bg-card shadow-soft">
            <h2 className="px-5 py-4 text-sm font-semibold">Items in this order</h2>
            <Separator />
            <div className="divide-y divide-border px-5">
              {order.items.map((item) => (
                <div key={item.productId} className="flex items-center gap-3 py-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                    <Image src={item.image} alt={item.title} fill sizes="56px" className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.unit ? `${item.unit} · ` : ""}Qty {item.quantity}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatINR(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Support & IGM grievance */}
          <section className="rounded-xl border border-border bg-gradient-to-br from-accent/30 to-card p-5 shadow-soft">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Need help with this order?</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Raise an issue with the seller or escalate through ONDC&apos;s Issue &amp; Grievance
                  Management (IGM). You can track resolution status end-to-end.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Protected by ONDC IGM
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                    Avg. resolution: 48 hrs
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── Right: actions, seller, delivery, payment, bill (sticky) ── */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <OrderActions order={order} />

          {/* Seller */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Store className="h-4 w-4" /> Seller
            </h2>
            <div className="flex items-center gap-3">
              {order.seller.logo && (
                <div className="relative h-11 w-11 overflow-hidden rounded-lg border border-border bg-muted">
                  <Image src={order.seller.logo} alt={order.seller.name} fill sizes="44px" className="object-cover" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{order.seller.name}</p>
                <Rating value={order.seller.rating} />
              </div>
            </div>
          </section>

          {/* Delivery info */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Truck className="h-4 w-4" /> Delivery information
            </h2>
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{order.address.label}</span> ·{" "}
                {order.address.name}
                <br />
                {order.address.line1}, {order.address.line2 ? `${order.address.line2}, ` : ""}
                {order.address.city}, {order.address.state} — {order.address.pincode}
              </p>
            </div>
          </section>

          {/* Payment */}
          <section className="rounded-xl border border-border bg-card p-5 text-sm shadow-soft">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <CreditCard className="h-4 w-4" /> Payment
            </h2>
            <p className="text-muted-foreground">
              {order.payment.method}
              {order.payment.detail ? ` · ${order.payment.detail}` : ""}
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {order.payment.status === "paid" ? "Paid" : "Payment pending"}
            </p>
          </section>

          <PriceCard breakup={order.breakup} title="Bill details" />
        </div>
      </div>
    </PageContainer>
  );
}
