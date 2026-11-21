import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { START_ELO, clamp, selectOpponent, withPositions, pairKey, selectInformativeOpponent, MatchResult, MediaKind } from "@appolo/core";
import { getCatalogItem, mapCatalogItem, toScore, type CatalogItem } from "./catalog-item";
import { getRankingModel, outcomeForResult, scheduleRankingRefresh } from "./ranking-math";
import { hasGenre } from "./genre-filter";
import { DomainError } from "./errors";
import { scheduleCatalogEnrichment } from "./catalog-providers";
import { nextEloAdaptive } from "@appolo/core/ranking";
import { getDb, withOrg, schema, type Tx } from "@/lib/db";
import { likeContains, likePrefix } from "./like-pattern";
const { catalogItems, itemRatings, itemMatchups, watchlist, ratingEvents, rankingOrder } = schema;

export interface RankedItem extends CatalogItem {
  ratingId: string;
  elo: number;
  matches: number;
  wins: number;
  losses: number;
  skips: number;
  score: number;
  reviewText: string | null;
  reviewTags: string[];
  spoiler: boolean;
  photoUrl: string | null;
  videoUrl: string | null;
  favoriteCharacter: string | null;
  favoriteTracks: string[];
  /** Optional per-aspect scores, e.g. { story: 9, visuals: 8 }. */
  subScores: Record<string, number>;
  /** Short micro-picks beyond character/tracks, e.g. "Best scene: ...". */
  highlights: string[];
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

/** Coerce the JSONB `sub_scores` column into safe 0–10 numbers. */
export function normalizeSubScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10) continue;
    out[key.trim().slice(0, 32)] = Math.round(n * 10) / 10;
  }
  return out;
}

/** Coerce the JSONB `highlights` column (array or `{ picks }`) into strings. */
export function normalizeHighlights(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { picks?: unknown }).picks)
      ? ((value as { picks: unknown[] }).picks)
      : [];
  return raw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 80))
    .slice(0, 5);
}

