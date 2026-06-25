import { Suspense } from "react";
import { OrderSuccessClient } from "./OrderSuccessClient";

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={null}>
      <OrderSuccessClient />
    </Suspense>
  );
}
