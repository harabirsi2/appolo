import { sql } from "drizzle-orm";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "@appolo/config";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface DbHandle {
  db: Db;
  client: ReturnType<typeof postgres>;
}

export function createDb(url: string, max = 10): DbHandle {
  const client = postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), client };
}

/* Reuse one pool across Next.js dev HMR reloads. */
const globalForDb = globalThis as unknown as {
  __appoloDb?: DbHandle;
  __appoloAdminDb?: DbHandle;
};

export function getDb(): Db {
  if (!globalForDb.__appoloDb) {
    globalForDb.__appoloDb = createDb(env().DATABASE_URL);
  }
  return globalForDb.__appoloDb.db;
}

export function getDbHandle(): DbHandle {
  if (!globalForDb.__appoloDb) {
    globalForDb.__appoloDb = createDb(env().DATABASE_URL);
  }
  return globalForDb.__appoloDb;
}

/** Superuser/owner connection for migrations, seeds and tests. */
export function getAdminDb(): Db {
  if (!globalForDb.__appoloAdminDb) {
    const url = process.env.MIGRATE_DATABASE_URL || env().DATABASE_URL;
    globalForDb.__appoloAdminDb = createDb(url, 5);
  }
  return globalForDb.__appoloAdminDb.db;
}

/**
 * Runs `fn` inside a transaction scoped to one tenant. RLS policies read
 * `app.org_id`, which is set transaction-locally so it can never leak across
 * pooled connections.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/** Admin variant for seeds/tests (bypasses RLS). */
export async function withOrgAdmin<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getAdminDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export * from "./schema";