import { NextRequest, NextResponse } from "next/server";
import { getShipmentByPartnerReference } from "@/lib/tocxi/store";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ txn: string }> }
) {
  try {
    const { txn } = await params;
    const shipment = await getShipmentByPartnerReference(txn);

    if (!shipment) {
      return NextResponse.json({ shipment: null });
    }

    return NextResponse.json({
      shipment: {
        shipmentId: shipment.shipmentId,
        status: shipment.status,
        trackingUrl: shipment.trackingUrl,
        awbNo: shipment.awbNo,
        estimatedPrice: shipment.estimatedPrice,
        estimatedDistanceKm: shipment.estimatedDistanceKm,
        estimatedDurationMin: shipment.estimatedDurationMin,
        updatedAt: shipment.updatedAt,
        cancelledAt: shipment.cancelledAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
