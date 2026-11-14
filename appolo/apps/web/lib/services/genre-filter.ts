import { sql, type SQL } from "drizzle-orm";
import { genreKey } from "@appolo/core";

/**
 * Case-insensitive genre predicates.
 *
 * `catalog_items.genres` mixes casings — the base seed writes "Action" and the
 * expansion rows write "action" — so array containment (`@>`) silently misses
 * half the catalog. Comparing `lower(g)` against a normalised key matches both.
 * With ~1,200 rows the unnest scan is far cheaper than the bug it replaces.
 */
export function hasGenre(genres: SQL | unknown, genre: string): SQL {
  return sql`exists (select 1 from unnest(${genres}) as g where lower(g) = ${genreKey(genre)})`;
}

/** True when at least one of `genres` appears in the column, ignoring case. */
export function hasAnyGenre(genres: SQL | unknown, wanted: readonly string[]): SQL {
  const keys = [...new Set(wanted.map(genreKey).filter(Boolean))];
  if (keys.length === 0) return sql`false`;
  return sql`exists (select 1 from unnest(${genres}) as g where lower(g) in (${sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )}))`;
}
