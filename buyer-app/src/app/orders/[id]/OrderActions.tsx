"use client";

import { Headset, Navigation, MessageSquare, Phone, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Order } from "@/types";

export function OrderActions({ order }: { order: Order }) {
  const canTrack = order.status !== "delivered" && order.status !== "cancelled";
  const hasLiveUrl = Boolean(order.trackingUrl && order.trackingUrl !== "#");

  return (
    <div className="flex flex-col gap-3">
      {canTrack &&
        (hasLiveUrl ? (
          <Button asChild size="lg" className="w-full">
            <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-5 w-5" /> Track order
            </a>
          </Button>
        ) : (
          // No live tracking URL yet — link to the in-page status timeline (no dead link).
          <Button asChild size="lg" className="w-full">
            <a href="#order-status">
              <Navigation className="h-5 w-5" /> Track order
            </a>
          </Button>
        ))}

      {/* Support — ONDC has both lightweight support and structured IGM grievances. */}
      <Dialog>
        <DialogTrigger asChild>
          <Button size="lg" variant="outline" className="w-full">
            <Headset className="h-5 w-5" /> Get support
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Support for {order.id}</DialogTitle>
            <DialogDescription>
              Reach the seller or raise a formal grievance on the network.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {[
              { icon: MessageSquare, label: "Chat with seller", detail: order.seller.name },
              { icon: Phone, label: "Call support", detail: "Mon–Sat, 9 AM – 9 PM" },
              { icon: FileText, label: "Raise a grievance (IGM)", detail: "Track via Issue & Grievance Management" },
            ].map(({ icon: Icon, label, detail }) => (
              <button
                key={label}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
