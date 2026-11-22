import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { MediaKind } from "@appolo/core";
import { withOrg, schema } from "@/lib/db";
import { toScore } from "./catalog-item";

/**
 * "Why is this #1?"
 *
 * The answer already exists in the data and was never surfaced: every
 * comparison stores the Elo before/after for both sides, so the exact amount a
 * vote moved an item is recoverable. This service re-reads that log from *both*
 * sides of each row — `recentMatchups` only looks at `item_id`, so an item that
 * was usually the opponent appeared to have no history at all, which is the gap
 * the audit found.
 */

const { catalogItems, itemRatings, itemMatchups } = schema;

export interface ComparisonMover {
  matchupId: string;
  at: Date;
  result: "win" | "loss" | "tie" | "skip" | "undecided";
  /** Elo this comparison applied to the item on this page (zero-sum). */
  delta: number;
  opponentId: string;
  opponentTitle: string;
  opponentScore: number | null;
}

export interface PositionNeighbour {
  id: string;
  title: string;
  score: number;
  comparisons: number;
  /** Elo expected score: how often this item would win a rematch. */
  beatsProbability: number;
}

export interface PositionExplanation {
  itemId: string;
  title: string;
  kind: MediaKind;
  score: number;
  position: number;
  /** How many items of this kind the account has ranked. */
  of: number;
  comparisons: number;
  skips: number;
  /** The item directly above (#1 looks at the item below instead). */
  neighbour: PositionNeighbour | null;
  /** Score distance to that neighbour, always positive. */
  gap: number;
  /** Biggest Elo movements, largest magnitude first. */
  movers: ComparisonMover[];
  /** Counted comparisons that involved this item, from either side. */
  countedMatchups: number;
  skippedMatchups: number;
}

const COUNTED = new Set(["win", "loss", "tie"]);

async function rivals(orgId: string, kind: MediaKind) {
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        id: catalogItems.id,
        title: catalogItems.title,
        elo: itemRatings.elo,
        matches: itemRatings.matches,
      })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(and(eq(itemRatings.orgId, orgId), eq(catalogItems.kind, kind))),
  );
  return rows
    .map((row) => ({ ...row, score: toScore(row.elo) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title)));
}

/** Elo expected score for `mine` against `theirs`. */
function beatsProbability(mine: number, theirs: number): number {
  return 1 / (1 + 10 ** ((theirs - mine) / 400));
}

export async function explainPosition(
  orgId: string,
  itemId: string,
): Promise<PositionExplanation | null> {
  const [own] = await withOrg(orgId, (tx) =>
    tx
      .select({ item: catalogItems, rating: itemRatings })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
      .limit(1),
  );
  if (!own) return null;

  const kind = own.item.kind as MediaKind;
  const ranked = await rivals(orgId, kind);
  const index = ranked.findIndex((row) => row.id === itemId);
  const position = index < 0 ? ranked.length : index + 1;

  // #1 compares itself with the runner-up; everything else with the item above.
  const neighbourRow = position > 1 ? ranked[index - 1] : ranked[1];
  const neighbour: PositionNeighbour | null = neighbourRow
    ? {
        id: neighbourRow.id,
        title: neighbourRow.title,
        score: neighbourRow.score,
        comparisons: neighbourRow.matches,
        beatsProbability: beatsProbability(own.rating.elo, neighbourRow.elo),
      }
    : null;

  // Both sides of the log: this item can appear as item_id or opponent_id.
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        id: itemMatchups.id,
        itemId: itemMatchups.itemId,
        opponentId: itemMatchups.opponentId,
        result: itemMatchups.result,
        createdAt: itemMatchups.createdAt,
        itemEloBefore: itemMatchups.itemEloBefore,
        itemEloAfter: itemMatchups.itemEloAfter,
        opponentEloBefore: itemMatchups.opponentEloBefore,
        opponentEloAfter: itemMatchups.opponentEloAfter,
      })
      .from(itemMatchups)
      .where(
        and(
          eq(itemMatchups.orgId, orgId),
          or(eq(itemMatchups.itemId, itemId), eq(itemMatchups.opponentId, itemId)),
        ),
      )
      .orderBy(desc(itemMatchups.createdAt))
      .limit(120),
  );

  const otherIds = [...new Set(rows.map((row) => (row.itemId === itemId ? row.opponentId : row.itemId)))];
  const titles = new Map<string, { title: string; score: number | null }>();
  if (otherIds.length > 0) {
    const catalog = await withOrg(orgId, (tx) =>
      tx
        .select({ id: catalogItems.id, title: catalogItems.title })
        .from(catalogItems)
        .where(inArray(catalogItems.id, otherIds)),
    );
    const scores = new Map(ranked.map((row) => [row.id, row.score]));
    for (const row of catalog) {
      titles.set(row.id, { title: row.title, score: scores.get(row.id) ?? null });
    }
  }

  let counted = 0;
  let skipped = 0;
  const movers: ComparisonMover[] = [];
  for (const row of rows) {
    const isItemA = row.itemId === itemId;
    const opponentId = isItemA ? row.opponentId : row.itemId;
    // Zero-sum: when this item is stored as the opponent, its before/after are
    // in the opponent columns.
    const delta = isItemA
      ? row.itemEloAfter - row.itemEloBefore
      : row.opponentEloAfter - row.opponentEloBefore;
    const mine = isItemA ? row.result : row.result === "win" ? "loss" : row.result === "loss" ? "win" : row.result;
    const result = (COUNTED.has(mine) ? mine : mine === "skip" ? "skip" : "undecided") as ComparisonMover["result"];

    if (COUNTED.has(row.result)) counted += 1;
    else skipped += 1;

    const opponent = titles.get(opponentId);
    movers.push({
      matchupId: row.id,
      at: row.createdAt,
      result,
      delta: Math.round(delta),
      opponentId,
      opponentTitle: opponent?.title ?? "a title since removed",
      opponentScore: opponent?.score ?? null,
    });
  }

  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.at.getTime() - a.at.getTime());

  return {
    itemId,
    title: own.item.title,
    kind,
    score: toScore(own.rating.elo),
    position,
    of: ranked.length,
    comparisons: own.rating.matches,
    skips: own.rating.skips,
    neighbour,
    gap: neighbour ? Math.round(Math.abs(own.rating.elo - (ranked[index === 0 ? 1 : index - 1]?.elo ?? own.rating.elo)) * 10) / 10 : 0,
    movers: movers.slice(0, 8),
    countedMatchups: counted,
    skippedMatchups: skipped,
  };
}
