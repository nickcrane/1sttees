-- AlterEnum
BEGIN;
CREATE TYPE "ProductStatus_new" AS ENUM ('CANDIDATE', 'REVIEW', 'APPROVED', 'REJECTED', 'PARKED', 'PUBLISHED', 'RETIRED');
ALTER TABLE "public"."Product" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "status" TYPE "ProductStatus_new" USING ("status"::text::"ProductStatus_new");
ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_old";
ALTER TYPE "ProductStatus_new" RENAME TO "ProductStatus";
DROP TYPE "public"."ProductStatus_old";
ALTER TABLE "Product" ALTER COLUMN "status" SET DEFAULT 'CANDIDATE';
COMMIT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "classifierConfidence" DOUBLE PRECISION,
ADD COLUMN     "listing" JSONB,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "validatorErrors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "status" SET DEFAULT 'CANDIDATE';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "colour" TEXT,
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "packSize" INTEGER;

-- AlterTable
ALTER TABLE "SupplierProduct" ADD COLUMN     "discoverySource" TEXT;

