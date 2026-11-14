import { and, eq, sql } from "drizzle-orm";
import { createCoalescingRunner, fitBradleyTerry, ComparisonEvent, CoalescingRunner, ComparisonOutcome, FittedItem, MediaKind } from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
const { catalogItems, itemMatchups, rankingModels } = schema;

type RankingRefreshGlobal = typeof globalThis & { __appoloRankingRefresh?: CoalescingRunner };
const modelRefresh = ((globalThis as RankingRefreshGlobal).__appoloRankingRefresh ??= createCoalescingRunner({
  delayMs: 750,
  onError: (error, key) => console.error(`ranking model refresh failed (${key})`, error),
}));
const refreshKey = (orgId: string, kind: MediaKind): string => `${orgId}:${kind}`;
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
