import { PrismaClient } from "@prisma/client";

// Reused across hot reloads in dev so `next dev` doesn't exhaust Postgres
// connections by creating a new PrismaClient on every module reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
