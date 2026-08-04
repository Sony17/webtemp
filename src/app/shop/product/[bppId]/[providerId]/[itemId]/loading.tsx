// Instant navigation fallback for the PRODUCT detail page. Matches the layout
// the page renders once its catalog resolves (same skeleton it shows while
// polling), so the transition is seamless.
import { DetailSkeleton } from "@/components/shop/Skeletons";

export default function Loading() {
  return <DetailSkeleton />;
}
