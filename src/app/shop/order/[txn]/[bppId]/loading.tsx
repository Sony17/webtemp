// Instant navigation fallback for the ORDER detail / success hub. Mirrors the
// hero CTA + timeline + quote layout the page settles into, so placing an order
// or opening one from the list paints structure immediately.
import { OrderDetailSkeleton } from "@/components/shop/Skeletons";

export default function Loading() {
  return <OrderDetailSkeleton />;
}
