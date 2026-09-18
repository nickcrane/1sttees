/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SupplierProductStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'DELISTED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "PriceRuleScope" AS ENUM ('GLOBAL', 'PRODUCT');

-- CreateEnum
CREATE TYPE "RoundingRule" AS ENUM ('NONE', 'PSYCHOLOGICAL_99');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AdminSecurityEventType" AS ENUM ('SIGN_IN_SUCCESS', 'SIGN_IN_FAILURE', 'TOTP_ENROLLED', 'TOTP_FAILURE', 'SIGN_OUT');

-- DropTable
DROP TABLE "HealthCheck";

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "aeProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "imageUrls" TEXT[],
    "supplierUrl" TEXT,
    "status" "SupplierProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierVariant" (
    "id" TEXT NOT NULL,
    "supplierProductId" TEXT NOT NULL,
    "aeSkuId" TEXT NOT NULL,
    "skuAttrs" TEXT NOT NULL,
    "supplierPriceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stock" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" TEXT[],
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierVariantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "images" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "scope" "PriceRuleScope" NOT NULL DEFAULT 'GLOBAL',
    "productId" TEXT,
    "costMultiplier" DOUBLE PRECISION NOT NULL,
    "fixedUpliftMinor" INTEGER NOT NULL DEFAULT 0,
    "floorMarginPct" DOUBLE PRECISION NOT NULL,
    "roundingRule" "RoundingRule" NOT NULL DEFAULT 'PSYCHOLOGICAL_99',
    "maxPriceMinor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "productsScanned" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsUnpublished" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "encryptedTotpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSecurityEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "email" TEXT NOT NULL,
    "type" "AdminSecurityEventType" NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_aeProductId_key" ON "SupplierProduct"("aeProductId");

-- CreateIndex
CREATE INDEX "SupplierProduct_status_idx" ON "SupplierProduct"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVariant_supplierProductId_aeSkuId_key" ON "SupplierVariant"("supplierProductId", "aeSkuId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_supplierVariantId_key" ON "ProductVariant"("supplierVariantId");

-- CreateIndex
CREATE INDEX "PriceRule_scope_productId_idx" ON "PriceRule"("scope", "productId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminSecurityEvent_email_createdAt_idx" ON "AdminSecurityEvent"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierVariant" ADD CONSTRAINT "SupplierVariant_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_supplierVariantId_fkey" FOREIGN KEY ("supplierVariantId") REFERENCES "SupplierVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSecurityEvent" ADD CONSTRAINT "AdminSecurityEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
