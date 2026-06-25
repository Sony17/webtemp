"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Search, PackageOpen, X } from "lucide-react";
import { OrderCard } from "@/components/OrderCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

const STATUS_FILTERS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function matches(order: Order, q: string) {
  if (!q) return true;
  const t = q.toLowerCase();
  return (
    order.id.toLowerCase().includes(t) ||
    order.seller.name.toLowerCase().includes(t) ||
    order.items.some((i) => i.title.toLowerCase().includes(t))
  );
}

function OrderList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No matching orders"
        description="Try a different search or status filter."
      />
    );
  }
  return (
    <motion.div layout className="space-y-3">
      <AnimatePresence initial={false}>
        {orders.map((o) => (
          <motion.div
            key={o.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
          >
            <OrderCard order={o} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

export function OrdersClient({ orders }: { orders: Order[] }) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<OrderStatus | "all">("all");

  const filtered = orders.filter(
    (o) => matches(o, q) && (status === "all" || o.status === status)
  );
  const current = filtered.filter((o) => o.status !== "delivered" && o.status !== "cancelled");
  const past = filtered.filter((o) => o.status === "delivered" || o.status === "cancelled");

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by order ID, seller or item"
          aria-label="Search orders"
          className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-10 text-sm shadow-soft outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cn(
              "whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              status === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/40"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Tabs defaultValue="current">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="current" className="flex-1 sm:flex-none">
            Current ({current.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex-1 sm:flex-none">
            Past ({past.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current">
          {current.length === 0 && !q && status === "all" ? (
            <EmptyState
              icon={PackageOpen}
              title="No active orders"
              description="When you place an order, you'll be able to track it here."
              action={
                <Button asChild>
                  <Link href="/search">Start shopping</Link>
                </Button>
              }
            />
          ) : (
            <OrderList orders={current} />
          )}
        </TabsContent>

        <TabsContent value="past">
          <OrderList orders={past} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
