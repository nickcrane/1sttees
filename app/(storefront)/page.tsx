import Link from "next/link";
import { Button } from "@/components/ui/button";
import { leadPriceMinor, listPublishedProducts } from "@/lib/catalog/products";
import { formatMinor } from "@/lib/money";

export default async function Home() {
  const products = await listPublishedProducts();
  const featured = products[0];
  const featuredPriceMinor = featured ? leadPriceMinor(featured) : null;

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-4 px-4 py-20 text-center">
        <h1 className="font-heading text-4xl font-semibold sm:text-5xl">1st Tees</h1>
        <p className="max-w-md text-muted-foreground">
          Sustainable bamboo golf tees, shipped to the UK and EU. Stronger than wood, kinder
          than plastic.
        </p>
        <Button size="lg" className="mt-2" nativeButton={false} render={<Link href="/products" />}>
          Shop bamboo tees
        </Button>
      </section>

      {featured && (
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-20">
          <h2 className="font-heading text-xl font-semibold">Featured</h2>
          <Link
            href={`/products/${featured.slug}`}
            className="flex flex-col gap-1 rounded-xl border border-border p-6 transition-colors hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium">{featured.title}</p>
              <p className="text-sm text-muted-foreground">{featured.description}</p>
            </div>
            {featuredPriceMinor !== null && (
              <p className="text-lg font-semibold whitespace-nowrap">from {formatMinor(featuredPriceMinor)}</p>
            )}
          </Link>
        </section>
      )}
    </div>
  );
}
