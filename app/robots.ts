import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/checkout", "/order-confirmation", "/admin", "/api"] },
    ],
    sitemap: `${env.STORE_BASE_URL}/sitemap.xml`,
  };
}
