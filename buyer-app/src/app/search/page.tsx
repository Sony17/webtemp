import { Suspense } from "react";
import { SearchClient } from "./SearchClient";
import { PageContainer } from "@/components/layout/PageContainer";
import { ProductGridSkeleton } from "@/components/LoadingSkeleton";

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <ProductGridSkeleton count={10} className="lg:grid-cols-4 xl:grid-cols-5" />
        </PageContainer>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
