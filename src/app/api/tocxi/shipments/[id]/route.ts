import { NextRequest, NextResponse } from "next/server";
import {
  getShipment as getTocxiShipment,
  cancelShipment,
} from "@/lib/tocxi/service";
import {
  getShipmentByShipmentId,
  upsertShipment,
} from "@/lib/tocxi/store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getTocxiShipment(id);

    await upsertShipment(result.shipmentId, {
      status: result.status,
      trackingUrl: result.trackingUrl,
      awbNo: result.awbNo ?? null,
      estimatedPrice: result.estimatedPrice,
      partnerReference: result.partnerReference ?? null,
      pickupContactName: (result as Record<string, unknown>).pickup
        ? ((result as Record<string, unknown>).pickup as Record<string, unknown>)?.contactName as string ?? null
        : null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Tocxi Get Shipment]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: { reason?: string } = await request.json();
    const reason = body.reason ?? "Cancelled by user";

    const result = await cancelShipment(id, reason);

    await upsertShipment(id, { status: "CANCELLED" });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Tocxi Cancel Shipment]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
