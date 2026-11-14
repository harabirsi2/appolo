import { inArray, sql } from "drizzle-orm";
import { MEDIA_KINDS, genreKey, scoreForElo, type MediaKind } from "@appolo/core";
import { getDb, schema } from "@/lib/db";
import { rankedRatings, type CatalogItem } from "./rankings";
import { ratingStreak, type Streak } from "./streaks";

const { itemRatings } = schema;

/** Capitalise each word so a stored "sci-fi" reads as "Sci-Fi" in the UI. */
function displayGenre(value: string): string {
  return value.trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export interface TasteKind {
  kind: MediaKind;
  count: number;
  average: number;
}

export interface GenreCount {
  genre: string;
  count: number;
}

export interface ContrarianPick {
  item: CatalogItem;
  yours: number;
  community: number;
  /** Positive means you rate it higher than everyone else. */
  gap: number;
  others: number;
}

export interface TasteDna {
  rated: number;
  matchups: number;
  average: number;
  topKind: MediaKind | null;
  /** Ten buckets, 0–9, matching the item page rating curve. */
  distribution: number[];
  kinds: TasteKind[];
  genres: GenreCount[];
  contrarian: ContrarianPick[];
  streak: Streak;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/**
 * One profile's taste, summarised: how it spreads across kinds and genres, and
 * where it disagrees with the community. Community averages are world-readable,
 * so this reads them outside a tenant scope.
 */
export async function tasteDna(orgId: string): Promise<TasteDna> {
  const [ratings, streak] = await Promise.all([rankedRatings(orgId), ratingStreak(orgId)]);

  const distribution = new Array<number>(10).fill(0);
  let matchups = 0;
  for (const rating of ratings) {
    const bucket = Math.min(9, Math.floor(rating.score));
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    matchups += rating.matches;
  }

  const kinds: TasteKind[] = MEDIA_KINDS.map((kind) => {
    const items = ratings.filter((rating) => rating.kind === kind);
    return { kind, count: items.length, average: mean(items.map((item) => item.score)) };
  })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  // Merge casings so "Action" and "action" are one entry, and show a readable
  // label rather than whichever casing happened to be stored.
  const genreCounts = new Map<string, { genre: string; count: number }>();
  for (const rating of ratings) {
    for (const genre of rating.genres) {
      const key = genreKey(genre);
      if (!key) continue;
      const entry = genreCounts.get(key);
      if (entry) entry.count += 1;
      else genreCounts.set(key, { genre: displayGenre(genre), count: 1 });
    }
  }
  const genres = [...genreCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  let contrarian: ContrarianPick[] = [];
  if (ratings.length > 0) {
    const db = getDb();
    const rows = await db
      .select({
        itemId: itemRatings.itemId,
        avgElo: sql<number>`avg(${itemRatings.elo})::float`,
        others: sql<number>`count(*)::int`,
      })
      .from(itemRatings)
      .where(inArray(itemRatings.itemId, ratings.map((rating) => rating.id)))
      .groupBy(itemRatings.itemId);

    const byItem = new Map(rows.map((row) => [row.itemId, row]));
    contrarian = ratings
      .map((rating) => {
        const row = byItem.get(rating.id);
        if (!row || row.others < 2) return null;
        const community = Math.round(scoreForElo(row.avgElo) * 10) / 10;
        return {
          item: {
            id: rating.id,
            kind: rating.kind,
            title: rating.title,
            subtitle: rating.subtitle,
            year: rating.year,
            imageUrl: rating.imageUrl,
            description: rating.description,
            links: rating.links,
            genres: rating.genres,
            trailerUrl: rating.trailerUrl,
            tags: rating.tags,
          },
          yours: rating.score,
          community,
          gap: Math.round((rating.score - community) * 10) / 10,
          others: row.others,
        };
      })
      .filter((entry): entry is ContrarianPick => entry !== null)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 4);
  }

  return {
    rated: ratings.length,
    matchups,
    average: mean(ratings.map((rating) => rating.score)),
    topKind: kinds[0]?.kind ?? null,
    distribution,
    kinds,
    genres,
    contrarian,
    streak,
  };
}
