import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  START_ELO,
  nextElo,
  scoreForElo,
  selectOpponent,
  withPositions,
  type MatchResult,
  type MediaKind,
} from "@appolo/core";
import { getDb, withOrg, schema, type Tx } from "@/lib/db";
import { DomainError } from "./errors";

const { catalogItems, itemRatings, itemMatchups } = schema;

export interface CatalogItem {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  imageUrl: string | null;
  tags: string[];
}

export interface RankedItem extends CatalogItem {
  elo: number;
  matches: number;
  wins: number;
  losses: number;
  skips: number;
  score: number;
  position: number;
}

export interface MatchupView {
  item: RankedItem;
  opponent: RankedItem;
}

export interface TasteStats {
  rated: number;
  matchups: number;
  averageScore: number;
  topKind: MediaKind | null;
}

function toScore(elo: number): number {
  return scoreForElo(elo);
}

/* ------------------------------------------------------------------ */
/* catalog (shared, not tenant-scoped)                                 */
/* ------------------------------------------------------------------ */

export async function listCatalog(options: {
  kind?: string;
  q?: string;
  limit?: number;
} = {}): Promise<CatalogItem[]> {
  const db = getDb();
  const filters = [];
  if (options.kind) filters.push(eq(catalogItems.kind, options.kind as MediaKind));
  if (options.q) {
    const like = `%${options.q}%`;
    filters.push(sql`(${catalogItems.title} ilike ${like} or ${catalogItems.subtitle} ilike ${like})`);
  }

  const rows = await db
    .select()
    .from(catalogItems)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(catalogItems.title)
    .limit(Math.min(options.limit ?? 60, 200));

  return rows.map(mapCatalogItem);
}

export async function getCatalogItem(itemId: string): Promise<CatalogItem | null> {
  const db = getDb();
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.id, itemId)).limit(1);
  return rows[0] ? mapCatalogItem(rows[0]) : null;
}

function mapCatalogItem(row: typeof catalogItems.$inferSelect): CatalogItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    year: row.year ?? null,
    imageUrl: row.imageUrl ?? null,
    tags: row.tags ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* rankings (org-scoped)                                               */
/* ------------------------------------------------------------------ */

/** Every item this org has ranked, ordered by Elo with positions + scores. */
export async function rankedRatings(orgId: string, options: { kind?: string; limit?: number } = {}): Promise<RankedItem[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        item: catalogItems,
        rating: itemRatings,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(options.kind ? eq(catalogItems.kind, options.kind as MediaKind) : undefined);

    const ranked = withPositions(
      rows.map(({ item, rating }) => ({
        ...mapCatalogItem(item),
        elo: rating.elo,
        matches: rating.matches,
        wins: rating.wins,
        losses: rating.losses,
        skips: rating.skips,
        score: toScore(rating.elo),
        position: 0,
      })),
    );
    return options.limit ? ranked.slice(0, options.limit) : ranked;
  });
}

export async function topFive(orgId: string): Promise<RankedItem[]> {
  return rankedRatings(orgId, { limit: 5 });
}

export async function getRating(orgId: string, itemId: string): Promise<RankedItem | null> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ item: catalogItems, rating: itemRatings })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.itemId, itemId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...mapCatalogItem(row.item),
      elo: row.rating.elo,
      matches: row.rating.matches,
      wins: row.rating.wins,
      losses: row.rating.losses,
      skips: row.rating.skips,
      score: toScore(row.rating.elo),
      position: 0,
    };
  });
}

