import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

if ((process.env.NODE_ENV ?? "development") === "production") {
  console.error("refusing to reset a production database");
  process.exit(1);
}

import { createDb } from "./client";
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or MIGRATE_DATABASE_URL) is required");
  process.exit(1);
}

const { client } = createDb(url, 1);

try {
  await client.unsafe("drop schema public cascade");
  await client.unsafe("create schema public");
  await client.unsafe("grant usage on schema public to public");
  console.log("database reset. run `pnpm db:migrate` next.");
} finally {
  await client.end();
}