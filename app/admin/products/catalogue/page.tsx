import Link from "next/link";
import Image from "next/image";
import type { ProductStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { listingSchema } from "@/lib/catalog/listing-schema";
import {
  publishProductAction,
  regenerateListingAction,
  retireProductAction,
  unpublishProductAction,
} from "@/lib/catalog/curation-actions";

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
        <Link href="/admin/products/keywords" className="text-muted-foreground underline">
          Keywords
        </Link>
      </nav>

      <p className="text-sm text-muted-foreground">
        Approved products, live and not-yet-live, with their generated listing copy (Stage 4) and its validator
        status.
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

            const parsedListing = listingSchema.safeParse(product.listing);
            const listing = parsedListing.success ? parsedListing.data : null;
            const hasValidatorErrors = product.validatorErrors.length > 0;

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
                <CardContent className="flex flex-col gap-3">
                  {!product.listing && <Badge variant="outline">No listing generated yet</Badge>}
                  {hasValidatorErrors && (
                    <div className="flex flex-col gap-1">
                      <Badge variant="destructive">Needs review -- failed validation</Badge>
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        {product.validatorErrors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {listing && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">{listing.name}</p>
                      <p className="text-muted-foreground">{listing.headline}</p>
                      <p className="text-xs text-muted-foreground">{listing.overview[0]}</p>
                      <p className="text-xs text-muted-foreground">{listing.overview[1]}</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {Object.entries(listing.specification).map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="text-xs text-muted-foreground">{listing.inTheBox}</p>
                      {listing.sustainability && <p className="text-xs text-muted-foreground">{listing.sustainability}</p>}
                    </div>
                  )}

                  <div className="flex gap-2">
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
                    <form action={regenerateListingAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {product.listing ? "Regenerate listing" : "Generate listing"}
                      </Button>
                    </form>
                    <form action={retireProductAction}>
                      <input type="hidden" name="productId" value={product.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        Retire
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
