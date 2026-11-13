import { unstable_cache } from "next/cache";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  START_ELO,
  clamp,
  createCoalescingRunner,
  scoreForElo,
  selectOpponent,
  withPositions,
  fitBradleyTerry,
  pairKey,
  selectInformativeOpponent,
  shrinkCommunityScore,
  detectCoordinatedVoting,
  type CommunityConfidence,
  type ComparisonEvent,
  type CoalescingRunner,
  type ComparisonOutcome,
  type FittedItem,
  type MatchResult,
  type MediaKind,
} from "@appolo/core";
import { getDb, withOrg, schema, type Tx } from "@/lib/db";
import { DomainError } from "./errors";
import { scheduleCatalogEnrichment } from "./catalog-providers";
import { nextEloAdaptive } from "@appolo/core/ranking";

const { catalogItems, itemRatings, itemMatchups, watchlist, ratingEvents, catalogCredits, rankingModels, rankingOrder } = schema;

/**
 * Model rebuilds are coalesced per org and kind so a burst of votes pays for
 * one fit, not one per vote, and the vote response never waits for it. The
 * runner is stashed on `globalThis` because dev HMR re-evaluates this module
 * and would otherwise stack duplicate timers.
 */
type RankingRefreshGlobal = typeof globalThis & { __appoloRankingRefresh?: CoalescingRunner };
const modelRefresh = ((globalThis as RankingRefreshGlobal).__appoloRankingRefresh ??= createCoalescingRunner({
  delayMs: 750,
  onError: (error, key) => console.error(`ranking model refresh failed (${key})`, error),
}));

const refreshKey = (orgId: string, kind: MediaKind): string => `${orgId}:${kind}`;

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
/* Bradley–Terry model                                                 */
/* ------------------------------------------------------------------ */

export interface RankingModelView {
  kind: MediaKind;
  items: FittedItem[];
  byId: Map<string, FittedItem>;
  tieParameter: number;
  logLikelihood: number;
  converged: boolean;
  iterations: number;
  comparisons: number;
  updatedAt: Date | null;
}

/** Map a legacy/recorded matchup result onto the model's outcome vocabulary. */
export function outcomeForResult(result: string, stored?: string | null): ComparisonOutcome {
  if (stored === "a" || stored === "b" || stored === "tie" || stored === "undecided" || stored === "skip") {
    return stored;
  }
  switch (result) {
    case "win":
      return "a";
    case "loss":
      return "b";
    case "tie":
      return "tie";
    case "undecided":
      return "undecided";
    default:
      return "skip";
  }
}

function modelFromRow(row: typeof rankingModels.$inferSelect): RankingModelView {
  const state = (row.state ?? {}) as {
    items?: FittedItem[];
    tieParameter?: number;
    logLikelihood?: number;
    converged?: boolean;
    iterations?: number;
  };
  const items = Array.isArray(state.items) ? state.items : [];
  return {
    kind: row.kind,
    items,
    byId: new Map(items.map((item) => [item.id, item])),
    tieParameter: state.tieParameter ?? 0.55,
    logLikelihood: state.logLikelihood ?? 0,
    converged: state.converged ?? false,
    iterations: state.iterations ?? 0,
    comparisons: row.comparisons,
    updatedAt: row.updatedAt,
  };
}

/**
 * Rebuild one category's model from its full comparison history. `item_matchups`
 * is the source of truth: this function never writes to it, only to the cached
 * snapshot in `ranking_models`. Skipped/undecided votes are excluded by the
 * fitter, so they can never corrupt a ranking.
 */
