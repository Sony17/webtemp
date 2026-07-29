import { NextRequest, NextResponse } from "next/server";
import {
  createShipment,
  listShipments as listTocxiShipments,
} from "@/lib/tocxi/service";
import {
  upsertShipment,
  listShipmentsFromDb,
} from "@/lib/tocxi/db";
import { validateCreateShipment } from "@/lib/tocxi/validation";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const validation = validateCreateShipment(body as Parameters<typeof validateCreateShipment>[0]);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 400 }
      );
    }

    const req = body as Parameters<typeof createShipment>[0];
    const result = await createShipment(req);

    await upsertShipment(result.shipmentId, {
      shipmentId: result.shipmentId,
      partnerReference: result.partnerReference ?? null,
      status: result.status,
      estimatedPrice: result.estimatedPrice,
      trackingUrl: result.trackingUrl,
      pickupContactName: req.pickup?.contactName ?? null,
      pickupContactPhone: req.pickup?.contactPhone ?? null,
      pickupAddressLine: req.pickup?.addressLine ?? null,
      pickupPincode: req.pickup?.pincode ?? null,
      pickupLatitude: req.pickup?.latitude ?? null,
      pickupLongitude: req.pickup?.longitude ?? null,
      dropContactName: req.drop?.contactName ?? null,
      dropContactPhone: req.drop?.contactPhone ?? null,
      dropAddressLine: req.drop?.addressLine ?? null,
      dropPincode: req.drop?.pincode ?? null,
      dropLatitude: req.drop?.latitude ?? null,
      dropLongitude: req.drop?.longitude ?? null,
      packageDescription: req.packageDescription ?? null,
      parcelSize: req.parcelSize ?? null,
      weightKg: req.weightKg ?? null,
      declaredValue: req.declaredValue ?? null,
      cod: req.cod ?? false,
      codAmount: req.codAmount ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[Tocxi Create Shipment]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "0", 10);
    const size = parseInt(searchParams.get("size") ?? "20", 10);
    const status = searchParams.get("status") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const { rows, total } = await listShipmentsFromDb({ page, size, status, search });

    return NextResponse.json({
      content: rows,
      page,
      size,
      totalElements: total,
      totalPages: Math.ceil(total / size),
    });
  } catch (err) {
    console.error("[Tocxi List Shipments]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
