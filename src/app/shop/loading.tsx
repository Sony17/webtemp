// Instant navigation fallback for the buyer-app HOME. Rendered immediately by
// Next's Suspense boundary while the route segment streams in, so navigation
// never lands on a blank screen. Reuses the shared shimmer skeleton.
import { HomeSkeleton } from "@/components/shop/Skeletons";

export default function Loading() {
  return <HomeSkeleton />;
}
