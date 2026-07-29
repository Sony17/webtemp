export const TOCXI_PARCEL_SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;
export type TocxiParcelSize = (typeof TOCXI_PARCEL_SIZES)[number];

export const TOCXI_SHIPMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;
export type TocxiShipmentStatus = (typeof TOCXI_SHIPMENT_STATUSES)[number];

export type TocxiLocation = {
  contactName: string;
  contactPhone: string;
  addressLine: string;
  pincode: string;
  latitude: number;
  longitude: number;
};

export type ServiceabilityQuoteRequest = {
  pickupLatitude: number;
  pickupLongitude: number;
  dropLatitude: number;
  dropLongitude: number;
  parcelSize: TocxiParcelSize;
  weightKg: number;
  cod: boolean;
  codAmount: number;
};

export type ServiceabilityQuoteResponse = {
  serviceable: boolean;
  totalPrice: number;
  codFee: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  currency: string;
};

export type CreateShipmentRequest = {
  partnerReference: string;
  pickup: TocxiLocation;
  drop: TocxiLocation;
  packageDescription?: string;
  parcelSize?: TocxiParcelSize;
  weightKg?: number;
  declaredValue?: number;
  cod?: boolean;
  codAmount?: number;
};

export type CreateShipmentResponse = {
  shipmentId: string;
  partnerReference?: string;
  status: TocxiShipmentStatus;
  estimatedPrice: number;
  trackingUrl: string;
};

export type GetShipmentResponse = CreateShipmentResponse & {
  awbNo?: string;
  pickup?: TocxiLocation;
  drop?: TocxiLocation;
  packageDescription?: string;
  parcelSize?: TocxiParcelSize;
  weightKg?: number;
  declaredValue?: number;
  cod?: boolean;
  codAmount?: number;
  estimatedDistanceKm?: number;
  estimatedDurationMin?: number;
  codFee?: number;
  totalPrice?: number;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string;
};

export type CancelShipmentRequest = {
  reason: string;
};

export type ListShipmentsResponse = {
  content: GetShipmentResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type WebhookPayload = {
  event: "shipment.status";
  shipmentId: string;
  partnerReference?: string;
  status: TocxiShipmentStatus;
  awbNo?: string;
  timestamp: string;
};

export type TocxiApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type TocxiConfig = {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
};
