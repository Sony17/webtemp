import { PageContainer } from "@/components/layout/PageContainer";
import { DetailSkeleton } from "@/components/LoadingSkeleton";

export default function Loading() {
  return (
    <PageContainer>
      <DetailSkeleton />
    </PageContainer>
  );
}
