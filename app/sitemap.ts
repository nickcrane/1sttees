import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { listPublishedProducts } from "@/lib/catalog/products";

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
