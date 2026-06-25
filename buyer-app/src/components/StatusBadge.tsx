import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/types";
import {
  CheckCircle2,
  Package,
  Truck,
  Bike,
  XCircle,
  Clock,
} from "lucide-react";

const config: Record<
  OrderStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "accent" | "muted"; Icon: typeof Clock }
> = {
  confirmed: { label: "Confirmed", variant: "accent", Icon: Clock },
  packed: { label: "Packed", variant: "accent", Icon: Package },
  shipped: { label: "Shipped", variant: "warning", Icon: Truck },
  out_for_delivery: { label: "Out for Delivery", variant: "warning", Icon: Bike },
  delivered: { label: "Delivered", variant: "success", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "destructive", Icon: XCircle },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, variant, Icon } = config[status];
  return (
    <Badge variant={variant} className="px-2.5 py-1">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Badge>
  );
}