export async function refreshRankingModel(
  orgId: string,
  kind: MediaKind,
): Promise<RankingModelView> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        itemId: itemMatchups.itemId,
        opponentId: itemMatchups.opponentId,
        result: itemMatchups.result,
        outcome: itemMatchups.outcome,
      })
      .from(itemMatchups)
      .innerJoin(catalogItems, eq(catalogItems.id, itemMatchups.itemId))
      .where(and(eq(itemMatchups.orgId, orgId), eq(catalogItems.kind, kind)));

    const events: ComparisonEvent[] = rows.map((row) => ({
      aId: row.itemId,
      bId: row.opponentId,
      outcome: outcomeForResult(row.result, row.outcome),
    }));

    const fit = fitBradleyTerry(events);
    const state = {
      items: fit.items,
      tieParameter: fit.tieParameter,
      logLikelihood: fit.logLikelihood,
      converged: fit.converged,
      iterations: fit.iterations,
    };

    const updated = (
      await tx
        .insert(rankingModels)
        .values({ orgId, kind, state, comparisons: events.length })
        .onConflictDoUpdate({
          target: [rankingModels.orgId, rankingModels.kind],
          set: { state, comparisons: events.length, updatedAt: new Date() },
        })
        .returning()
    )[0]!;

    return modelFromRow(updated);
  });
}

/**
 * Request a model rebuild without waiting for it. The 750 ms window collapses
 * rapid voting into a single fit, and callers never pay the fit latency.
 */
export function scheduleRankingRefresh(orgId: string, kind: MediaKind): void {
  modelRefresh.schedule(refreshKey(orgId, kind), async () => {
    await refreshRankingModel(orgId, kind);
  });
}

/** Drop a coalesced rebuild, e.g. when an explicit rebuild supersedes it. */
export function cancelRankingRefresh(orgId: string, kind: MediaKind): void {
  modelRefresh.cancel(refreshKey(orgId, kind));
}

