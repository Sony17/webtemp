"use client";

import * as React from "react";
import { MapPin, ChevronDown, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SAVED_LOCATIONS = [
  { id: "home", label: "Home · Koramangala", pincode: "560034" },
  { id: "work", label: "Work · Bellandur", pincode: "560103" },
  { id: "indiranagar", label: "Indiranagar", pincode: "560038" },
];

export function DeliveryLocation({ variant = "pill" }: { variant?: "pill" | "inline" }) {
  const [current, setCurrent] = React.useState(SAVED_LOCATIONS[0]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 text-left transition-colors hover:text-primary",
            variant === "pill" &&
              "rounded-full border border-border bg-card px-3 py-1.5 shadow-soft"
          )}
        >
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              Deliver to
            </span>
            <span className="flex items-center gap-1 text-sm font-medium">
              <span className="max-w-[10rem] truncate">{current.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </span>
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose delivery location</DialogTitle>
          <DialogDescription>
            Catalog, sellers and ETAs are shown for your selected location.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {SAVED_LOCATIONS.map((loc) => (
            <DialogClose asChild key={loc.id}>
              <button
                type="button"
                onClick={() => setCurrent(loc)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary/40",
                  current.id === loc.id ? "border-primary bg-accent/40" : "border-border"
                )}
              >
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">
                  <span className="block font-medium">{loc.label}</span>
                  <span className="text-xs text-muted-foreground">Pincode {loc.pincode}</span>
                </span>
                {current.id === loc.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            </DialogClose>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
