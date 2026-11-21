import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/seo";

/**
 * Crawlers may index the public surface only. Everything behind `/app`, the
 * JSON API, auth screens, one-time review links and the embeddable widgets is
 * disallowed: those pages either need a session or duplicate a public page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/app", "/api/", "/login", "/signup", "/r/", "/embed/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
