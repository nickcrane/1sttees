import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ProductVariantPicker } from "@/components/storefront/product-variant-picker";
import { getPublishedProductBySlug } from "@/lib/catalog/products";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublishedProductBySlug(slug);
  if (!product) return {};

  return {
    title: `${product.title} | 1st Tees`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getPublishedProductBySlug(slug);
  if (!product) notFound();

  const variants = product.variants.map((variant) => ({
    id: variant.id,
    title: variant.title,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    offers: variants.map((variant) => ({
      "@type": "Offer",
      price: (variant.priceMinor / 100).toFixed(2),
      priceCurrency: variant.currency,
      availability: "https://schema.org/InStock",
    })),
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-4 py-12 md:grid-cols-2">
      {/* Static JSON-LD generated server-side from our own DB, not user input. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        {product.images[0] && (
          <Image
            src={product.images[0]}
            alt={product.title}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
            priority
          />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">{product.title}</h1>
        <p className="text-sm text-muted-foreground">{product.description}</p>
        <ProductVariantPicker variants={variants} />
      </div>
    </div>
  );
}
