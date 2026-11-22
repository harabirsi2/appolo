import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { publicIndex } from "@/lib/services/public-index";

/**
 * Refreshed at most every five minutes; every public mutation also calls
 * `revalidatePublicSitemap()`, so a new profile or review shows up immediately
 * instead of waiting for the window.
 */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // This file is generated at build time and refreshed every five minutes. A
  // build machine has no database, so a failed read must not fail the build:
  // it degrades to the static entry and the next revalidation (or any public
  // mutation, which calls `revalidatePublicSitemap`) fills it in.
  let profiles: string[] = [];
  let pods: string[] = [];
  let reviews: string[] = [];
  try {
    ({ profiles, pods, reviews } = await publicIndex());
  } catch (error) {
    console.error("[sitemap] public index unavailable:", error);
  }
  const now = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 1,
    },
    {
      // The public tour: real seeded content, no login required.
      url: absoluteUrl("/demo"),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    },
    ...profiles.map((path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...pods.map((path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...reviews.map((path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
