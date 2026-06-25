"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Package, ShoppingBag, Copy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/format";

export function OrderSuccessClient() {
  const params = useSearchParams();
  const orderId = params.get("id") ?? "OID-2026-00000";
  const total = Number(params.get("total") ?? 0);

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-4 py-10 text-center animate-fade-in">
      {/* Success illustration */}
      <div className="relative mb-6">
        <div className="absolute inset-0 animate-ping rounded-full bg-success/20" style={{ animationDuration: "2.5s" }} />
        <div className="relative grid h-24 w-24 place-items-center rounded-full bg-success/12 text-success">
          <CheckCircle2 className="h-12 w-12" strokeWidth={2.2} />
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Order placed!</h1>
      <p className="mt-2 text-balance text-sm text-muted-foreground">
        Thank you for shopping on OpenIdea. Your order has been confirmed and the seller is getting
        it ready.
      </p>

      {/* Order id card */}
      <div className="mt-6 w-full rounded-2xl border border-border bg-card p-5 text-left shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Order ID</p>
            <p className="font-mono text-sm font-semibold">{orderId}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground">
            <Copy className="h-3.5 w-3.5" /> Copy
          </span>
        </div>
        {total > 0 && (
          <>
            <div className="my-4 h-px bg-border" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Amount paid</span>
              <span className="font-semibold tabular-nums">{formatINR(total)}</span>
            </div>
          </>
        )}
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent/40 p-3 text-xs text-accent-foreground">
          <Package className="h-4 w-4 shrink-0" />
          Estimated delivery within the seller&apos;s promised window. Track it anytime from Orders.
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 grid w-full gap-3">
        <Button asChild size="lg">
          <Link href="/orders">
            View orders <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">
            <ShoppingBag className="h-5 w-5" /> Continue shopping
          </Link>
        </Button>
      </div>
    </div>
  );
}
