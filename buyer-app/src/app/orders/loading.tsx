import { PageContainer } from "@/components/layout/PageContainer";
import { ListSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="narrow" className="space-y-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-11 w-full rounded-full" />
      <ListSkeleton count={4} />
    </PageContainer>
  );
}
