import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { START_ELO, shrinkCommunityScore, detectCoordinatedVoting, CommunityConfidence, MediaKind } from "@appolo/core";
import { unstable_cache } from "next/cache";
import { COMMUNITY_TAGS } from "@/lib/cache";
import { getCatalogItem, mapCatalogItem, toScore, type CatalogItem } from "./catalog-item";
import { getDb, withOrg, schema } from "@/lib/db";
import { hasGenre } from "./genre-filter";
const { catalogItems, itemRatings, itemMatchups, catalogCredits } = schema;

export interface PopularItem extends CatalogItem {
  average: number;
  ratings: number;
}

/** Community's most-rated items over the last seven days. */
async function popularThisWeekUncached(limit: number): Promise<PopularItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      item: catalogItems,
      ratings: sql<number>`count(*)::int`,
      avgElo: sql<number>`coalesce(avg(${itemRatings.elo}), ${START_ELO})::float`,
    })
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .where(sql`${itemRatings.updatedAt} > now() - interval '7 days'`)
    .groupBy(catalogItems.id)
    // Tie-break deterministically so the rail does not reshuffle between runs.
    .orderBy(sql`count(*) desc`, catalogItems.id)
    .limit(limit);
  return rows.map((row) => ({
    ...mapCatalogItem(row.item),
    average: toScore(row.avgElo),
    ratings: row.ratings,
  }));
}

/**
 * Every signed-in home page reads the same global "popular this week" list, so
 * it is cached for 60 seconds instead of re-aggregating all ratings per request.
 */
const popularThisWeekCached = unstable_cache(
  popularThisWeekUncached,
  ["popular-this-week"],
  { revalidate: 60, tags: [COMMUNITY_TAGS.popular] },
);
export async function popularThisWeek(limit = 8): Promise<PopularItem[]> {
  return popularThisWeekCached(limit);
}
export interface Credit {
  id: string;
  personName: string;
  personSlug: string;
  role: string;
  character: string | null;
}
export async function creditsForItem(itemId: string): Promise<Credit[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(catalogCredits)
    .where(eq(catalogCredits.itemId, itemId))
    .orderBy(catalogCredits.position);
  return rows.map((row) => ({
    id: row.id,
    personName: row.personName,
    personSlug: row.personSlug,
    role: row.role,
    character: row.character ?? null,
  }));
}
export interface PersonPage {
  name: string;
  slug: string;
  roles: string[];
  works: CatalogItem[];
}
export async function personBySlug(slug: string): Promise<PersonPage | null> {
  const db = getDb();
  const rows = await db
    .select({ credit: catalogCredits, item: catalogItems })
    .from(catalogCredits)
    .innerJoin(catalogItems, eq(catalogItems.id, catalogCredits.itemId))
    .where(eq(catalogCredits.personSlug, slug))
    .orderBy(desc(catalogItems.year));
  if (rows.length === 0) return null;
  return {
    name: rows[0]!.credit.personName,
    slug,
    roles: [...new Set(rows.map((row) => row.credit.role))],
    works: rows.map((row) => mapCatalogItem(row.item)),
  };
}

/* ------------------------------------------------------------------ */
/* discovery: community leaderboard + weekly movers                    */
/* ------------------------------------------------------------------ */
export type LeaderboardSort = "top" | "rated" | "new";
export interface CommunityItem extends CatalogItem {
  /** Conservative community score after Bayesian-style shrinkage. */
  average: number | null;
  /** Unsrunk average, kept for transparency and internal ordering. */
  rawAverage: number | null;
  /** How much evidence supports the score. */
  confidence: CommunityConfidence;
  ratings: number;
  /** Votes flagged as coordinated and therefore down-weighted. */
  suspicious: number;
  coordination: "none" | "suspected";
}
interface LeaderboardOptions {
  kind?: MediaKind;
  genre?: string;
  sort?: LeaderboardSort;
  limit?: number;
}

/**
 * The shared catalog ordered by community opinion rather than by one taste
 * profile. `top` ranks by average score, `rated` by how many people weighed
 * in, and `new` by the newest additions to the catalog.
 *
 * Global and identical for every viewer. It is not cached: a production A/B
 * measured the same 9.4 ms median with and without the 30 s cache, so the
 * wrapper was removed instead of carrying staleness and invalidation.
 */
