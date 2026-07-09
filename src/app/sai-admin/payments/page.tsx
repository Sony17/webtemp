// The payment reconcile console moved into the ONDC admin dashboard.
// Keep this path working by redirecting to its new home.
import { redirect } from "next/navigation";

export default function RetiredPaymentsPage() {
  redirect("/shop/admin");
}