/** The per-profile side of a catalog item: score, record, review, micro-picks. */
function rankedExtras(rating: typeof itemRatings.$inferSelect): Omit<RankedItem, keyof CatalogItem> {
  return {
    ratingId: rating.id,
    elo: rating.elo,
    matches: rating.matches,
    wins: rating.wins,
    losses: rating.losses,
    skips: rating.skips,
    score: toScore(rating.elo),
    reviewText: rating.reviewText ?? null,
    reviewTags: rating.reviewTags ?? [],
    spoiler: rating.spoiler,
    photoUrl: rating.photoUrl ?? null,
    videoUrl: rating.videoUrl ?? null,
    favoriteCharacter: rating.favoriteCharacter ?? null,
    favoriteTracks: rating.favoriteTracks ?? [],
    subScores: normalizeSubScores(rating.subScores),
    highlights: normalizeHighlights(rating.highlights),
    position: 0,
  };
}
export async function listCatalog(options: {
  kind?: string;
  q?: string;
  genre?: string;
  limit?: number;
} = {}): Promise<CatalogItem[]> {
  const db = getDb();
  if (options.q && options.q.trim().length >= 3) {
    // Never block the local result set on a third-party lookup; hits are stored
    // in the background and picked up by the next search.
    scheduleCatalogEnrichment(options.kind, options.q.trim());
  }
  const filters = [];
  if (options.kind) filters.push(eq(catalogItems.kind, options.kind as MediaKind));
  if (options.genre) filters.push(hasGenre(catalogItems.genres, options.genre));
  if (options.q) {
    const like = likeContains(options.q);
    filters.push(sql`(${catalogItems.title} ilike ${like} or ${catalogItems.subtitle} ilike ${like})`);
  }

  const query = options.q?.trim();
  const order = query
    ? [
        sql`case
          when lower(${catalogItems.title}) = lower(${query}) then 3
          when ${catalogItems.title} ilike ${likePrefix(query)} then 2
          when ${catalogItems.subtitle} ilike ${likePrefix(query)} then 1
          else 0
        end desc`,
        sql`greatest(similarity(${catalogItems.title}, ${query}), coalesce(similarity(${catalogItems.subtitle}, ${query}), 0)) desc`,
        catalogItems.title,
      ]
    : [catalogItems.title];
  const rows = await db
    .select()
    .from(catalogItems)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(...order)
    .limit(Math.min(options.limit ?? 60, 200));

  return rows.map(mapCatalogItem);
}
export async function rankedRatings(
  orgId: string,
  options: { kind?: string; limit?: number; publicOnly?: boolean } = {},
): Promise<RankedItem[]> {
  return withOrg(orgId, async (tx) => {
    const filters = [eq(itemRatings.orgId, orgId)];
    if (options.kind) filters.push(eq(catalogItems.kind, options.kind as MediaKind));
    if (options.publicOnly) filters.push(eq(itemRatings.moderationStatus, "visible"));
    const rows = await tx
      .select({
        item: catalogItems,
        rating: itemRatings,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(and(...filters));

    const manual = options.kind
      ? await tx
          .select({ itemId: rankingOrder.itemId, position: rankingOrder.position })
          .from(rankingOrder)
          .where(and(eq(rankingOrder.orgId, orgId), eq(rankingOrder.kind, options.kind as MediaKind)))
      : [];
    const manualPositions = new Map(manual.map((row) => [row.itemId, row.position]));

    const items = rows.map(({ item, rating }) => ({
      ...mapCatalogItem(item),
      ...rankedExtras(rating),
    }));

    // A saved manual order wins over Elo for that kind; unplaced titles keep
    // their Elo order after the placed ones.
    const ranked = manualPositions.size
      ? items
          .slice()
          .sort((a, b) => {
            const positionA = manualPositions.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const positionB = manualPositions.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            if (positionA !== positionB) return positionA - positionB;
            return b.elo - a.elo;
          })
          .map((item, index) => ({ ...item, position: index + 1 }))
      : withPositions(items);
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
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...mapCatalogItem(row.item),
      ...rankedExtras(row.rating),
    };
  });
}
export async function tasteStats(orgId: string): Promise<TasteStats> {
  return withOrg(orgId, async (tx) => {
    const [totals] = await tx
      .select({
        rated: sql<number>`count(*)::int`,
        avgElo: sql<number>`coalesce(avg(${itemRatings.elo}), ${START_ELO})::float`,
      })
      .from(itemRatings)
      .where(eq(itemRatings.orgId, orgId));

    // "Matchups" means comparisons that were actually played. Counting the
    // denormalised per-item `matches` column double-counts (every vote bumps
    // both sides) and used to report history that no row backed.
    const [logged] = await tx
      .select({ matchups: sql<number>`count(*)::int` })
      .from(itemMatchups)
      .where(eq(itemMatchups.orgId, orgId));

    const kindRows = await tx
      .select({
        kind: catalogItems.kind,
        n: sql<number>`count(*)::int`,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.orgId, orgId))
      .groupBy(catalogItems.kind)
      .orderBy(sql`count(*) desc`)
      .limit(1);

    return {
      rated: totals?.rated ?? 0,
      matchups: logged?.matchups ?? 0,
      averageScore: toScore(totals?.avgElo ?? START_ELO),
      topKind: (kindRows[0]?.kind as MediaKind | undefined) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* head-to-head                                                        */
/* ------------------------------------------------------------------ */

/**
 * Load (or create) both ratings for a vote and lock them for the rest of the
 * transaction. Rows are inserted in one statement and locked in id order, so
 * two concurrent votes on the same pair cannot lose each other's Elo update
 * or deadlock by locking in opposite orders.
 */
async function getOrInitRatings(
  tx: Tx,
  orgId: string,
  itemIds: readonly [string, string],
): Promise<Map<string, typeof itemRatings.$inferSelect>> {
  const ids = [...new Set(itemIds)].sort();
  await tx
    .insert(itemRatings)
    .values(ids.map((itemId) => ({ orgId, itemId, source: "user" })))
    .onConflictDoNothing();

  const rows = await tx
    .select()
    .from(itemRatings)
    .where(and(eq(itemRatings.orgId, orgId), inArray(itemRatings.itemId, ids)))
    .orderBy(itemRatings.itemId)
    .for("update");

  const byItem = new Map(rows.map((row) => [row.itemId, row]));
  if (byItem.size !== ids.length) {
    throw new DomainError("RATING_INIT_FAILED", "Could not prepare those ratings.", 500);
  }
  return byItem;
}

/**
 * Pick the next head-to-head opponent for an item. Contenders are the other
 * catalog items of the same kind; recently faced opponents are deprioritised.
 */
export async function nextMatchup(orgId: string, itemId: string): Promise<MatchupView> {
  const item = await getCatalogItem(itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);

  // The fitted model is read before the transaction so selection can use the
  // thetas and standard errors rather than raw Elo alone.
  const model = await getRankingModel(orgId, item.kind).catch(() => null);

  return withOrg(orgId, async (tx) => {
    const rating =
      (
        await tx
          .select()
          .from(itemRatings)
          .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
          .limit(1)
      )[0] ?? { elo: START_ELO, matches: 0, wins: 0, losses: 0, skips: 0, reviewText: null, reviewTags: [] };

    const poolRows = await tx
      .select({
        id: catalogItems.id,
        elo: sql<number>`coalesce(${itemRatings.elo}, ${START_ELO})::int`,
        rated: sql<boolean>`${itemRatings.id} is not null`,
      })
      .from(catalogItems)
      .leftJoin(
        itemRatings,
        and(eq(itemRatings.itemId, catalogItems.id), eq(itemRatings.orgId, orgId)),
      )
      .where(eq(catalogItems.kind, item.kind));

    // Compare against titles this account has already ranked. Fall back to the
    // whole catalog only while it has nothing else to compare with.
    const ratedPool = poolRows.filter((row) => row.rated && row.id !== item.id);
    const pool = ratedPool.length > 0 ? ratedPool : poolRows;

    const recentRows = await tx
      .select({ opponentId: itemMatchups.opponentId })
      .from(itemMatchups)
      .where(and(eq(itemMatchups.orgId, orgId), eq(itemMatchups.itemId, itemId)))
      .orderBy(desc(itemMatchups.createdAt))
      .limit(5);
    const recentIds = recentRows.map((r) => r.opponentId);

    // Pair history for the target, used to stop the same question repeating.
    const pairRows = await tx
      .select({ itemId: itemMatchups.itemId, opponentId: itemMatchups.opponentId })
      .from(itemMatchups)
      .where(
        and(
          eq(itemMatchups.orgId, orgId),
          or(eq(itemMatchups.itemId, itemId), eq(itemMatchups.opponentId, itemId)),
        ),
      );
    const pairCounts = new Map<string, number>();
    for (const row of pairRows) {
      const key = pairKey(row.itemId, row.opponentId);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    const exposure = new Map<string, number>();
    for (const entry of model?.items ?? []) exposure.set(entry.id, entry.comparisons);

    const candidates = pool.map((row) => ({
      id: row.id,
      theta: model?.byId.get(row.id)?.theta ?? 0,
      standardError: model?.byId.get(row.id)?.standardError ?? 1,
    }));

    // Prefer the matchup that teaches the model most. Fall back to the
    // Elo-distance heuristic when no model is available yet.
    const informativeId =
      candidates.length > 1
        ? selectInformativeOpponent({
            targetId: item.id,
            targetTheta: model?.byId.get(item.id)?.theta ?? 0,
            targetStandardError: model?.byId.get(item.id)?.standardError ?? 1,
            candidates,
            pairCounts,
            exposure,
            recentIds,
            tieParameter: model?.tieParameter,
          })
        : null;

    const opponent = informativeId
      ? pool.find((row) => row.id === informativeId) ?? null
      : selectOpponent({ id: item.id, elo: rating.elo }, pool, {
          recentIds,
          seed: Date.now() & 0xffff,
        });
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
      item: { ...item, ratingId: "", elo: rating.elo, matches: rating.matches, wins: rating.wins, losses: rating.losses, skips: rating.skips, score: toScore(rating.elo), position: 0, reviewText: rating.reviewText ?? null, reviewTags: rating.reviewTags ?? [], spoiler: false, photoUrl: null, videoUrl: null, favoriteCharacter: null, favoriteTracks: [], subScores: {}, highlights: [] },
      opponent: {
        ...mapCatalogItem(row),
        ratingId: "",
        elo: opponent.elo,
        matches: 0,
        wins: 0,
        losses: 0,
        skips: 0,
        score: toScore(opponent.elo),
        position: 0,
        reviewText: null,
        reviewTags: [],
        spoiler: false,
        photoUrl: null,
        videoUrl: null,
        favoriteCharacter: null,
        favoriteTracks: [],
        subScores: {},
        highlights: [],
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

  const output = await withOrg(orgId, async (tx) => {
    const ratings = await getOrInitRatings(tx, orgId, [itemId, opponentId]);
    const itemRating = ratings.get(itemId)!;
    const opponentRating = ratings.get(opponentId)!;

    const before = { item: itemRating.elo, opponent: opponentRating.elo };
    const after = nextEloAdaptive(
      before.item,
      before.opponent,
      result,
      itemRating.wins + itemRating.losses,
      opponentRating.wins + opponentRating.losses,
    );
    const counted = result !== "skip" && result !== "undecided";

    const updatedItem = (
      await tx
        .update(itemRatings)
        .set({
          elo: after.a,
          matches: itemRating.matches + 1,
          wins: itemRating.wins + (result === "win" ? 1 : 0),
          losses: itemRating.losses + (result === "loss" ? 1 : 0),
          ties: itemRating.ties + (result === "tie" ? 1 : 0),
          skips:
            itemRating.skips + (result === "skip" || result === "undecided" ? 1 : 0),
          source: "user",
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
          ties: opponentRating.ties + (result === "tie" ? 1 : 0),
          skips:
            opponentRating.skips + (result === "skip" || result === "undecided" ? 1 : 0),
          source: "user",
          updatedAt: new Date(),
        })
        .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, opponentId)))
        .returning()
    )[0]!;

    // The timeline event is written first so the matchup can carry its id.
    // Undo then deletes exactly the event this comparison created instead of
    // guessing at the newest `rated` event for the item.
    let eventId: string | null = null;
    if (counted) {
      const [event] = await tx
        .insert(ratingEvents)
        .values({
          orgId,
          itemId,
          kind: "rated",
          detail:
            result === "tie"
              ? `Tied with ${opponent.title}`
              : `${result === "win" ? "Picked over" : "Lost to"} ${opponent.title}`,
        })
        .returning({ id: ratingEvents.id });
      eventId = event?.id ?? null;
    }

    await tx.insert(itemMatchups).values({
      orgId,
      itemId,
      opponentId,
      result,
      outcome: outcomeForResult(result),
      itemEloBefore: before.item,
      itemEloAfter: after.a,
      opponentEloBefore: before.opponent,
      opponentEloAfter: after.b,
      eventId,
    });

    return {
      result,
      itemDelta: counted ? after.a - before.item : 0,
      item: { ...item, ...rankedExtras(updatedItem) },
      opponent: { ...opponent, ...rankedExtras(updatedOpponent) },
    };
  });

  // The vote is committed; rebuild the statistical snapshot in the background.
  // Coalescing keeps a burst of votes to one fit, and getRankingModel heals
  // the snapshot from item_matchups if this process never gets to it.
  scheduleRankingRefresh(orgId, item.kind);

  return output;
}
export interface UndoResult {
  undone: boolean;
  itemId: string;
  opponentId: string;
}

/**
 * Undo the most recent comparison that involved this item.
 *
 * Elo values are restored from the stored `*_elo_before` columns (not
 * recomputed heuristically), counters are decremented for the exact outcome,
 * the durable matchup row is deleted, the timeline event stored on that row is
 * removed, and the statistical model is rebuilt. Returns `undone: false` when
 * there is nothing to undo.
 *
 * Both rating rows are locked through `getOrInitRatings`, the same helper a
 * vote uses, so the counters below are read under the lock (a concurrent vote
 * can no longer be overwritten) and the ids are always locked in sorted order
 * (undo can no longer deadlock against a vote).
 */
export async function undoLastComparison(orgId: string, itemId: string): Promise<UndoResult> {
  const item = await getCatalogItem(itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);

  const output = await withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(itemMatchups)
      .where(
        and(
          eq(itemMatchups.orgId, orgId),
          or(eq(itemMatchups.itemId, itemId), eq(itemMatchups.opponentId, itemId)),
        ),
      )
      .orderBy(desc(itemMatchups.createdAt))
      .limit(1)
      // Two undo clicks must not decrement the same matchup twice: the second
      // transaction waits here, then finds the row gone.
      .for("update");

    if (!row) return { undone: false, itemId, opponentId: itemId } satisfies UndoResult;

    const skipDelta = row.result === "skip" || row.result === "undecided" ? 1 : 0;
    // Must mirror submitVote: ties are counted and do write a `rated` event,
    // so undoing one has to remove it too.
    const countedEvent = row.result !== "skip" && row.result !== "undecided";

    // Lock both rating rows in sorted id order (the same order a vote uses)
    // before reading any counter, so a vote committing between the matchup read
    // and the update can no longer be silently overwritten.
    const ratings = await getOrInitRatings(tx, orgId, [row.itemId, row.opponentId]);
    const itemRating = ratings.get(row.itemId)!;
    const opponentRating = ratings.get(row.opponentId)!;

    // The rows are already locked, so these two updates cannot interleave with
    // a vote; ordering them by id merely keeps the write order predictable.
    const itemUpdate = {
      elo: row.itemEloBefore,
      matches: Math.max(0, itemRating.matches - 1),
      wins: Math.max(0, itemRating.wins - (row.result === "win" ? 1 : 0)),
      losses: Math.max(0, itemRating.losses - (row.result === "loss" ? 1 : 0)),
      ties: Math.max(0, itemRating.ties - (row.result === "tie" ? 1 : 0)),
      skips: Math.max(0, itemRating.skips - skipDelta),
      updatedAt: new Date(),
    };
    const opponentUpdate = {
      elo: row.opponentEloBefore,
      matches: Math.max(0, opponentRating.matches - 1),
      wins: Math.max(0, opponentRating.wins - (row.result === "loss" ? 1 : 0)),
      losses: Math.max(0, opponentRating.losses - (row.result === "win" ? 1 : 0)),
      ties: Math.max(0, opponentRating.ties - (row.result === "tie" ? 1 : 0)),
      skips: Math.max(0, opponentRating.skips - skipDelta),
      updatedAt: new Date(),
    };

    const [firstId, firstUpdate, secondId, secondUpdate] =
      row.itemId < row.opponentId
        ? ([row.itemId, itemUpdate, row.opponentId, opponentUpdate] as const)
        : ([row.opponentId, opponentUpdate, row.itemId, itemUpdate] as const);

    await tx
      .update(itemRatings)
      .set(firstUpdate)
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, firstId)));
    await tx
      .update(itemRatings)
      .set(secondUpdate)
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, secondId)));

    // Delete the matchup before the event: the `event_id` foreign key nulls
    // itself out otherwise, which is harmless but noisier.
    await tx.delete(itemMatchups).where(eq(itemMatchups.id, row.id));

    if (countedEvent) {
      if (row.eventId) {
        await tx
          .delete(ratingEvents)
          .where(and(eq(ratingEvents.orgId, orgId), eq(ratingEvents.id, row.eventId)));
      } else {
        // Legacy row from before the event id existed. The event was written
        // in the same transaction, so it shares this timestamp exactly — the
        // same fingerprint the backfill uses. Never fall back to "the newest
        // rated event for this item": that is what orphaned events before.
        await tx
          .delete(ratingEvents)
          .where(
            and(
              eq(ratingEvents.orgId, orgId),
              eq(ratingEvents.itemId, row.itemId),
              eq(ratingEvents.kind, "rated"),
              eq(ratingEvents.createdAt, row.createdAt),
            ),
          );
      }
    }

    return { undone: true, itemId: row.itemId, opponentId: row.opponentId } satisfies UndoResult;
  });

  if (output.undone) {
    scheduleRankingRefresh(orgId, item.kind);
  }

  return output;
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
      .where(and(eq(itemMatchups.orgId, orgId), eq(itemMatchups.itemId, itemId)))
      .orderBy(desc(itemMatchups.createdAt))
      .limit(limit);
    return rows;
  });
}

