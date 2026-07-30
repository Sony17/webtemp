import "server-only";

export type { TocxiShipmentRecord } from "@/lib/tocxi/store-json";

import { isDatabaseConfigured } from "@/lib/db";
import * as jsonBackend from "@/lib/tocxi/store-json";
import * as dbBackend from "@/lib/tocxi/db";

const backend = isDatabaseConfigured() ? dbBackend : jsonBackend;

export const upsertShipment = backend.upsertShipment;
export const getShipmentByShipmentId = backend.getShipmentByShipmentId;
export const getShipmentByPartnerReference = backend.getShipmentByPartnerReference;
export const listShipments = backend.listShipments;
export const updateShipmentStatus = backend.updateShipmentStatus;
