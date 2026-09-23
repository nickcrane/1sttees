import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { listPublishedProducts } from "@/lib/catalog/products";

// Next.js prerenders metadata routes like this one at build time by default.
// Railway's build runs in an isolated builder container with no access to
// the private network (Postgres/Redis are only reachable from the deploy
// container), so a build-time DB query here fails every Railway build --
// confirmed live. The product catalog changes over time anyway, so
// request-time rendering is also the more correct behaviour, not just a
// workaround.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.STORE_BASE_URL;
  const products = await listPublishedProducts();

  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/products`, changeFrequency: "weekly", priority: 0.8 },
    ...products.map((product) => ({
      url: `${base}/products/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
