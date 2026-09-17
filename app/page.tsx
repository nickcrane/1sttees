import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const healthCheck = await prisma.healthCheck.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">1st Tees</h1>
      <p className="text-muted-foreground">
        Sustainable bamboo golf tees. Storefront under construction.
      </p>
      <p className="text-sm text-muted-foreground">
        {healthCheck
          ? `Database says: "${healthCheck.message}"`
          : "Database connected, but not seeded yet -- run pnpm db:seed."}
      </p>
      <Button>Coming soon</Button>
    </main>
  );
}
