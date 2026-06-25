import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatINR, formatDate, pluralize } from "@/lib/format";
import type { Order } from "@/types";

export function OrderCard({ order }: { order: Order }) {
  const preview = order.items.slice(0, 3);
  const extra = order.items.length - preview.length;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="group block rounded-xl border border-border bg-card p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{order.seller.name}</p>
          <p className="text-xs text-muted-foreground">
            {order.id} · {formatDate(order.createdAt)}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        {preview.map((item) => (
          <div
            key={item.productId}
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
          >
            <Image src={item.image} alt={item.title} fill sizes="48px" className="object-cover" />
          </div>
        ))}
        {extra > 0 && (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-secondary text-xs font-medium text-muted-foreground">
            +{extra}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-right">
          <div>
            <p className="text-sm font-semibold tabular-nums">{formatINR(order.breakup.total)}</p>
            <p className="text-xs text-muted-foreground">
              {order.items.length} {pluralize(order.items.length, "item")}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>

      {order.etaText && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs font-medium text-muted-foreground">
          {order.etaText}
        </p>
      )}
    </Link>
  );
}
