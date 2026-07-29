-- CreateTable
CREATE TABLE "tocxi_shipment" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "partnerReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "estimatedPrice" DOUBLE PRECISION,
    "trackingUrl" TEXT,
    "awbNo" TEXT,
    "pickupContactName" TEXT,
    "pickupContactPhone" TEXT,
    "pickupAddressLine" TEXT,
    "pickupPincode" TEXT,
    "pickupLatitude" DOUBLE PRECISION,
    "pickupLongitude" DOUBLE PRECISION,
    "dropContactName" TEXT,
    "dropContactPhone" TEXT,
    "dropAddressLine" TEXT,
    "dropPincode" TEXT,
    "dropLatitude" DOUBLE PRECISION,
    "dropLongitude" DOUBLE PRECISION,
    "packageDescription" TEXT,
    "parcelSize" TEXT,
    "weightKg" DOUBLE PRECISION,
    "declaredValue" DOUBLE PRECISION,
    "cod" BOOLEAN NOT NULL DEFAULT false,
    "codAmount" DOUBLE PRECISION,
    "estimatedDistanceKm" DOUBLE PRECISION,
    "estimatedDurationMin" INTEGER,
    "codFee" DOUBLE PRECISION,
    "totalPrice" DOUBLE PRECISION,
    "lastWebhookEvent" TEXT,
    "lastWebhookPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "tocxi_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tocxi_shipment_shipmentId_key" ON "tocxi_shipment"("shipmentId");

-- CreateIndex
CREATE INDEX "tocxi_shipment_status_idx" ON "tocxi_shipment"("status");

-- CreateIndex
CREATE INDEX "tocxi_shipment_partnerReference_idx" ON "tocxi_shipment"("partnerReference");

-- CreateIndex
CREATE INDEX "tocxi_shipment_createdAt_idx" ON "tocxi_shipment"("createdAt");
