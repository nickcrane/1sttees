import { LeafIcon, PackageIcon, TruckIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductVariantPicker } from "@/components/storefront/product-variant-picker";
import { getPublishedProductBySlug } from "@/lib/catalog/products";
import { listingSchema } from "@/lib/catalog/listing-schema";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublishedProductBySlug(slug);
  if (!product) return {};

  const parsedListing = listingSchema.safeParse(product.listing);
  const title = parsedListing.success ? parsedListing.data.name : product.title;
  const description = parsedListing.success ? parsedListing.data.headline : product.description;

  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/products/${product.slug}`,
      images: product.images[0] ? [{ url: product.images[0] }] : undefined,
    },
  };
}

// "Ships from the UK & EU" (an earlier draft of this list) was simply
// false -- fulfilment is AliExpress dropshipping, so items ship from the
// supplier's own location, not the UK/EU. The spec is explicit that this
// needs an honest overseas-shipping notice with a realistic delivery
// estimate, not a claim implying local stock. 2-4 weeks is AliExpress's
// own typical standard-shipping range to the UK/EU, not from a live
// freight quote for this specific product yet (Phase 1's freight-quote
// API isn't wired into the storefront) -- revisit once it is.
const FEATURES = [
  { icon: LeafIcon, label: "Biodegradable bamboo" },
  { icon: PackageIcon, label: "Plastic-free packaging" },
  { icon: TruckIcon, label: "Ships from overseas -- 2-4 week delivery" },
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

  // A listing failing the Stage 4 validator (product.validatorErrors
  // non-empty) still renders here rather than being hidden -- the
  // validator gates what shows as "needs review" in the admin Catalogue
  // view, not what's safe to show a customer; falling back to the plain
  // title/description would be a worse customer experience than a
  // slightly-off-spec but still coherent generated listing.
  const parsedListing = listingSchema.safeParse(product.listing);
  const listing = parsedListing.success ? parsedListing.data : null;

  const displayTitle = listing?.name ?? product.title;
  const displayDescription = listing?.headline ?? product.description;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: displayTitle,
    description: displayDescription,
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
        <span className="text-foreground">{displayTitle}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-muted shadow-el2">
          {product.images[0] && (
            <Image
              src={product.images[0]}
              alt={displayTitle}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
              priority
            />
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-headline-lg font-heading text-foreground">{displayTitle}</h1>
            <p className="text-body-lg text-muted-foreground">{displayDescription}</p>
          </div>

          {listing && (
            <div className="flex flex-col gap-3 text-body-md text-muted-foreground">
              <p>{listing.overview[0]}</p>
              <p>{listing.overview[1]}</p>
            </div>
          )}

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

          {listing && (
            <>
              <div className="h-px bg-border" />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-label-lg">
                {Object.entries(listing.specification).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              <p className="text-label-lg text-muted-foreground">{listing.inTheBox}</p>

              {listing.sustainability && (
                <p className="text-label-lg text-muted-foreground">{listing.sustainability}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
