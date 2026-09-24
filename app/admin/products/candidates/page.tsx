import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/lib/money";
import { calculateLandedCostMinor } from "@/lib/pricing/calculate";
import { landedCostConfigFromEnv } from "@/lib/pricing/config";
import { prisma } from "@/lib/prisma";
import { approveProductAction, parkProductAction, rejectProductAction } from "@/lib/catalog/curation-actions";

// See app/admin/orders/page.tsx's identical comment -- middleware alone
// doesn't make Next.js treat a page as dynamic, and this list must never
// show build-time-stale candidates.
export const dynamic = "force-dynamic";

export default async function AdminCandidatesPage() {
  const products = await prisma.product.findMany({
    where: { status: "CANDIDATE" },
    include: {
      supplierProduct: true,
      variants: { include: { supplierVariant: true }, orderBy: { position: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const landedCostConfig = landedCostConfigFromEnv();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Candidates</h1>
        <Link href="/admin" className="text-sm underline">
          Back to admin
        </Link>
      </div>
      <nav className="flex gap-4 text-sm">
        <span className="font-medium">Candidates</span>
        <Link href="/admin/products/review" className="text-muted-foreground underline">
          Review queue
        </Link>
        <Link href="/admin/products/catalogue" className="text-muted-foreground underline">
          Catalogue
        </Link>
        <Link href="/admin/products/keywords" className="text-muted-foreground underline">
          Keywords
        </Link>
      </nav>

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing waiting for review. New candidates show up here after the nightly discovery + classification jobs
          run.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {products.map((product) => {
            const image = product.images[0] ?? product.supplierProduct?.imageUrls[0];
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
                        <p className="text-xs text-muted-foreground">
                          {product.material ?? "material unknown"}
                          {product.classifierConfidence !== null &&
                            ` · ${Math.round(product.classifierConfidence * 100)}% confidence`}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">{priceRange}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <ul className="flex flex-col gap-1">
                    {product.variants.map((variant) => {
                      const landedCostMinor = calculateLandedCostMinor(
                        { supplierPriceMinor: variant.supplierVariant.supplierPriceMinor, supplierShippingMinor: 0 },
                        landedCostConfig
                      );
                      const marginPct =
                        variant.priceMinor > 0 ? ((variant.priceMinor - landedCostMinor) / variant.priceMinor) * 100 : 0;
                      return (
                        <li key={variant.id} className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {variant.title}
                            {variant.colour && variant.colour !== "Natural" ? ` · ${variant.colour}` : ""}
                            {variant.packSize ? ` · pack of ${variant.packSize}` : ""}
                          </span>
                          <span>
                            {formatMinor(variant.priceMinor)} &middot; {marginPct.toFixed(0)}% margin
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {product.supplierProduct?.supplierUrl && (
                    <a href={product.supplierProduct.supplierUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                      View source listing on AliExpress
                    </a>
                  )}

                  <div className="flex gap-2 pt-1">
                    <form action={approveProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" size="sm">
                        Approve
                      </Button>
                    </form>
                    <form action={parkProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Park
                      </Button>
                    </form>
                    <form action={rejectProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        Reject
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
