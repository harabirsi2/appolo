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
  images: { deviceSizes: [96, 128, 160, 192, 256, 360, 640, 828, 1080, 1200, 1920] },
  poweredByHeader: false,
  // Keep the preview clean; the dev overlay badge sits on top of the bottom nav.
  devIndicators: false,
};

export default nextConfig;