/** Ids of items the org has ranked, useful for "already rated" badges. */
export async function ratedItemIds(orgId: string): Promise<string[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.select({ itemId: itemRatings.itemId }).from(itemRatings).where(eq(itemRatings.orgId, orgId));
    return rows.map((r) => r.itemId);
  });
}
export async function catalogByIds(ids: string[]): Promise<CatalogItem[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(catalogItems).where(inArray(catalogItems.id, ids));
  return rows.map(mapCatalogItem);
}

/* ------------------------------------------------------------------ */
/* manual mode, watchlist, history, discovery                          */
/* ------------------------------------------------------------------ */

/** Set an exact 0–10 score without playing the matchup game. */
export async function setManualRating(orgId: string, itemId: string, score: number): Promise<RankedItem> {
  const item = await getCatalogItem(itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);
  const clamped = clamp(score, 0, 10);
  const elo = Math.round(1200 + clamped * 60);

  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .insert(itemRatings)
      .values({ orgId, itemId, elo, manualScore: clamped.toFixed(1), source: "user" })
      .onConflictDoUpdate({
        target: [itemRatings.orgId, itemRatings.itemId],
        set: { elo, manualScore: clamped.toFixed(1), source: "user", updatedAt: new Date() },
      })
      .returning();
    await tx.insert(ratingEvents).values({
      orgId,
      itemId,
      kind: "manual",
      detail: `Set to ${clamp(score, 0, 10).toFixed(1)}`,
    });
    const saved = row!;
    return {
      ...item,
      ...rankedExtras(saved),
    };
  });
}

