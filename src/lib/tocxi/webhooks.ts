import "server-only";
import type { WebhookPayload, TocxiShipmentStatus } from "./types";
import { TOCXI_SHIPMENT_STATUSES } from "./types";

function getWebhookSecret(): string {
  const secret = process.env.TOCXI_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("TOCXI_WEBHOOK_SECRET environment variable is required for webhook verification");
  }
  return secret;
}

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false;
  const { createHmac } = await import("node:crypto");
  const secret = getWebhookSecret();
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return expected === signatureHeader;
}

export function parseWebhookPayload(body: unknown): WebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;

  if (data.event !== "shipment.status") return null;
  if (typeof data.shipmentId !== "string" || !data.shipmentId) return null;
  if (!isValidStatus(data.status)) return null;

  return {
    event: "shipment.status",
    shipmentId: data.shipmentId,
    partnerReference: typeof data.partnerReference === "string" ? data.partnerReference : undefined,
    status: data.status as TocxiShipmentStatus,
    awbNo: typeof data.awbNo === "string" ? data.awbNo : undefined,
    timestamp: typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
  };
}

function isValidStatus(v: unknown): v is TocxiShipmentStatus {
  return typeof v === "string" && (TOCXI_SHIPMENT_STATUSES as readonly string[]).includes(v);
}

export function isTerminalStatus(status: TocxiShipmentStatus): boolean {
  return status === "DELIVERED" || status === "FAILED" || status === "CANCELLED";
}
