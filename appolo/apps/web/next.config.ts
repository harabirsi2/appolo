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
  poweredByHeader: false,
  // Keep the preview clean; the dev overlay badge sits on top of the bottom nav.
  devIndicators: false,
};

export default nextConfig;