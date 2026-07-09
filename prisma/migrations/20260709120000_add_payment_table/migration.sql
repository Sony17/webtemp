-- CreateTable
CREATE TABLE "ondc_payment" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DOUBLE PRECISION,
    "paymentReference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bankReference" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ondc_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ondc_payment_transactionId_key" ON "ondc_payment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ondc_payment_paymentReference_key" ON "ondc_payment"("paymentReference");

-- CreateIndex
CREATE INDEX "ondc_payment_status_idx" ON "ondc_payment"("status");
