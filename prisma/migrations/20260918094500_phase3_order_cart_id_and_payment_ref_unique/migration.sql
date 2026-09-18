-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cartId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentProviderRef_key" ON "Order"("paymentProviderRef");

