import { NextRequest, NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  isStatusTransitionAllowed,
} from "@/lib/tocxi/webhooks";
import { updateShipmentStatus, getShipmentByShipmentId } from "@/lib/tocxi/store";
import { getShipment } from "@/lib/tocxi/service";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("X-Tocxi-Signature");

    const isValid = await verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const payload = parseWebhookPayload(body);
    if (!payload) {
      return NextResponse.json(
        { error: "Unrecognized webhook event" },
        { status: 400 }
      );
    }

    const existing = await getShipmentByShipmentId(payload.shipmentId);
    if (existing && !isStatusTransitionAllowed(existing.status, payload.status)) {
      return NextResponse.json({ status: "ignored - out of order" });
    }

    await updateShipmentStatus(payload.shipmentId, payload.status, payload);

    if (payload.awbNo && existing && !existing.awbNo) {
      try {
        const remote = await getShipment(payload.shipmentId);
        await updateShipmentStatus(payload.shipmentId, payload.status, {
          ...payload,
          awbNo: remote.awbNo,
          trackingUrl: remote.trackingUrl,
          estimatedPrice: remote.estimatedPrice,
        });
      } catch {
        // best-effort
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[Tocxi Webhook]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