export async function tasteStats(orgId: string): Promise<TasteStats> {
  return withOrg(orgId, async (tx) => {
    const [totals] = await tx
      .select({
        rated: sql<number>`count(*)::int`,
        matchups: sql<number>`coalesce(sum(${itemRatings.matches}), 0)::int`,
        avgElo: sql<number>`coalesce(avg(${itemRatings.elo}), ${START_ELO})::float`,
      })
      .from(itemRatings);

    const kindRows = await tx
      .select({
        kind: catalogItems.kind,
        n: sql<number>`count(*)::int`,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .groupBy(catalogItems.kind)
      .orderBy(sql`count(*) desc`)
      .limit(1);

    return {
      rated: totals?.rated ?? 0,
      matchups: totals?.matchups ?? 0,
      averageScore: toScore(totals?.avgElo ?? START_ELO),
      topKind: (kindRows[0]?.kind as MediaKind | undefined) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* head-to-head                                                        */
/* ------------------------------------------------------------------ */

/** Get the org's rating for an item, creating a default one on first use. */
async function getOrInitRating(tx: Tx, orgId: string, itemId: string) {
  const existing = await tx
    .select()
    .from(itemRatings)
    .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await tx
    .insert(itemRatings)
    .values({ orgId, itemId })
    .onConflictDoUpdate({
      target: [itemRatings.orgId, itemRatings.itemId],
      set: { updatedAt: new Date() },
    })
    .returning();
  return inserted[0]!;
}

/**
 * Pick the next head-to-head opponent for an item. Contenders are the other
 * catalog items of the same kind; recently faced opponents are deprioritised.
 */
export async function nextMatchup(orgId: string, itemId: string): Promise<MatchupView> {
  const item = await getCatalogItem(itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);

  return withOrg(orgId, async (tx) => {
    const rating =
      (
        await tx
          .select()
          .from(itemRatings)
          .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
          .limit(1)
      )[0] ?? { elo: START_ELO, matches: 0, wins: 0, losses: 0, skips: 0 };

    const poolRows = await tx
      .select({
        id: catalogItems.id,
        elo: sql<number>`coalesce(${itemRatings.elo}, ${START_ELO})::int`,
      })
      .from(catalogItems)
      .leftJoin(itemRatings, eq(itemRatings.itemId, catalogItems.id))
      .where(eq(catalogItems.kind, item.kind));

    const recentRows = await tx
      .select({ opponentId: itemMatchups.opponentId })
      .from(itemMatchups)
      .where(eq(itemMatchups.itemId, itemId))
      .orderBy(desc(itemMatchups.createdAt))
      .limit(5);
    const recentIds = recentRows.map((r) => r.opponentId);

    const opponent = selectOpponent(
      { id: item.id, elo: rating.elo },
      poolRows,
      { recentIds, seed: Date.now() & 0xffff },
    );
    if (!opponent) {
      throw new DomainError("NO_OPPONENT", "No other items to compare against yet.", 409);
    }

    const opponentItem = await tx
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.id, opponent.id))
      .limit(1);
    const row = opponentItem[0]!;

    return {
      item: { ...item, elo: rating.elo, matches: rating.matches, wins: rating.wins, losses: rating.losses, skips: rating.skips, score: toScore(rating.elo), position: 0 },
      opponent: {
        ...mapCatalogItem(row),
        elo: opponent.elo,
        matches: 0,
        wins: 0,
        losses: 0,
        skips: 0,
        score: toScore(opponent.elo),
        position: 0,
      },
    };
  });
}

export interface VoteResult {
  item: RankedItem;
  opponent: RankedItem;
  result: MatchResult;
  itemDelta: number;
}

/** Record one vote and update both Elo ratings (zero-sum). */
export async function submitVote(
  orgId: string,
  itemId: string,
  opponentId: string,
  result: MatchResult,
): Promise<VoteResult> {
  if (itemId === opponentId) {
    throw new DomainError("SAME_ITEM", "You cannot compare an item with itself.");
  }

  const [item, opponent] = await Promise.all([getCatalogItem(itemId), getCatalogItem(opponentId)]);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);
  if (!opponent) throw new DomainError("OPPONENT_NOT_FOUND", "That opponent is not in the catalog.", 404);
  if (item.kind !== opponent.kind) {
    throw new DomainError("KIND_MISMATCH", "Choose two items of the same kind.");
  }

  return withOrg(orgId, async (tx) => {
    const itemRating = await getOrInitRating(tx, orgId, itemId);
    const opponentRating = await getOrInitRating(tx, orgId, opponentId);

    const before = { item: itemRating.elo, opponent: opponentRating.elo };
    const after = nextElo(before.item, before.opponent, result);
    const counted = result !== "skip";

    const updatedItem = (
      await tx
        .update(itemRatings)
        .set({
          elo: after.a,
          matches: itemRating.matches + 1,
          wins: itemRating.wins + (result === "win" ? 1 : 0),
          losses: itemRating.losses + (result === "loss" ? 1 : 0),
          skips: itemRating.skips + (result === "skip" ? 1 : 0),
          updatedAt: new Date(),
        })
        .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
        .returning()
    )[0]!;

    const updatedOpponent = (
      await tx
        .update(itemRatings)
        .set({
          elo: after.b,
          matches: opponentRating.matches + 1,
          wins: opponentRating.wins + (result === "loss" ? 1 : 0),
          losses: opponentRating.losses + (result === "win" ? 1 : 0),
          skips: opponentRating.skips + (result === "skip" ? 1 : 0),
          updatedAt: new Date(),
        })
        .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, opponentId)))
        .returning()
    )[0]!;

    await tx.insert(itemMatchups).values({
      orgId,
      itemId,
      opponentId,
      result,
      itemEloBefore: before.item,
      itemEloAfter: after.a,
      opponentEloBefore: before.opponent,
      opponentEloAfter: after.b,
    });

    return {
      result,
      itemDelta: counted ? after.a - before.item : 0,
      item: { ...item, elo: updatedItem.elo, matches: updatedItem.matches, wins: updatedItem.wins, losses: updatedItem.losses, skips: updatedItem.skips, score: toScore(updatedItem.elo), position: 0 },
      opponent: { ...opponent, elo: updatedOpponent.elo, matches: updatedOpponent.matches, wins: updatedOpponent.wins, losses: updatedOpponent.losses, skips: updatedOpponent.skips, score: toScore(updatedOpponent.elo), position: 0 },
    };
  });
}

/** Recently completed matchups for an item, newest first. */
export async function recentMatchups(orgId: string, itemId: string, limit = 10) {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: itemMatchups.id,
        result: itemMatchups.result,
        itemEloBefore: itemMatchups.itemEloBefore,
        itemEloAfter: itemMatchups.itemEloAfter,
        createdAt: itemMatchups.createdAt,
        opponentTitle: catalogItems.title,
        opponentSubtitle: catalogItems.subtitle,
      })
      .from(itemMatchups)
      .innerJoin(catalogItems, eq(catalogItems.id, itemMatchups.opponentId))
      .where(eq(itemMatchups.itemId, itemId))
      .orderBy(desc(itemMatchups.createdAt))
      .limit(limit);
    return rows;
  });
}

/** Ids of items the org has ranked, useful for "already rated" badges. */
export async function ratedItemIds(orgId: string): Promise<string[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.select({ itemId: itemRatings.itemId }).from(itemRatings);
    return rows.map((r) => r.itemId);
  });
}

export async function catalogByIds(ids: string[]): Promise<CatalogItem[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(catalogItems).where(inArray(catalogItems.id, ids));
  return rows.map(mapCatalogItem);
}