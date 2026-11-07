import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

function loadEnvFile(dir: string): void {
  for (const candidate of [path.join(dir, ".env"), path.join(dir, "..", ".env"), path.join(dir, "..", "..", ".env")]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

loadEnvFile(pkgRoot);

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or MIGRATE_DATABASE_URL) is required");
  process.exit(1);
}

const sqlClient = postgres(url, { max: 1, onnotice: () => {} });

const MIGRATION_DIRS = ["drizzle", "sql"];

async function listMigrations(): Promise<{ name: string; file: string }[]> {
  const out: { name: string; file: string }[] = [];
  for (const dirName of MIGRATION_DIRS) {
    const dir = path.join(pkgRoot, dirName);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".sql")) continue;
      out.push({ name: `${dirName}/${entry}`, file: path.join(dir, entry) });
    }
  }
  return out;
}

function statements(raw: string): string[] {
  return raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  await sqlClient`create table if not exists _appolo_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  await sqlClient`select pg_advisory_lock(hashtext('appolo:migrations'))`;
  try {
    const applied = new Set<string>(
      (await sqlClient<{ name: string }[]>`select name from _appolo_migrations`).map((r) => r.name),
    );

    const files = await listMigrations();
    let count = 0;

    for (const { name, file } of files) {
      if (applied.has(name)) continue;
      const raw = await readFile(file, "utf8");
      const parts = statements(raw);

      await sqlClient.begin(async (tx) => {
        for (const part of parts) {
          await tx.unsafe(part);
        }
        await tx`insert into _appolo_migrations (name) values (${name})`;
      });

      console.log(`applied  ${name}  (${parts.length} statements)`);
      count += 1;
    }

    console.log(count === 0 ? "database is up to date" : `applied ${count} migration(s)`);
  } finally {
    await sqlClient`select pg_advisory_unlock(hashtext('appolo:migrations'))`;
  }
}

main()
  .then(async () => {
    await sqlClient.end();
  })
  .catch(async (err) => {
    console.error("migration failed:", err);
    try {
      await sqlClient.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });