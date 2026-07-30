import "server-only";
import { createShipment } from "@/lib/tocxi/service";
import {
  getShipmentByPartnerReference,
  upsertShipment,
} from "@/lib/tocxi/store";
import { getOrderById } from "@/lib/ondc/store";

export async function autoCreateShipment(params: {
  transactionId: string;
  orderId: string;
  amount?: number;
}): Promise<{ shipmentId: string; skipped: boolean }> {
  const { transactionId, orderId, amount } = params;

  const existing = await getShipmentByPartnerReference(transactionId);
  if (existing) {
    return { shipmentId: existing.shipmentId, skipped: true };
  }

  let dropLatitude: number | undefined;
  let dropLongitude: number | undefined;
  let dropPincode: string | undefined;
  let dropContactName: string | undefined;
  let dropContactPhone: string | undefined;
  let dropAddressLine: string | undefined;

  try {
    const orderRecord = await getOrderById(orderId);
    if (orderRecord) {
      const order = (
        orderRecord as Record<string, unknown>
      ).order as Record<string, unknown> | null;
      const fulfillments = (
        Array.isArray(order?.fulfillments) ? order.fulfillments : []
      ) as Record<string, unknown>[];
      const delivery = fulfillments.find(
        (f: Record<string, unknown>) =>
          String(f.type ?? "").toUpperCase() === "DELIVERY"
      );
      if (delivery) {
        const stop = (
          Array.isArray(delivery.stops) ? delivery.stops : []
        ).find(
          (s: Record<string, unknown>) =>
            String(s.type ?? "").toUpperCase() === "DROP" ||
            String(((s as Record<string, unknown>).location as Record<string, unknown> | undefined)?.type ?? "").toUpperCase() === "DROP"
        ) as Record<string, unknown> | undefined;
        if (stop) {
          const loc = stop.location as Record<string, unknown> | undefined;
          if (loc) {
            const gpsStr = String(loc.gps ?? "");
            const parts = gpsStr.split(",");
            if (parts.length === 2) {
              dropLatitude = parseFloat(parts[0].trim());
              dropLongitude = parseFloat(parts[1].trim());
            }
            dropPincode = String(loc.area_code ?? "") || undefined;
            dropAddressLine = String(loc.address ?? "") || undefined;
          }
          const contact = stop.contact as Record<string, unknown> | undefined;
          if (contact) {
            dropContactName = String(contact.name ?? "") || undefined;
            dropContactPhone = String(contact.phone ?? "") || undefined;
          }
        }
      }
    }
  } catch {
    // best-effort — proceed with minimal data
  }

  const pickupLatitude = 12.9716;
  const pickupLongitude = 77.5946;

  const result = await createShipment({
    partnerReference: transactionId,
    pickup: {
      contactName: "Warehouse",
      contactPhone: "9999999999",
      addressLine: "Default Warehouse",
      pincode: "560001",
      latitude: pickupLatitude,
      longitude: pickupLongitude,
    },
    drop: {
      contactName: dropContactName ?? "Buyer",
      contactPhone: dropContactPhone ?? "9999999999",
      addressLine: dropAddressLine ?? "Buyer Address",
      pincode: dropPincode ?? "560001",
      latitude: dropLatitude ?? 12.9716,
      longitude: dropLongitude ?? 77.5946,
    },
    declaredValue: amount,
  });

  await upsertShipment(result.shipmentId, {
    shipmentId: result.shipmentId,
    partnerReference: transactionId,
    status: result.status,
    estimatedPrice: result.estimatedPrice,
    trackingUrl: result.trackingUrl,
    dropLatitude: dropLatitude ?? null,
    dropLongitude: dropLongitude ?? null,
    dropPincode: dropPincode ?? null,
    dropContactName: dropContactName ?? null,
    dropContactPhone: dropContactPhone ?? null,
    dropAddressLine: dropAddressLine ?? null,
    declaredValue: amount ?? null,
  });

  return { shipmentId: result.shipmentId, skipped: false };
}
