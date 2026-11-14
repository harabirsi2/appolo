import { scoreForElo, MediaKind } from "@appolo/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
const { catalogItems } = schema;

export interface CatalogItem {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  imageUrl: string | null;
  description: string | null;
  links: Record<string, string>;
  genres: string[];
  trailerUrl: string | null;
  tags: string[];
}
export function toScore(elo: number): number {
  return scoreForElo(elo);
}

/* ------------------------------------------------------------------ */
/* Bradley–Terry model                                                 */
/* ------------------------------------------------------------------ */
export function mapCatalogItem(row: typeof catalogItems.$inferSelect): CatalogItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    year: row.year ?? null,
    imageUrl: row.imageUrl ?? null,
    description: row.description ?? null,
    links: (row.links ?? {}) as Record<string, string>,
    genres: row.genres ?? [],
    trailerUrl: row.trailerUrl ?? null,
    tags: row.tags ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* rankings (org-scoped)                                               */
/* ------------------------------------------------------------------ */

/** Every item this org has ranked, ordered by Elo with positions + scores. */

/** Catalog lookup shared by ranking and discovery modules. */
export async function getCatalogItem(itemId: string): Promise<CatalogItem | null> {
  // Guard non-UUID path segments so Postgres does not raise a 22P02 error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
    return null;
  }
  const db = getDb();
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.id, itemId)).limit(1);
  return rows[0] ? mapCatalogItem(rows[0]) : null;
}
