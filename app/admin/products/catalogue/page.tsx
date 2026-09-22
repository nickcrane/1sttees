import Link from "next/link";
import Image from "next/image";
import type { ProductStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { publishProductAction, retireProductAction, unpublishProductAction } from "@/lib/catalog/curation-actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<ProductStatus, "default" | "secondary" | "destructive" | "outline"> = {
  CANDIDATE: "outline",
  REVIEW: "outline",
  APPROVED: "secondary",
  PUBLISHED: "default",
  PARKED: "outline",
  REJECTED: "destructive",
  RETIRED: "outline",
};

export default async function AdminCataloguePage() {
  const products = await prisma.product.findMany({
    where: { status: { in: ["APPROVED", "PUBLISHED"] } },
    include: { variants: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catalogue</h1>
        <Link href="/admin" className="text-sm underline">
          Back to admin
        </Link>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link href="/admin/products/candidates" className="text-muted-foreground underline">
          Candidates
        </Link>
        <Link href="/admin/products/review" className="text-muted-foreground underline">
          Review queue
        </Link>
        <span className="font-medium">Catalogue</span>
      </nav>

      <p className="text-sm text-muted-foreground">
        Approved products, live and not-yet-live. Generated listing copy and its validator (Stage 4) land here once
        built -- for now this is title/images/price as classified.
      </p>

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing approved yet -- approve a candidate first.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {products.map((product) => {
            const image = product.images[0];
            const prices = product.variants.map((v) => v.priceMinor);
            const priceRange =
              prices.length === 0
                ? "No priced variants"
                : Math.min(...prices) === Math.max(...prices)
                  ? formatMinor(Math.min(...prices))
                  : `${formatMinor(Math.min(...prices))} – ${formatMinor(Math.max(...prices))}`;

            return (
              <Card key={product.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      {image && (
                        <Image
                          src={image}
                          alt=""
                          width={64}
                          height={64}
                          className="size-16 shrink-0 rounded-lg border border-border object-cover"
                          unoptimized
                        />
                      )}
                      <div>
                        <CardTitle className="text-sm">{product.title}</CardTitle>
                        <p className="text-xs text-muted-foreground">/{product.slug}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
                      <span className="text-xs text-muted-foreground">{priceRange}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex gap-2">
                  {product.status === "APPROVED" && (
                    <form action={publishProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" size="sm">
                        Publish
                      </Button>
                    </form>
                  )}
                  {product.status === "PUBLISHED" && (
                    <form action={unpublishProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Unpublish
                      </Button>
                    </form>
                  )}
                  <form action={retireProductAction}>
                    <input type="hidden" name="productId" value={product.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Retire
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
