import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { leadPriceMinor, listPublishedProducts } from "@/lib/catalog/products";
import { formatMinor } from "@/lib/money";

export const metadata: Metadata = {
  title: "Shop | 1st Tees",
  description: "Sustainable bamboo golf tees, shipped to the UK and EU.",
};

export default async function ProductsPage() {
  const products = await listPublishedProducts();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold">Shop</h1>

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products are available right now -- check back soon.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {products.map((product) => {
            const priceMinor = leadPriceMinor(product);
            return (
              <Link key={product.id} href={`/products/${product.slug}`}>
                <Card className="h-full gap-3 overflow-hidden transition-colors hover:bg-muted">
                  <div className="relative aspect-square bg-muted">
                    {product.images[0] && (
                      <Image
                        src={product.images[0]}
                        alt={product.title}
                        fill
                        sizes="(min-width: 768px) 33vw, 50vw"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle>{product.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {priceMinor !== null && (
                      <p className="text-sm font-medium">from {formatMinor(priceMinor)}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
