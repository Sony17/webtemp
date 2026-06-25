"use client";

import { Home, Briefcase, MapPin, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Address } from "@/types";

export function AddressCard({
  address,
  selectable,
  selected,
  onSelect,
  action,
}: {
  address: Address;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  action?: React.ReactNode;
}) {
  const Icon = address.label.toLowerCase() === "home" ? Home : address.label.toLowerCase() === "work" ? Briefcase : MapPin;

  return (
    <div
      onClick={selectable ? onSelect : undefined}
      className={cn(
        "rounded-xl border bg-card p-4 transition-all",
        selectable && "cursor-pointer hover:border-primary/40 hover:shadow-soft",
        selected ? "border-primary ring-1 ring-primary shadow-soft" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{address.label}</p>
            {address.isDefault && (
              <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
                Default
              </Badge>
            )}
            {selected && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {address.name} · {address.phone}
          </p>
          <p className="text-sm text-muted-foreground">
            {address.line1}, {address.line2 ? `${address.line2}, ` : ""}
            {address.city}, {address.state} — {address.pincode}
          </p>
          {action && <div className="mt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}
