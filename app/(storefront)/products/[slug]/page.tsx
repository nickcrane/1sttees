import { LeafIcon, PackageIcon, TruckIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
    title: product.title,
    description: product.description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.title,
      description: product.description,
      url: `/products/${product.slug}`,
      images: product.images[0] ? [{ url: product.images[0] }] : undefined,
    },
  };
}

const FEATURES = [
  { icon: LeafIcon, label: "Biodegradable bamboo" },
  { icon: PackageIcon, label: "Plastic-free packaging" },
  { icon: TruckIcon, label: "Ships from the UK & EU" },
];

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
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      {/* Static JSON-LD generated server-side from our own DB, not user input. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-label-lg text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <span aria-hidden>/</span>
        <Link href="/products" className="hover:text-foreground">
          Shop
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-muted shadow-el2">
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

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-headline-lg font-heading text-foreground">{product.title}</h1>
            <p className="text-body-lg text-muted-foreground">{product.description}</p>
          </div>

          <ul className="flex flex-col gap-2">
            {FEATURES.map((feature) => (
              <li key={feature.label} className="flex items-center gap-2 text-label-lg text-muted-foreground">
                <feature.icon className="size-4 text-primary" />
                {feature.label}
              </li>
            ))}
          </ul>

          <div className="h-px bg-border" />

          <ProductVariantPicker variants={variants} />
        </div>
      </div>
    </div>
  );
}
