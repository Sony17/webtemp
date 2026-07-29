import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type TocxiShipmentWhereInput = Prisma.TocxiShipmentWhereInput;

function getDb() {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required for Tocxi shipment persistence");
  }
  return getPrisma();
}

export type TocxiShipmentRow = {
  id: string;
  shipmentId: string;
  partnerReference: string | null;
  status: string;
  estimatedPrice: number | null;
  trackingUrl: string | null;
  awbNo: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupAddressLine: string | null;
  pickupPincode: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropContactName: string | null;
  dropContactPhone: string | null;
  dropAddressLine: string | null;
  dropPincode: string | null;
  dropLatitude: number | null;
  dropLongitude: number | null;
  packageDescription: string | null;
  parcelSize: string | null;
  weightKg: number | null;
  declaredValue: number | null;
  cod: boolean;
  codAmount: number | null;
  estimatedDistanceKm: number | null;
  estimatedDurationMin: number | null;
  codFee: number | null;
  totalPrice: number | null;
  lastWebhookEvent: string | null;
  lastWebhookPayload: unknown;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
};

export async function upsertShipment(
  shipmentId: string,
  data: Record<string, unknown>
): Promise<TocxiShipmentRow> {
  return getDb().tocxiShipment.upsert({
    where: { shipmentId },
    create: {
      shipmentId,
      ...data,
    } as Prisma.TocxiShipmentCreateInput,
    update: data as Prisma.TocxiShipmentUpdateInput,
  }) as unknown as TocxiShipmentRow;
}

export async function getShipmentByShipmentId(
  shipmentId: string
): Promise<TocxiShipmentRow | null> {
  return getDb().tocxiShipment.findUnique({
    where: { shipmentId },
  }) as unknown as TocxiShipmentRow | null;
}

export async function listShipmentsFromDb(options: {
  page?: number;
  size?: number;
  status?: string;
  search?: string;
} = {}): Promise<{ rows: TocxiShipmentRow[]; total: number }> {
  const page = options.page ?? 0;
  const size = options.size ?? 20;
  const where: Record<string, unknown> = {};

  if (options.status) {
    where.status = options.status;
  }
  if (options.search) {
    where.OR = [
      { shipmentId: { contains: options.search, mode: "insensitive" } },
      { partnerReference: { contains: options.search, mode: "insensitive" } },
    ] as Prisma.TocxiShipmentWhereInput["OR"];
  }

  const [rows, total] = await Promise.all([
    getDb().tocxiShipment.findMany({
      where: where as Prisma.TocxiShipmentWhereInput,
      orderBy: { createdAt: "desc" },
      skip: page * size,
      take: size,
    }),
    getDb().tocxiShipment.count({ where: where as Prisma.TocxiShipmentWhereInput }),
  ]);

  return {
    rows: rows as unknown as TocxiShipmentRow[],
    total,
  };
}

export async function updateShipmentStatus(
  shipmentId: string,
  status: string,
  webhookPayload?: Record<string, unknown>
): Promise<TocxiShipmentRow> {
  const data: Record<string, unknown> = { status };
  if (webhookPayload) {
    data.lastWebhookPayload = webhookPayload as Prisma.InputJsonValue;
    data.lastWebhookEvent = webhookPayload.event as string;
  }
  return upsertShipment(shipmentId, data);
}

export async function deleteShipmentsByShipmentId(
  shipmentId: string
): Promise<void> {
  await getDb().tocxiShipment.deleteMany({
    where: { shipmentId },
  });
}
