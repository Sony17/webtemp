// Instant navigation fallback for SEARCH. Shows the search-bar + grid shimmer
// for the brief chunk-load; the interactive SearchLoader radar then takes over
// the real (async, ~30s) ONDC discovery wait once the page mounts.
import { SearchResultsSkeleton } from "@/components/shop/Skeletons";

export default function Loading() {
  return <SearchResultsSkeleton />;
}
