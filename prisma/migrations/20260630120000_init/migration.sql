-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStage" AS ENUM ('init', 'confirm', 'status', 'track', 'cancel', 'update');

-- CreateTable
CREATE TABLE "ondc_search" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "intent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ondc_search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ondc_search_result" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "bppId" TEXT NOT NULL,
    "bppUri" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "catalog" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ondc_search_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ondc_order" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "bppId" TEXT NOT NULL,
    "bppUri" TEXT NOT NULL,
    "orderId" TEXT,
    "stage" "OrderStage" NOT NULL,
    "messageId" TEXT NOT NULL,
    "state" JSONB,
    "order" JSONB NOT NULL,
    "quote" JSONB,
    "payments" JSONB,
    "fulfillments" JSONB,
    "tracking" JSONB,
    "cancellation" JSONB,
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ondc_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ondc_event" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "bppId" TEXT,
    "bppUri" TEXT,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ondc_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ondc_search_transactionId_key" ON "ondc_search"("transactionId");

-- CreateIndex
CREATE INDEX "ondc_search_result_transactionId_idx" ON "ondc_search_result"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ondc_search_result_transactionId_bppId_messageId_key" ON "ondc_search_result"("transactionId", "bppId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ondc_order_orderId_key" ON "ondc_order"("orderId");

-- CreateIndex
CREATE INDEX "ondc_order_transactionId_idx" ON "ondc_order"("transactionId");

-- CreateIndex
CREATE INDEX "ondc_order_bppId_idx" ON "ondc_order"("bppId");

-- CreateIndex
CREATE UNIQUE INDEX "ondc_order_transactionId_bppId_key" ON "ondc_order"("transactionId", "bppId");

-- CreateIndex
CREATE INDEX "ondc_event_transactionId_idx" ON "ondc_event"("transactionId");

-- CreateIndex
CREATE INDEX "ondc_event_kind_idx" ON "ondc_event"("kind");

-- CreateIndex
CREATE INDEX "ondc_event_transactionId_kind_idx" ON "ondc_event"("transactionId", "kind");

-- AddForeignKey
ALTER TABLE "ondc_search_result" ADD CONSTRAINT "ondc_search_result_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ondc_search"("transactionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ondc_order" ADD CONSTRAINT "ondc_order_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ondc_search"("transactionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ondc_event" ADD CONSTRAINT "ondc_event_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ondc_search"("transactionId") ON DELETE CASCADE ON UPDATE CASCADE;