/** Whether this org has saved an explicit order for a media kind. */
export async function hasManualOrder(orgId: string, kind: MediaKind): Promise<boolean> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ itemId: rankingOrder.itemId })
      .from(rankingOrder)
      .where(and(eq(rankingOrder.orgId, orgId), eq(rankingOrder.kind, kind)))
      .limit(1);
    return rows.length > 0;
  });
}
export interface ReorderResult {
  order: string[];
  /** Titles whose position actually changed and produced an audit event. */
  moved: number;
}

/**
 * Replace the org's manual order for one kind. The caller must send every
 * ranked title in that kind exactly once, so the stored order always covers the
 * whole list instead of leaving ambiguous gaps.
 *
 * Positions are recorded in `ranking_order` and each changed title gets a
 * `manual-order` entry in `rating_events`; no matchups are fabricated.
 */
export async function reorderRankings(
  orgId: string,
  kind: MediaKind,
  itemIds: string[],
): Promise<ReorderResult> {
  const unique = [...new Set(itemIds)];
  if (unique.length !== itemIds.length) {
    throw new DomainError("ORDER_DUPLICATE", "Each title may appear only once in a manual order.", 400);
  }
  if (unique.length === 0) {
    throw new DomainError("ORDER_EMPTY", "Send at least one ranked title.", 400);
  }

  return withOrg(orgId, async (tx) => {
    const rated = await tx
      .select({ itemId: itemRatings.itemId })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(and(eq(itemRatings.orgId, orgId), eq(catalogItems.kind, kind)));
    const ratedIds = new Set(rated.map((row) => row.itemId));
    if (unique.length !== ratedIds.size || unique.some((itemId) => !ratedIds.has(itemId))) {
      throw new DomainError(
        "ORDER_INCOMPLETE",
        "Reorder every ranked title in this category, using only titles you have rated.",
        400,
      );
    }

    const previous = await tx
      .select({ itemId: rankingOrder.itemId, position: rankingOrder.position })
      .from(rankingOrder)
      .where(and(eq(rankingOrder.orgId, orgId), eq(rankingOrder.kind, kind)));
    const previousPositions = new Map(previous.map((row) => [row.itemId, row.position]));

    await tx.delete(rankingOrder).where(and(eq(rankingOrder.orgId, orgId), eq(rankingOrder.kind, kind)));
    await tx.insert(rankingOrder).values(
      unique.map((itemId, index) => ({
        orgId,
        kind,
        itemId,
        position: index + 1,
        updatedAt: new Date(),
      })),
    );

    const events = unique.flatMap((itemId, index) => {
      const before = previousPositions.get(itemId);
      if (before === index + 1) return [];
      return [
        {
          orgId,
          itemId,
          kind: "manual-order",
          detail: before === undefined ? `Placed at #${index + 1}` : `Moved #${before} → #${index + 1}`,
        },
      ];
    });
    if (events.length > 0) await tx.insert(ratingEvents).values(events);

    return { order: unique, moved: events.length } satisfies ReorderResult;
  });
}

