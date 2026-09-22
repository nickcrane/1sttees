import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { rejectProductAction, sendToCandidatesAction } from "@/lib/catalog/curation-actions";

export const dynamic = "force-dynamic";

export default async function AdminReviewQueuePage() {
  const products = await prisma.product.findMany({
    where: { status: "REVIEW" },
    include: { supplierProduct: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <Link href="/admin" className="text-sm underline">
          Back to admin
        </Link>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link href="/admin/products/candidates" className="text-muted-foreground underline">
          Candidates
        </Link>
        <span className="font-medium">Review queue</span>
        <Link href="/admin/products/catalogue" className="text-muted-foreground underline">
          Catalogue
        </Link>
      </nav>

      <p className="text-sm text-muted-foreground">
        Products the classifier rejected, was unsure about, or couldn&rsquo;t match to a real supplier SKU --
        nothing here was silently dropped. Override sends a product back to Candidates for the normal Approve/
        Reject/Park decision.
      </p>

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs review right now.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {products.map((product) => {
            const image = product.images[0] ?? product.supplierProduct?.imageUrls[0];
            return (
              <Card key={product.id}>
                <CardHeader>
                  <div className="flex items-start gap-3">
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
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {product.rejectReason && <Badge variant="destructive">{product.rejectReason}</Badge>}

                  {product.supplierProduct?.supplierUrl && (
                    <a href={product.supplierProduct.supplierUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                      View source listing on AliExpress
                    </a>
                  )}

                  <div className="flex gap-2 pt-1">
                    <form action={sendToCandidatesAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" size="sm">
                        Send to Candidates
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
