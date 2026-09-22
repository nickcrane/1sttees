-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "supplierProductId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierProductId_key" ON "Product"("supplierProductId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: any Product created before this column existed can still be
-- traced back to its SupplierProduct via its ProductVariants -- do that
-- once here so lib/catalog/classify.ts's direct-lookup-by-supplierProductId
-- finds it too, not just newly-classified products.
UPDATE "Product" p
SET "supplierProductId" = sv."supplierProductId"
FROM "ProductVariant" pv
JOIN "SupplierVariant" sv ON sv.id = pv."supplierVariantId"
WHERE pv."productId" = p.id
  AND p."supplierProductId" IS NULL;