export async function catalogLeaderboard(options: LeaderboardOptions = {}): Promise<CommunityItem[]> {
  const db = getDb();
  const sort = options.sort ?? "top";
  const filters = [];
  if (options.kind) filters.push(eq(catalogItems.kind, options.kind));
  if (options.genre) filters.push(hasGenre(catalogItems.genres, options.genre));

  const ratings = sql<number>`count(${itemRatings.id})::int`;
  const avgElo = sql<number>`coalesce(avg(${itemRatings.elo}), ${START_ELO})::float`;

  const rows = await db
    .select({ item: catalogItems, ratings, avgElo })
    .from(catalogItems)
    .leftJoin(itemRatings, eq(itemRatings.itemId, catalogItems.id))
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(catalogItems.id)
    .having(sort === "new" ? undefined : sql`count(${itemRatings.id}) > 0`)
    .orderBy(
      sort === "rated"
        ? desc(sql`count(${itemRatings.id})`)
        : sort === "new"
          ? desc(catalogItems.createdAt)
          : desc(sql`coalesce(avg(${itemRatings.elo}), 0)`),
      // Stable tie-break: equal counts or averages otherwise come back in an
      // arbitrary order, which makes the page (and visual baselines) jitter.
      catalogItems.id,
    )
    .limit(Math.min(options.limit ?? 24, 60));

  // Down-weight reviewer pairs that vote in lockstep. Detection needs the
  // per-profile votes, not just the aggregate, so it runs over the same items.
  const itemIds = rows.map((row) => row.item.id);
  const votes =
    itemIds.length > 0
      ? await db
          .select({ orgId: itemRatings.orgId, itemId: itemRatings.itemId, elo: itemRatings.elo })
          .from(itemRatings)
          .where(inArray(itemRatings.itemId, itemIds))
      : [];
  const coordination = detectCoordinatedVoting(
    votes.map((vote) => ({ reviewerId: vote.orgId, itemId: vote.itemId, score: toScore(vote.elo) })),
  );

  return rows.map((row) => {
    const suspicious = coordination.suspiciousVotesByItem.get(row.item.id) ?? 0;
    const estimate = shrinkCommunityScore({
      mean: toScore(row.avgElo),
      count: row.ratings,
      suspicious,
    });
    return {
      ...mapCatalogItem(row.item),
      ratings: row.ratings,
      average: estimate.score,
      rawAverage: estimate.raw,
      confidence: estimate.confidence,
      suspicious: estimate.suspicious,
      coordination: estimate.coordination,
    };
  });
}
export interface SimilarItem extends CommunityItem {
  /** How many genres the two titles share. */
  overlap: number;
}

/**
 * Catalog titles that sit next to an item: same media kind, ranked by shared
 * genres first and community score second. Used for the "more like this" rail.
 */
export async function similarItems(itemId: string, limit = 8): Promise<SimilarItem[]> {
  const item = await getCatalogItem(itemId);
  if (!item) return [];
  const db = getDb();

  const rows = await db
    .select({
      item: catalogItems,
      ratings: sql<number>`count(${itemRatings.id})::int`,
      avgElo: sql<number>`coalesce(avg(${itemRatings.elo}), ${START_ELO})::float`,
    })
    .from(catalogItems)
    .leftJoin(itemRatings, eq(itemRatings.itemId, catalogItems.id))
    .where(and(eq(catalogItems.kind, item.kind), sql`${catalogItems.id} <> ${itemId}`))
    .groupBy(catalogItems.id)
    .limit(120);

  const wanted = new Set(item.genres.map((genre) => genre.toLowerCase()));
  return rows
    .map((row) => {
      const overlap = row.item.genres.filter((genre) => wanted.has(genre.toLowerCase())).length;
      const estimate = shrinkCommunityScore({
        mean: toScore(row.avgElo),
        count: row.ratings,
      });
      return {
        ...mapCatalogItem(row.item),
        ratings: row.ratings,
        average: estimate.score,
        rawAverage: estimate.raw,
        confidence: estimate.confidence,
        suspicious: estimate.suspicious,
        coordination: estimate.coordination,
        overlap,
      };
    })
    .sort((a, b) => b.overlap - a.overlap || (b.average ?? 0) - (a.average ?? 0) || b.ratings - a.ratings)
    .slice(0, limit);
}
export interface MoverItem extends CatalogItem {
  /** Elo gained (or lost) across this profile's decided matchups this week. */
  delta: number;
  votes: number;
}

/** The profile's biggest gainers over the last seven days of matchups. */
export async function weeklyMovers(orgId: string, limit = 5): Promise<MoverItem[]> {
  return withOrg(orgId, async (tx) => {
    const delta = sql<number>`coalesce(sum(${itemMatchups.itemEloAfter} - ${itemMatchups.itemEloBefore}), 0)::int`;
    const rows = await tx
      .select({ item: catalogItems, delta, votes: sql<number>`count(*)::int` })
      .from(itemMatchups)
      .innerJoin(catalogItems, eq(catalogItems.id, itemMatchups.itemId))
      .where(
        and(
          eq(itemMatchups.orgId, orgId),
          sql`${itemMatchups.result} <> 'skip'`,
          sql`${itemMatchups.createdAt} > now() - interval '7 days'`,
        ),
      )
      .groupBy(catalogItems.id)
      .orderBy(desc(delta))
      .limit(limit);

    return rows.map((row) => ({
      ...mapCatalogItem(row.item),
      delta: row.delta,
      votes: row.votes,
    }));
  });
}
