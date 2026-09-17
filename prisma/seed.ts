import { prisma } from "../lib/prisma";

async function main() {
  await prisma.healthCheck.upsert({
    where: { id: "hello-store" },
    update: {},
    create: { id: "hello-store", message: "1st Tees is up." },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
