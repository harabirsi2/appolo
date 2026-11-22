import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseEnv } from "dotenv";
import type { NextConfig } from "next";

/**
 * Next only reads env files from the app directory. Load the monorepo root
 * .env (and an app-local override) so the server has DATABASE_URL and friends.
 *
 * `NODE_ENV` is deliberately skipped: Next derives it from the command it is
 * running (`build`/`start` → production, `dev` → development). Letting a .env
 * file set it produced production builds compiled in development mode, whose
 * `/404` and `/500` error pages cannot prerender and fail with
 * "<Html> should not be imported outside of pages/_document".
 */
function loadEnvFile(file: string, override: boolean): void {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(contents))) {
    if (key === "NODE_ENV") continue;
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "..", "..", ".env"), false);
loadEnvFile(path.resolve(process.cwd(), ".env"), true);

const nextConfig: NextConfig = {
  transpilePackages: ["@appolo/config", "@appolo/core", "@appolo/db", "@appolo/ui"],
  serverExternalPackages: ["postgres"],
  // Covers render between 44 px and 728 px wide; smaller variants avoid
  // downloading the full 720 px file for a thumbnail.
  images: {
    // Covers are the only large images on the page, and most of them are
    // already ~700px wide: AVIF cuts a phone-sized cover by roughly half
    // against JPEG, WebP is the fallback for older Safari.
    formats: ["image/avif", "image/webp"],
    deviceSizes: [96, 128, 160, 192, 256, 360, 640, 828, 1080, 1200, 1920],
    // Optimised variants are content-addressed by URL; a month is safe and
    // keeps repeat visits off the image optimizer.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  poweredByHeader: false,
  // Keep the preview clean; the dev overlay badge sits on top of the bottom nav.
  devIndicators: false,
  async headers() {
    return [
      {
        // The worker itself must never be cached: a stale sw.js is a device
        // stuck on an old strategy until the cache expires.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Framing is set per-route in middleware: widget routes are
          // intentionally embeddable, every other route gets DENY.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;