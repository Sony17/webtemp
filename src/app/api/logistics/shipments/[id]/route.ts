// Single logistics shipment — read our stored record.
//
//   GET /api/logistics/shipments/{id}
//     {id} = the Tocxi shipmentId (PRCL-…) OR our partnerReference (order id) —
//            either resolves the same shipment.
//     ?refresh=1 → also re-pull the live status from Tocxi and fold it into our
//                  ledger before returning (default reads our own row, which
//                  webhooks keep current — no upstream call).
//     → { shipment: ShipmentRecord } | 404
//
// The buyer order page and admin console read through here, so by default it is
// a pure store read (webhooks are the source of truth for status). The optional
// refresh is a manual reconcile for when a webhook was missed.
//
// Cancellation lives at the sub-route POST /api/logistics/shipments/{id}/cancel
// (mirrors Tocxi's own endpoint shape), not here.
import { NextResponse } from "next/server";
import { isTocxiConfigured } from "@/lib/logistics/config";
import { getShipment as getFromTocxi, TocxiError } from "@/lib/logistics/client";
import {
  getShipment,
  getShipmentByReference,
  getShipmentByTransaction,
  updateShipmentStatus,
  type ShipmentRecord,
} from "@/lib/logistics/store";
import { isShipmentStatus } from "@/lib/logistics/types";

export const runtime = "nodejs";

// Resolve a stored shipment by any handle: partnerReference (order id) first,
// then Tocxi shipmentId, then the ONDC transaction id — so the buyer order page
// can look it up by the txn in its URL. Returns null when none matches.
async function resolve(id: string): Promise<ShipmentRecord | null> {
  return (
    (await getShipmentByReference(id)) ??
    (await getShipment(id)) ??
    (await getShipmentByTransaction(id))
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = await resolve(id);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const refresh =
    new URL(req.url).searchParams.get("refresh") === "1" && isTocxiConfigured();
  if (!refresh) {
    return NextResponse.json(
      { shipment: record },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Optional live reconcile: pull Tocxi's current status and advance our ledger
  // (idempotent — a no-op if it's not actually newer). A refresh failure is
  // non-fatal; we still return our stored row.
  try {
    const live = await getFromTocxi(record.shipmentId);
    if (isShipmentStatus(live.status)) {
      const updated = await updateShipmentStatus({
        partnerReference: record.partnerReference,
        status: live.status,
        awbNo: live.awbNo,
      });
      return NextResponse.json(
        { shipment: updated ?? record },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch (err) {
    console.warn("logistics.shipment refresh failed", {
      shipmentId: record.shipmentId,
      httpStatus: err instanceof TocxiError ? err.httpStatus : undefined,
    });
  }
  return NextResponse.json(
    { shipment: record },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