/** Add or remove an item from the org's watchlist. */
export async function toggleWatchlist(orgId: string, itemId: string): Promise<{ watching: boolean }> {
  // Without this, an unknown (but well-formed) id hits a foreign-key error and
  // surfaces as a 500 instead of a 404.
  if (!(await getCatalogItem(itemId))) {
    throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);
  }
  return withOrg(orgId, async (tx) => {
    const existing = await tx
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(and(eq(watchlist.orgId, orgId), eq(watchlist.itemId, itemId)))
      .limit(1);
    if (existing[0]) {
      await tx.delete(watchlist).where(eq(watchlist.id, existing[0].id));
      return { watching: false };
    }
    await tx.insert(watchlist).values({ orgId, itemId }).onConflictDoNothing();
    return { watching: true };
  });
}
export async function isWatchlisted(orgId: string, itemId: string): Promise<boolean> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(and(eq(watchlist.orgId, orgId), eq(watchlist.itemId, itemId)))
      .limit(1);
    return Boolean(rows[0]);
  });
}
export async function watchlistFor(orgId: string): Promise<Array<CatalogItem & { addedAt: Date }>> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ item: catalogItems, addedAt: watchlist.createdAt })
      .from(watchlist)
      .innerJoin(catalogItems, eq(catalogItems.id, watchlist.itemId))
      .where(eq(watchlist.orgId, orgId))
      .orderBy(desc(watchlist.createdAt));
    return rows.map((row) => ({ ...mapCatalogItem(row.item), addedAt: row.addedAt }));
  });
}
export interface HistoryEntry {
  id: string;
  kind: string;
  detail: string | null;
  createdAt: Date;
  item: CatalogItem;
}
export async function ratingHistory(orgId: string, limit = 60): Promise<HistoryEntry[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ event: ratingEvents, item: catalogItems })
      .from(ratingEvents)
      .innerJoin(catalogItems, eq(catalogItems.id, ratingEvents.itemId))
      .where(eq(ratingEvents.orgId, orgId))
      .orderBy(desc(ratingEvents.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.event.id,
      kind: row.event.kind,
      detail: row.event.detail ?? null,
      createdAt: row.event.createdAt,
      item: mapCatalogItem(row.item),
    }));
  });
}

/* Re-exported so existing imports from "./rankings" keep working. */
export type { CatalogItem } from "./catalog-item";
export { getCatalogItem, mapCatalogItem } from "./catalog-item";
export * from "./ranking-math";
export * from "./leaderboard";
