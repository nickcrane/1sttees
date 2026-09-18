import { prisma } from "../lib/prisma";

async function main() {
  const existingGlobalRule = await prisma.priceRule.findFirst({ where: { scope: "GLOBAL" } });
  if (!existingGlobalRule) {
    await prisma.priceRule.create({
      data: {
        scope: "GLOBAL",
        costMultiplier: 2.5,
        fixedUpliftMinor: 0,
        floorMarginPct: 20,
        roundingRule: "PSYCHOLOGICAL_99",
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