/** How many comparisons the durable log holds for this kind. */
async function loggedComparisons(orgId: string, kind: MediaKind): Promise<number> {
  const [row] = await withOrg(orgId, (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(itemMatchups)
      .innerJoin(catalogItems, eq(catalogItems.id, itemMatchups.itemId))
      .where(and(eq(itemMatchups.orgId, orgId), eq(catalogItems.kind, kind))),
  );
  return row?.count ?? 0;
}

/**
 * Read the stored model, rebuilding when it is missing or behind the durable
 * comparison log. Pending coalesced work is flushed first so visiting the
 * rankings page right after a vote still shows that vote. The comparison check
 * also heals a snapshot lost to a restart, when no timer survives.
 */
export async function getRankingModel(
  orgId: string,
  kind: MediaKind,
): Promise<RankingModelView> {
  const key = refreshKey(orgId, kind);
  if (modelRefresh.isPending(key)) await modelRefresh.flush(key);

  const rows = await withOrg(orgId, (tx) =>
    tx
      .select()
      .from(rankingModels)
      .where(and(eq(rankingModels.orgId, orgId), eq(rankingModels.kind, kind)))
      .limit(1),
  );
  const stored = rows[0];
  if (!stored) return refreshRankingModel(orgId, kind);
  if ((await loggedComparisons(orgId, kind)) !== stored.comparisons) {
    return refreshRankingModel(orgId, kind);
  }
  return modelFromRow(stored);
}

export interface CrossKindFits {
  byId: Map<string, FittedItem>;
  comparisons: number;
  kindCount: number;
}

/**
 * Combine per-kind fitted models for the "All" rankings view. `personalScore`
 * is a 0–10 expected-wins score against that kind's own field, so it is
 * comparable across categories in a way raw theta is not.
 */
export async function rankingFitsForKinds(orgId: string, kinds: MediaKind[]): Promise<CrossKindFits> {
  const unique = [...new Set(kinds)];
  const models = await Promise.all(unique.map((kind) => getRankingModel(orgId, kind).catch(() => null)));
  const byId = new Map<string, FittedItem>();
  let comparisons = 0;
  let kindCount = 0;
  for (const model of models) {
    if (!model || model.items.length === 0) continue;
    kindCount += 1;
    comparisons += model.comparisons;
    for (const item of model.items) byId.set(item.id, item);
  }
  return { byId, comparisons, kindCount };
}

/* ------------------------------------------------------------------ */
/* catalog (shared, not tenant-scoped)                                 */
/* ------------------------------------------------------------------ */

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
  // Containment (not `= any(...)`) so the GIN index on genres can serve it.
  if (options.genre) filters.push(sql`${catalogItems.genres} @> array[${options.genre}]::text[]`);
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
  // Guard non-UUID path segments so Postgres does not raise a 22P02 error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
    return null;
  }
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
export async function rankedRatings(orgId: string, options: { kind?: string; limit?: number } = {}): Promise<RankedItem[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        item: catalogItems,
        rating: itemRatings,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(
        options.kind
          ? and(eq(itemRatings.orgId, orgId), eq(catalogItems.kind, options.kind as MediaKind))
          : eq(itemRatings.orgId, orgId),
      );

    const manual = options.kind
      ? await tx
          .select({ itemId: rankingOrder.itemId, position: rankingOrder.position })
          .from(rankingOrder)
          .where(and(eq(rankingOrder.orgId, orgId), eq(rankingOrder.kind, options.kind as MediaKind)))
      : [];
    const manualPositions = new Map(manual.map((row) => [row.itemId, row.position]));

    const items = rows.map(({ item, rating }) => ({
      ...mapCatalogItem(item),
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
      position: 0,
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
      ratingId: row.rating.id,
      elo: row.rating.elo,
      matches: row.rating.matches,
      wins: row.rating.wins,
      losses: row.rating.losses,
      skips: row.rating.skips,
      reviewText: row.rating.reviewText ?? null,
      reviewTags: row.rating.reviewTags ?? [],
      spoiler: row.rating.spoiler,
      photoUrl: row.rating.photoUrl ?? null,
      videoUrl: row.rating.videoUrl ?? null,
      favoriteCharacter: row.rating.favoriteCharacter ?? null,
      favoriteTracks: row.rating.favoriteTracks ?? [],
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
      .from(itemRatings)
      .where(eq(itemRatings.orgId, orgId));

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
      matchups: totals?.matchups ?? 0,
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
    .values(ids.map((itemId) => ({ orgId, itemId })))
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
      item: { ...item, ratingId: "", elo: rating.elo, matches: rating.matches, wins: rating.wins, losses: rating.losses, skips: rating.skips, score: toScore(rating.elo), position: 0, reviewText: rating.reviewText ?? null, reviewTags: rating.reviewTags ?? [], spoiler: false, photoUrl: null, videoUrl: null, favoriteCharacter: null, favoriteTracks: [] },
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
      outcome: outcomeForResult(result),
      itemEloBefore: before.item,
      itemEloAfter: after.a,
      opponentEloBefore: before.opponent,
      opponentEloAfter: after.b,
    });

    if (counted) {
      await tx.insert(ratingEvents).values({
        orgId,
        itemId,
        kind: "rated",
        detail:
          result === "tie"
            ? `Tied with ${opponent.title}`
            : `${result === "win" ? "Picked over" : "Lost to"} ${opponent.title}`,
      });
    }

    return {
      result,
      itemDelta: counted ? after.a - before.item : 0,
      item: { ...item, ratingId: updatedItem.id, elo: updatedItem.elo, matches: updatedItem.matches, wins: updatedItem.wins, losses: updatedItem.losses, skips: updatedItem.skips, score: toScore(updatedItem.elo), position: 0, reviewText: updatedItem.reviewText ?? null, reviewTags: updatedItem.reviewTags ?? [], spoiler: updatedItem.spoiler, photoUrl: updatedItem.photoUrl ?? null, videoUrl: updatedItem.videoUrl ?? null, favoriteCharacter: updatedItem.favoriteCharacter ?? null, favoriteTracks: updatedItem.favoriteTracks ?? [] },
      opponent: { ...opponent, ratingId: updatedOpponent.id, elo: updatedOpponent.elo, matches: updatedOpponent.matches, wins: updatedOpponent.wins, losses: updatedOpponent.losses, skips: updatedOpponent.skips, score: toScore(updatedOpponent.elo), position: 0, reviewText: updatedOpponent.reviewText ?? null, reviewTags: updatedOpponent.reviewTags ?? [], spoiler: updatedOpponent.spoiler, photoUrl: updatedOpponent.photoUrl ?? null, videoUrl: updatedOpponent.videoUrl ?? null, favoriteCharacter: updatedOpponent.favoriteCharacter ?? null, favoriteTracks: updatedOpponent.favoriteTracks ?? [] },
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
 * the durable matchup row is deleted, the matching timeline event is removed,
 * and the statistical model is rebuilt. Returns `undone: false` when there is
 * nothing to undo.
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

    const [itemRating] = await tx
      .select()
      .from(itemRatings)
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, row.itemId)))
      .limit(1);
    if (itemRating) {
      await tx
        .update(itemRatings)
        .set({
          elo: row.itemEloBefore,
          matches: Math.max(0, itemRating.matches - 1),
          wins: Math.max(0, itemRating.wins - (row.result === "win" ? 1 : 0)),
          losses: Math.max(0, itemRating.losses - (row.result === "loss" ? 1 : 0)),
          ties: Math.max(0, itemRating.ties - (row.result === "tie" ? 1 : 0)),
          skips: Math.max(0, itemRating.skips - skipDelta),
          updatedAt: new Date(),
        })
        .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, row.itemId)));
    }

    const [opponentRating] = await tx
      .select()
      .from(itemRatings)
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, row.opponentId)))
      .limit(1);
    if (opponentRating) {
      await tx
        .update(itemRatings)
        .set({
          elo: row.opponentEloBefore,
          matches: Math.max(0, opponentRating.matches - 1),
          wins: Math.max(0, opponentRating.wins - (row.result === "loss" ? 1 : 0)),
          losses: Math.max(0, opponentRating.losses - (row.result === "win" ? 1 : 0)),
          ties: Math.max(0, opponentRating.ties - (row.result === "tie" ? 1 : 0)),
          skips: Math.max(0, opponentRating.skips - skipDelta),
          updatedAt: new Date(),
        })
        .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, row.opponentId)));
    }

    await tx.delete(itemMatchups).where(eq(itemMatchups.id, row.id));

    if (countedEvent) {
      const [event] = await tx
        .select({ id: ratingEvents.id })
        .from(ratingEvents)
        .where(
          and(
            eq(ratingEvents.orgId, orgId),
            eq(ratingEvents.itemId, row.itemId),
            eq(ratingEvents.kind, "rated"),
          ),
        )
        .orderBy(desc(ratingEvents.createdAt))
        .limit(1);
      if (event) await tx.delete(ratingEvents).where(eq(ratingEvents.id, event.id));
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
  const elo = Math.round(1200 + clamp(score, 0, 10) * 60);

  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .insert(itemRatings)
      .values({ orgId, itemId, elo })
      .onConflictDoUpdate({
        target: [itemRatings.orgId, itemRatings.itemId],
        set: { elo, updatedAt: new Date() },
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
      ratingId: saved.id,
      elo: saved.elo,
      matches: saved.matches,
      wins: saved.wins,
      losses: saved.losses,
      skips: saved.skips,
      score: toScore(saved.elo),
      reviewText: saved.reviewText ?? null,
      reviewTags: saved.reviewTags ?? [],
      spoiler: saved.spoiler,
      photoUrl: saved.photoUrl ?? null,
      videoUrl: saved.videoUrl ?? null,
      favoriteCharacter: saved.favoriteCharacter ?? null,
      favoriteTracks: saved.favoriteTracks ?? [],
      position: 0,
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
  { revalidate: 60, tags: ["community-popular"] },
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

/**
 * The shared catalog ordered by community opinion rather than by one taste
 * profile. `top` ranks by average score, `rated` by how many people weighed
 * in, and `new` by the newest additions to the catalog.
 */
export async function catalogLeaderboard(
  options: { kind?: MediaKind; genre?: string; sort?: LeaderboardSort; limit?: number } = {},
): Promise<CommunityItem[]> {
  const db = getDb();
  const sort = options.sort ?? "top";
  const filters = [];
  if (options.kind) filters.push(eq(catalogItems.kind, options.kind));
  // Containment (not `= any(...)`) so the GIN index on genres can serve it.
  if (options.genre) filters.push(sql`${catalogItems.genres} @> array[${options.genre}]::text[]`);

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