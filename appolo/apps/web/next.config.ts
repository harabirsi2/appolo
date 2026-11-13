import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Next only reads env files from the app directory. Load the monorepo root
// .env (and an app-local override) so the server has DATABASE_URL and friends.
loadEnv({ path: path.resolve(process.cwd(), "..", "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env"), override: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@appolo/config", "@appolo/core", "@appolo/db", "@appolo/ui"],
  serverExternalPackages: ["postgres"],
  // Covers render between 44 px and 728 px wide; smaller variants avoid
  // downloading the full 720 px file for a thumbnail.
  images: { deviceSizes: [360, 640, 828, 1080, 1200, 1920] },
  poweredByHeader: false,
  // Keep the preview clean; the dev overlay badge sits on top of the bottom nav.
  devIndicators: false,
};

export default nextConfig;