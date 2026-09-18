import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const publishedCount = await prisma.product.count({ where: { status: "PUBLISHED" } });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">1st Tees</h1>
      <p className="text-muted-foreground">
        Sustainable bamboo golf tees. Storefront under construction.
      </p>
      <p className="text-sm text-muted-foreground">
        {publishedCount > 0
          ? `${publishedCount} product${publishedCount === 1 ? "" : "s"} published.`
          : "No products published yet -- import one from /admin."}
      </p>
      <Button>Coming soon</Button>
    </main>
  );
}
