-- CreateTable
CREATE TABLE "AliExpressToken" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AliExpressToken_pkey" PRIMARY KEY ("id")
);
