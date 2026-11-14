import { and, eq, inArray, notInArray } from "drizzle-orm";
import { MEDIA_KINDS, type MediaKind } from "@appolo/core";
import { getDbHandle, withOrg, schema } from "@/lib/db";
import { hasAnyGenre } from "./genre-filter";

const { catalogItems, itemRatings, profileInterests } = schema;

export interface InterestPick {
  kind: MediaKind;
  genre: string;
}

export interface InterestOption {
  kind: MediaKind;
  genres: string[];
}

export interface StarterItem {
  id: string;
  title: string;
  kind: MediaKind;
}

const isKind = (value: string): value is MediaKind => MEDIA_KINDS.includes(value as MediaKind);

/** Genres that actually exist in the catalog, grouped by media kind. */
export async function interestOptions(): Promise<InterestOption[]> {
  const { client } = getDbHandle();
  // Group on the case-insensitive key so "Action" and "action" are one chip.
  // `initcap` gives a stable display label regardless of which casing won.
  const rows = await client<{ kind: string; genre: string }[]>`
    select kind::text as kind, initcap(min(g)) as genre
    from public.catalog_items, unnest(genres) as g
    where g <> ''
    group by kind, lower(g)
    order by kind, count(*) desc, lower(g)
  `;
  const byKind = new Map<MediaKind, string[]>();
  for (const row of rows) {
    if (!isKind(row.kind)) continue;
    const genres = byKind.get(row.kind) ?? [];
    genres.push(row.genre);
    byKind.set(row.kind, genres);
  }
  return MEDIA_KINDS.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    genres: byKind.get(kind) ?? [],
  }));
}

export async function listInterests(orgId: string): Promise<InterestPick[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ kind: profileInterests.kind, genre: profileInterests.genre })
      .from(profileInterests)
      .where(eq(profileInterests.orgId, orgId));
    return rows.map((row) => ({ kind: row.kind as MediaKind, genre: row.genre }));
  });
}

/** Replace the org's interests with `picks`, deduplicated. Returns the count. */
export async function saveInterests(orgId: string, picks: InterestPick[]): Promise<number> {
  const unique = new Map<string, InterestPick>();
  for (const pick of picks) {
    const genre = pick.genre.trim().slice(0, 60);
    if (!genre) continue;
    unique.set(`${pick.kind}:${genre.toLowerCase()}`, { kind: pick.kind, genre });
  }

  return withOrg(orgId, async (tx) => {
    await tx.delete(profileInterests).where(eq(profileInterests.orgId, orgId));
    const values = [...unique.values()];
    if (values.length > 0) {
      await tx.insert(profileInterests).values(values.map((pick) => ({ orgId, ...pick })));
    }
    return values.length;
  });
}

/**
 * The first title to rate, chosen from the picked interests and skipping
 * anything already ranked. Falls back from genre match to kind match so a
 * catalog gap never leaves onboarding with nothing to do.
 */
export async function starterItem(orgId: string, picks: InterestPick[]): Promise<StarterItem | null> {
  if (picks.length === 0) return null;
  const kinds = [...new Set(picks.map((pick) => pick.kind))];
  const genres = [...new Set(picks.map((pick) => pick.genre))];

  return withOrg(orgId, async (tx) => {
    const rated = await tx
      .select({ itemId: itemRatings.itemId })
      .from(itemRatings)
      .where(eq(itemRatings.orgId, orgId));
    const ratedIds = rated.map((row) => row.itemId);

    const base = [inArray(catalogItems.kind, kinds)];
    if (ratedIds.length > 0) base.push(notInArray(catalogItems.id, ratedIds));

    const genreRows = genres.length
      ? await tx
          .select({ id: catalogItems.id, title: catalogItems.title, kind: catalogItems.kind })
          .from(catalogItems)
          .where(and(...base, hasAnyGenre(catalogItems.genres, genres)))
          .limit(1)
      : [];

    if (genreRows[0]) {
      return { id: genreRows[0].id, title: genreRows[0].title, kind: genreRows[0].kind as MediaKind };
    }

    const [fallback] = await tx
      .select({ id: catalogItems.id, title: catalogItems.title, kind: catalogItems.kind })
      .from(catalogItems)
      .where(and(...base))
      .limit(1);
    return fallback ? { id: fallback.id, title: fallback.title, kind: fallback.kind as MediaKind } : null;
  });
}
