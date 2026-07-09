// Payment list — powers the admin reconcile console.
//
//   GET /api/payments/list?status=PENDING|PAID   (status optional → all)
//     → { payments: PaymentRecord[] }  (newest first)
//
// Reads through the payment store DISPATCHER, so on production (DATABASE_URL set)
// it returns the COMPLETE, shared list from Postgres — not a per-instance /tmp
// slice. Marking a payment paid is the existing POST /api/payments/reconcile.
//
// NOTE: ungated, matching the app's existing admin-API posture (the console page
// itself is guarded client-side by the admin login). Demo-grade — see the admin
// login (admin/admin). Harden with real auth before production.
import { NextResponse } from "next/server";
import { listPayments } from "@/lib/payments/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("status")?.trim();
  const status: "PENDING" | "PAID" | undefined =
    raw === "PENDING" || raw === "PAID" ? raw : undefined;

  const payments = await listPayments(status ? { status } : undefined);
  return NextResponse.json(
    { payments },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
