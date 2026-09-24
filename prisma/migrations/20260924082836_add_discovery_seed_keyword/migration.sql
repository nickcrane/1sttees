-- CreateTable
CREATE TABLE "DiscoverySeedKeyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySeedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySeedKeyword_keyword_key" ON "DiscoverySeedKeyword"("keyword");

-- SeedData: the keywords lib/catalog/discovery.ts hardcoded before this
-- migration (mm-size references generalised -- "wood golf tee 70mm" /
-- "bamboo tee 83mm" -> "wood golf tee" / "bamboo tee"), carried over as
-- this table's starting rows so a fresh `migrate deploy` (test, prod, any
-- new environment) lands with the same coverage discovery already had.
-- No automated step runs prisma/seed.ts on deploy, so this has to be
-- data baked into the migration itself, not left to `pnpm db:seed`.
INSERT INTO "DiscoverySeedKeyword" ("id", "keyword") VALUES
    ('seed-bamboo-golf-tees', 'bamboo golf tees'),
    ('seed-wooden-golf-tees', 'wooden golf tees'),
    ('seed-wood-golf-tee', 'wood golf tee'),
    ('seed-bamboo-tee', 'bamboo tee'),
    ('seed-natural-wood-tees-bulk', 'natural wood tees bulk'),
    ('seed-golf-tees-biodegradable', 'golf tees biodegradable')
ON CONFLICT ("keyword") DO NOTHING;
