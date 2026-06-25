import Link from "next/link";
import { Truck, Headset, ShoppingBag, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { OrdersClient } from "./OrdersClient";
import { Button } from "@/components/ui/button";
import { getOrders } from "@/services/orders";

export default async function OrdersPage() {
  const orders = await getOrders();
  const active = orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled").length;

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Your Orders</h1>
        <p className="text-sm text-muted-foreground">Track current orders and revisit past ones.</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <OrdersClient orders={orders} />

        {/* Desktop helper rail */}
        <aside className="hidden space-y-4 lg:block">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-accent/40 to-card p-5 shadow-soft">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-semibold tabular-nums leading-none">{active}</p>
                <p className="text-xs text-muted-foreground">active {active === 1 ? "delivery" : "deliveries"}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              We&apos;ll keep this updated as your orders move through the network.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary">
              <Headset className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-sm font-semibold">Need help with an order?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Open any order to chat with the seller or raise an ONDC grievance (IGM).
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <h3 className="text-sm font-semibold">Looking for something?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Discover more across thousands of sellers on the network.
            </p>
            <Button asChild size="sm" className="mt-3 w-full">
              <Link href="/search">
                <ShoppingBag className="h-4 w-4" /> Continue shopping
              </Link>
            </Button>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Orders protected by ONDC IGM
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}
