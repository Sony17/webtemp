"use client";

// Buyer-app ORDERS list. Reads the device-local order refs (the backend has no
// buyer identity) and links each to its live detail view. Newest first.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Package, ChevronRight } from "lucide-react";
import { Button, Card } from "@/components/shop/ui";
import { EmptyState } from "@/components/shop/widgets";
import { useShop } from "@/lib/shop/store";
import { formatINR } from "@/lib/shop/cn";

export default function OrdersPage() {
  const router = useRouter();
  const { orders } = useShop();

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-7 w-7" />}
        title="No orders yet"
        description="Orders you place will show up here with live status."
        action={
          <Button onClick={() => router.push("/shop/search")}>
            Start shopping
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Your orders</h1>
      {orders.map((o) => (
        <Link
          key={`${o.transactionId}:${o.bppId}`}
          href={`/shop/order/${encodeURIComponent(
            o.transactionId
          )}/${encodeURIComponent(o.bppId)}`}
        >
          <Card className="flex items-center gap-3 p-4">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent/60 text-primary">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{o.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {o.providerName} ·{" "}
                {new Date(o.placedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{formatINR(o.total)}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Card>
        </Link>
      ))}
    </div>
  );
}
