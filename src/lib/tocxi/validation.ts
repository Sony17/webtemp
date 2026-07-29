import type {
  ServiceabilityQuoteRequest,
  CreateShipmentRequest,
  TocxiParcelSize,
} from "./types";
import { TOCXI_PARCEL_SIZES } from "./types";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function isValidParcelSize(v: string): v is TocxiParcelSize {
  return (TOCXI_PARCEL_SIZES as readonly string[]).includes(v);
}

export function validateServiceabilityQuote(
  req: ServiceabilityQuoteRequest
): ValidationResult {
  const errors: string[] = [];

  if (typeof req.pickupLatitude !== "number") errors.push("pickupLatitude is required and must be a number");
  if (typeof req.pickupLongitude !== "number") errors.push("pickupLongitude is required and must be a number");
  if (typeof req.dropLatitude !== "number") errors.push("dropLatitude is required and must be a number");
  if (typeof req.dropLongitude !== "number") errors.push("dropLongitude is required and must be a number");
  if (typeof req.weightKg !== "number" || req.weightKg <= 0) errors.push("weightKg is required and must be a positive number");
  if (req.parcelSize && !isValidParcelSize(req.parcelSize)) errors.push(`parcelSize must be one of: ${TOCXI_PARCEL_SIZES.join(", ")}`);
  if (req.cod && (typeof req.codAmount !== "number" || req.codAmount < 0)) errors.push("codAmount is required and must be a non-negative number when cod is true");

  return { valid: errors.length === 0, errors };
}

export function validateCreateShipment(
  req: CreateShipmentRequest
): ValidationResult {
  const errors: string[] = [];

  if (!req.partnerReference || typeof req.partnerReference !== "string" || req.partnerReference.trim().length === 0) {
    errors.push("partnerReference is required");
  }

  if (!req.pickup) errors.push("pickup is required");
  else {
    if (!req.pickup.contactName?.trim()) errors.push("pickup.contactName is required");
    if (!req.pickup.contactPhone?.trim()) errors.push("pickup.contactPhone is required");
    if (!req.pickup.addressLine?.trim()) errors.push("pickup.addressLine is required");
    if (!req.pickup.pincode?.trim()) errors.push("pickup.pincode is required");
    if (typeof req.pickup.latitude !== "number") errors.push("pickup.latitude is required");
    if (typeof req.pickup.longitude !== "number") errors.push("pickup.longitude is required");
  }

  if (!req.drop) errors.push("drop is required");
  else {
    if (!req.drop.contactName?.trim()) errors.push("drop.contactName is required");
    if (!req.drop.contactPhone?.trim()) errors.push("drop.contactPhone is required");
    if (!req.drop.addressLine?.trim()) errors.push("drop.addressLine is required");
    if (!req.drop.pincode?.trim()) errors.push("drop.pincode is required");
    if (typeof req.drop.latitude !== "number") errors.push("drop.latitude is required");
    if (typeof req.drop.longitude !== "number") errors.push("drop.longitude is required");
  }

  if (req.parcelSize && !isValidParcelSize(req.parcelSize)) errors.push(`parcelSize must be one of: ${TOCXI_PARCEL_SIZES.join(", ")}`);
  if (req.weightKg !== undefined && (typeof req.weightKg !== "number" || req.weightKg <= 0)) errors.push("weightKg must be a positive number");
  if (req.declaredValue !== undefined && (typeof req.declaredValue !== "number" || req.declaredValue < 0)) errors.push("declaredValue must be a non-negative number");
  if (req.cod && (typeof req.codAmount !== "number" || req.codAmount < 0)) errors.push("codAmount is required and must be a non-negative number when cod is true");

  return { valid: errors.length === 0, errors };
}
