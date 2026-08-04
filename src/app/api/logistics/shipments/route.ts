// Logistics shipments collection — book (POST) and list (GET).
//
//   POST /api/logistics/shipments
//     Body = { partnerReference, pickup, drop, packageDescription?,
//              parcelSize?, weightKg?, declaredValue?, cod, codAmount?,
//              transactionId? }
//     → books the shipment with Tocxi (Idempotency-Key = partnerReference),
//       persists our own ledger row, and echoes the stored record.
//
//   GET /api/logistics/shipments?status=IN_TRANSIT&limit=50
//     → { shipments: ShipmentRecord[] }  (newest first; status/limit optional)
//
// Booking is IDEMPOTENT end-to-end: partnerReference (the order id) is both the
// Tocxi Idempotency-Key AND the store's unique key, so a retry / double-fire
// never double-books nor writes a second row. We book with Tocxi FIRST (to learn
// the shipmentId / trackingUrl), then persist — a store failure after a booking
// is surfaced as 500 and safely retried, since the same key returns the same
// Tocxi shipment.
//
// Conventions: NextResponse, runtime = "nodejs", 400 on bad body, 503 when Tocxi
// is unconfigured, 502 when the upstream booking fails.
import { NextResponse } from "next/server";
import { isTocxiConfigured } from "@/lib/logistics/config";
import { createShipment as bookWithTocxi, TocxiError } from "@/lib/logistics/client";
import {
  createShipment as persistShipment,
  listShipments,
  ShipmentStoreError,
} from "@/lib/logistics/store";
import type {
  Address,
  CreateShipmentRequest,
  ParcelSize,
  ShipmentStatus,
} from "@/lib/logistics/types";
import { isShipmentStatus } from "@/lib/logistics/types";

// store.ts / client.ts are `import "server-only"` (node:fs, node:crypto, secret
// key), so this handler must run on the Node runtime.
export const runtime = "nodejs";

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isParcelSize(v: unknown): v is ParcelSize {
  return v === "SMALL" || v === "MEDIUM" || v === "LARGE";
}

// Validate a pickup/drop endpoint: contactName, contactPhone, latitude and
// longitude are required by Tocxi; addressLine and pincode are optional but
// carried through for the rider. Returns the typed Address or an error string.
function parseAddress(
  value: unknown,
  which: "pickup" | "drop"
): { ok: true; address: Address } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: `${which} is required.` };
  }
  const v = value as Record<string, unknown>;
  const contactName = str(v.contactName);
  const contactPhone = str(v.contactPhone);
  const latitude = num(v.latitude);
  const longitude = num(v.longitude);
  if (!contactName || !contactPhone) {
    return {
      ok: false,
      error: `${which}.contactName and ${which}.contactPhone are required.`,
    };
  }
  if (latitude === undefined || longitude === undefined) {
    return {
      ok: false,
      error: `${which}.latitude and ${which}.longitude are required numbers.`,
    };
  }
  return {
    ok: true,
    address: {
      contactName,
      contactPhone,
      addressLine: str(v.addressLine),
      pincode: str(v.pincode),
      latitude,
      longitude,
    },
  };
}

export async function POST(req: Request) {
  if (!isTocxiConfigured()) {
    return NextResponse.json(
      { error: "Logistics (Tocxi) is not configured." },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  // partnerReference is REQUIRED: it's the Idempotency-Key that makes booking
  // safe to retry, and the store's unique key. Without it a retry could double-
  // book — refuse rather than risk it.
  const partnerReference = str(body.partnerReference);
  if (!partnerReference) {
    return NextResponse.json(
      { error: "'partnerReference' (your order id) is required." },
      { status: 400 }
    );
  }

  const pickup = parseAddress(body.pickup, "pickup");
  if (!pickup.ok) return NextResponse.json({ error: pickup.error }, { status: 400 });
  const drop = parseAddress(body.drop, "drop");
  if (!drop.ok) return NextResponse.json({ error: drop.error }, { status: 400 });

  const cod = body.cod === true;
  const codAmount = num(body.codAmount);
  if (cod && (codAmount === undefined || codAmount < 0)) {
    return NextResponse.json(
      { error: "codAmount must be a non-negative number when cod is true." },
      { status: 400 }
    );
  }

  const parcelSize = isParcelSize(body.parcelSize) ? body.parcelSize : undefined;
  const weightKg = num(body.weightKg);
  const declaredValue = num(body.declaredValue);
  const transactionId = str(body.transactionId);

  const request: CreateShipmentRequest = {
    partnerReference,
    pickup: pickup.address,
    drop: drop.address,
    packageDescription: str(body.packageDescription),
    parcelSize,
    weightKg,
    declaredValue,
    cod,
    codAmount: cod ? codAmount : undefined,
  };

  // 1) Book with Tocxi (Idempotency-Key = partnerReference). A retry returns the
  //    same shipment, so this is safe to double-fire.
  let booked;
  try {
    booked = await bookWithTocxi(request, partnerReference);
  } catch (err) {
    if (err instanceof TocxiError) {
      console.warn("logistics.shipments create upstream error", {
        partnerReference,
        httpStatus: err.httpStatus,
        code: err.code,
      });
      return NextResponse.json(
        { error: "Tocxi booking failed", code: err.code },
        { status: 502 }
      );
    }
    console.error("logistics.shipments create fault", {
      partnerReference,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }

  // 2) Persist our own ledger row (idempotent on partnerReference). Trust Tocxi's
  //    returned status; default to PENDING if it sent an unrecognized value.
  try {
    const record = await persistShipment({
      partnerReference,
      shipmentId: booked.shipmentId,
      transactionId,
      status: isShipmentStatus(booked.status) ? booked.status : "PENDING",
      pickup: pickup.address,
      drop: drop.address,
      parcelSize,
      weightKg,
      cod,
      codAmount: cod ? codAmount : undefined,
      estimatedPrice: booked.estimatedPrice,
      trackingUrl: booked.trackingUrl,
      awbNo: booked.awbNo,
    });
    return NextResponse.json({ shipment: record }, { status: 201 });
  } catch (err) {
    const msg =
      err instanceof ShipmentStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    // The booking succeeded but we couldn't persist — surface a 500. A retry
    // re-books (idempotent, same shipmentId) and re-attempts the write.
    console.error("logistics.shipments persist fault", {
      partnerReference,
      shipmentId: booked.shipmentId,
      message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawStatus = params.get("status")?.trim();
  const status: ShipmentStatus | undefined =
    rawStatus && isShipmentStatus(rawStatus) ? rawStatus : undefined;
  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 200)
      : undefined;

  const shipments = await listShipments({ status, limit });
  return NextResponse.json(
    { shipments },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
