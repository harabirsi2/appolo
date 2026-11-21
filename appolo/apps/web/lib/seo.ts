import type { Metadata } from "next";

/**
 * One place for the public-facing identity of the site.
 *
 * Absolute URLs are required by Open Graph, Twitter cards, canonicals and the
 * sitemap; `APP_URL` is the same value the app already uses for links, and
 * `metadataBase` in the root layout turns any relative path into an absolute
 * one as well.
 */
export const SITE_NAME = "Appolo";
export const SITE_TAGLINE = "Rank what you love";
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.APP_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");

export const DEFAULT_DESCRIPTION =
  "Rate movies, TV, music, podcasts, and books through quick head-to-head matchups, get a personalised score, and build your ranked top five.";

/** Link-preview size produced by every `/api/og/*` generator. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Collapse whitespace and cut to a length social platforms show in full. */
export function truncateText(value: string | null | undefined, max = 155): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

interface PageMetaInput {
  title: string;
  description?: string | null;
  /** App-relative canonical path, e.g. `/ava`. */
  path: string;
  /** App-relative or absolute OG image path (`/api/og/...`). */
  image?: string | null;
  imageAlt?: string;
  type?: "website" | "article" | "profile";
  /** Keep a page out of search results (404s, spoilers). */
  noindex?: boolean;
}

/**
 * Build the metadata every public page shares: canonical URL, Open Graph and
 * the matching Twitter card. The OG image is the same generator the in-app
 * share buttons use, so a link pasted into a social platform renders the card
 * the author saw when they shared it.
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
  imageAlt,
  type = "website",
  noindex = false,
}: PageMetaInput): Metadata {
  const summary = truncateText(description) ?? DEFAULT_DESCRIPTION;
  const ogImage = image ? { url: image, width: OG_WIDTH, height: OG_HEIGHT, alt: imageAlt ?? title } : undefined;

  return {
    title,
    description: summary,
    alternates: { canonical: path },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type,
      title,
      description: summary,
      url: path,
      siteName: SITE_NAME,
      locale: "en_US",
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: summary,
      ...(image ? { images: [image] } : {}),
    },
  };
}
