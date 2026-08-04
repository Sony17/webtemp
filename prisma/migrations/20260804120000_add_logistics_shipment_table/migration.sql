-- CreateTable
CREATE TABLE "logistics_shipment" (
    "id" TEXT NOT NULL,
    "partnerReference" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" TEXT NOT NULL,
    "pickup" JSONB NOT NULL,
    "drop" JSONB NOT NULL,
    "parcelSize" TEXT,
    "weightKg" DOUBLE PRECISION,
    "cod" BOOLEAN NOT NULL DEFAULT false,
    "codAmount" DOUBLE PRECISION,
    "quote" JSONB,
    "estimatedPrice" DOUBLE PRECISION,
    "trackingUrl" TEXT,
    "awbNo" TEXT,
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_shipment_partnerReference_key" ON "logistics_shipment"("partnerReference");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_shipment_shipmentId_key" ON "logistics_shipment"("shipmentId");

-- CreateIndex
CREATE INDEX "logistics_shipment_status_idx" ON "logistics_shipment"("status");

-- CreateIndex
CREATE INDEX "logistics_shipment_transactionId_idx" ON "logistics_shipment"("transactionId");
