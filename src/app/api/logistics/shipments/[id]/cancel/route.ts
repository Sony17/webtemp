// Cancel a logistics shipment — BEFORE pickup only.
//
//   POST /api/logistics/shipments/{id}/cancel   { "reason": "..." }
//     {id} = Tocxi shipmentId (PRCL-…) OR our partnerReference (order id).
//     → cancels with Tocxi, flips our ledger row to CANCELLED, returns the record.
//
// Tocxi rejects a cancel once a shipment has been picked up; that upstream 4xx is
// surfaced as a 409 so the caller (admin console) can show "too late to cancel"
// rather than a generic error. We only flip OUR status to CANCELLED after Tocxi
// confirms the cancellation, keeping the ledger honest.
//
// Conventions: NextResponse, runtime = "nodejs", 503 when unconfigured, 404 when
// unknown, 409 when Tocxi refuses (already picked up), 502 on other upstream
// faults.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { isTocxiConfigured } from "@/lib/logistics/config";
import { cancelShipment as cancelWithTocxi, TocxiError } from "@/lib/logistics/client";
import {
  getShipment,
  getShipmentByReference,
  updateShipmentStatus,
  type ShipmentRecord,
} from "@/lib/logistics/store";

export const runtime = "nodejs";

async function resolve(id: string): Promise<ShipmentRecord | null> {
  return (await getShipmentByReference(id)) ?? (await getShipment(id));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (!isTocxiConfigured()) {
    return NextResponse.json(
      { error: "Logistics (Tocxi) is not configured." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const record = await resolve(id);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // reason is optional in the wire contract; default to a terse one.
  let reason = "cancelled by merchant";
  try {
    const raw = (await req.json()) as { reason?: unknown };
    if (typeof raw?.reason === "string" && raw.reason.trim()) {
      reason = raw.reason.trim();
    }
  } catch {
    // empty / non-JSON body → keep the default reason
  }

  try {
    await cancelWithTocxi(record.shipmentId, reason);
  } catch (err) {
    if (err instanceof TocxiError) {
      // A 4xx (except 429, which the client already retried) means Tocxi refused
      // — most commonly "already picked up, too late to cancel". Map that to 409.
      if (
        err.httpStatus !== undefined &&
        err.httpStatus >= 400 &&
        err.httpStatus < 500
      ) {
        console.warn("logistics.cancel refused", {
          shipmentId: record.shipmentId,
          httpStatus: err.httpStatus,
          code: err.code,
        });
        return NextResponse.json(
          { error: "Cannot cancel — shipment may already be picked up.", code: err.code },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Tocxi cancel failed", code: err.code },
        { status: 502 }
      );
    }
    console.error("logistics.cancel fault", {
      shipmentId: record.shipmentId,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }

  // Tocxi confirmed the cancel — flip our ledger. shouldAdvanceStatus lets a
  // terminal CANCELLED override any non-terminal state, so this is safe even if
  // a status webhook is in flight.
  const updated = await updateShipmentStatus({
    partnerReference: record.partnerReference,
    status: "CANCELLED",
  });
  return NextResponse.json(
    { shipment: updated ?? record },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
