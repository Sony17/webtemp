import "server-only";
import { createTocxiClient } from "./client";
import type {
  ServiceabilityQuoteRequest,
  ServiceabilityQuoteResponse,
  CreateShipmentRequest,
  CreateShipmentResponse,
  GetShipmentResponse,
  ListShipmentsResponse,
  CancelShipmentRequest,
  TocxiConfig,
} from "./types";

let _config: TocxiConfig | null = null;
let _client: ReturnType<typeof createTocxiClient> | null = null;

function getConfig(): TocxiConfig {
  if (_config) return _config;
  const apiKey = process.env.TOCXI_API_KEY;
  const baseUrl = process.env.TOCXI_BASE_URL ?? "https://api.tocxi.com";
  const webhookSecret = process.env.TOCXI_WEBHOOK_SECRET ?? "";

  if (!apiKey) {
    throw new Error(
      "TOCXI_API_KEY environment variable is required for Tocxi integration"
    );
  }

  _config = { apiKey, baseUrl, webhookSecret };
  return _config;
}

function getClient() {
  if (_client) return _client;
  _client = createTocxiClient(getConfig());
  return _client;
}

export function checkServiceability(
  req: ServiceabilityQuoteRequest,
  signal?: AbortSignal
): Promise<ServiceabilityQuoteResponse> {
  return getClient().post<ServiceabilityQuoteResponse>(
    "/api/v1/partner/serviceability",
    req,
    undefined,
    signal
  );
}

export function getQuote(
  req: ServiceabilityQuoteRequest,
  signal?: AbortSignal
): Promise<ServiceabilityQuoteResponse> {
  return getClient().post<ServiceabilityQuoteResponse>(
    "/api/v1/partner/quote",
    req,
    undefined,
    signal
  );
}

export function createShipment(
  req: CreateShipmentRequest,
  signal?: AbortSignal
): Promise<CreateShipmentResponse> {
  return getClient().post<CreateShipmentResponse>(
    "/api/v1/partner/shipments",
    req,
    req.partnerReference || undefined,
    signal
  );
}

export function getShipment(
  shipmentId: string,
  signal?: AbortSignal
): Promise<GetShipmentResponse> {
  return getClient().get<GetShipmentResponse>(
    `/api/v1/partner/shipments/${encodeURIComponent(shipmentId)}`,
    signal
  );
}

export function listShipments(
  page = 0,
  size = 20,
  signal?: AbortSignal
): Promise<ListShipmentsResponse> {
  return getClient().get<ListShipmentsResponse>(
    `/api/v1/partner/shipments?page=${page}&size=${size}`,
    signal
  );
}

export function cancelShipment(
  shipmentId: string,
  reason: string,
  signal?: AbortSignal
): Promise<{ status: string }> {
  return getClient().post<{ status: string }>(
    `/api/v1/partner/shipments/${encodeURIComponent(shipmentId)}/cancel`,
    { reason } as CancelShipmentRequest,
    undefined,
    signal
  );
}

export function verifyConnection(signal?: AbortSignal): Promise<unknown> {
  return getClient().get("/api/v1/partner/me", signal);
}

export function resetTocxiConfig(): void {
  _config = null;
  _client = null;
}
