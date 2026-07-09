// ONDC admin dashboard data — READ-ONLY roll-up for /shop/admin.
//
//   GET /api/shop/admin/summary
//     → { counts: { transactions, orders, payments:{pending,paid,total},
//                   issues:{total,open} },
//         orders: [...recent],   issues: [...recent] }
//
// Reads the shared ONDC + payment stores (Postgres in prod), so figures are
// complete across instances. Ungated server-side, matching the app's existing
// admin posture — the /shop/admin page guards client-side via the admin login.
import { NextResponse } from "next/server";
import * as store from "@/lib/ondc/store";
import { listPayments } from "@/lib/payments/store";
import type { OrderRecord, IssueRecord } from "@/lib/ondc/store";

export const runtime = "nodejs";

// Total from the opaque ONDC quote (quote.price.value), best-effort.
function orderAmount(o: OrderRecord): number | undefined {
  const q =
    (o.quote as { price?: { value?: unknown } } | undefined) ??
    ((o.order as { quote?: { price?: { value?: unknown } } } | undefined)?.quote);
  const v = q?.price?.value;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// Human state string from the order's state (string | {descriptor.name}) or stage.
function orderStateStr(o: OrderRecord): string {
  const s = o.state;
  if (typeof s === "string") return s;
  const name = (s as { descriptor?: { name?: unknown } } | undefined)?.descriptor
    ?.name;
  return typeof name === "string" ? name : o.stage;
}

const CLOSED_ISSUE = new Set(["CLOSED", "RESOLVED"]);

export async function GET() {
  const [orders, issues, transactions, payments] = await Promise.all([
    store.listOrders(),
    store.listIssues(),
    store.countTransactions(),
    listPayments(),
  ]);

  const pending = payments.filter((p) => p.status === "PENDING").length;
  const openIssues = issues.filter(
    (i: IssueRecord) => !CLOSED_ISSUE.has(i.status)
  ).length;

  return NextResponse.json(
    {
      counts: {
        transactions,
        orders: orders.length,
        payments: { pending, paid: payments.length - pending, total: payments.length },
        issues: { total: issues.length, open: openIssues },
      },
      orders: orders.map((o) => ({
        transactionId: o.transactionId,
        bppId: o.bppId,
        orderId: o.orderId ?? null,
        stage: o.stage,
        state: orderStateStr(o),
        amount: orderAmount(o) ?? null,
        updatedAt: o.updatedAt,
      })),
      issues: issues.map((i) => ({
        issueId: i.issueId,
        transactionId: i.transactionId,
        bppId: i.bppId,
        orderId: i.orderId ?? null,
        category: i.category ?? null,
        status: i.status,
        updatedAt: i.updatedAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
