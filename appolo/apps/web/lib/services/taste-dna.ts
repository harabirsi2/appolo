import type { MediaKind } from "@appolo/core";
import { cosineSimilarity } from "@appolo/core";

/**
 * Taste DNA comparison.
 *
 * The 0–100 match itself comes from the shared ranking maths in
 * `@appolo/core/taste-match`. This module adds the explainable pieces the
 * product surfaces next to it:
 *
 *   - shared favorites: titles both people scored at least 8.5;
 *   - clashes: titles where the two scores differ by at least 2.5;
 *   - a category and genre radar: each profile's taste as a normalised
 *     distribution, plus the cosine similarity of the two vectors.
 *
 * Everything here is pure so it can be unit-tested without a database.
 */

export const SHARED_FAVORITE_MIN = 8.5;
export const CLASH_MIN_DIFF = 2.5;
export const RADAR_AXES = 8;

export interface ScoredEntry {
  item: { id: string; title: string; kind: MediaKind };
  mine: number;
  theirs: number;
  gap: number;
}

export interface SharedPick {
  itemId: string;
  title: string;
  kind: MediaKind;
  mine: number;
  theirs: number;
}

export interface RadarAxis {
  axis: string;
  /** 0–100 share of each profile's ratings on this axis. */
  mine: number;
  theirs: number;
  similarity: number;
}

/** Titles both profiles loved, lowest of the two scores first to break ties. */
export function sharedFavorites(entries: readonly ScoredEntry[]): SharedPick[] {
  return entries
    .filter((entry) => entry.mine >= SHARED_FAVORITE_MIN && entry.theirs >= SHARED_FAVORITE_MIN)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 12)
    .map(toPick);
}

/** Titles the two profiles disagree about, biggest disagreement first. */
export function tasteClashes(entries: readonly ScoredEntry[]): SharedPick[] {
  return entries
    .filter((entry) => Math.abs(entry.mine - entry.theirs) >= CLASH_MIN_DIFF)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 12)
    .map(toPick);
}

function toPick(entry: ScoredEntry): SharedPick {
  return {
    itemId: entry.item.id,
    title: entry.item.title,
    kind: entry.item.kind,
    mine: entry.mine,
    theirs: entry.theirs,
  };
}

/** Normalise a raw count vector to 0–100 shares. */
export function normalizeShares(counts: ReadonlyMap<string, number>): Map<string, number> {
  let total = 0;
  for (const value of counts.values()) total += value;
  const out = new Map<string, number>();
  if (total === 0) return out;
  for (const [key, value] of counts) out.set(key, Math.round((value / total) * 1000) / 10);
  return out;
}

/** Cosine similarity of the two distributions, 0–100. */
export function distributionSimilarity(
  mine: ReadonlyMap<string, number>,
  theirs: ReadonlyMap<string, number>,
): number | null {
  const cosine = cosineSimilarity(mine, theirs);
  return cosine === null ? null : Math.round(cosine * 100);
}

/**
 * Union of the two profiles' genre counts, limited to the most common axes.
 * The returned similarity is the cosine of the whole vectors, so a radar that
 * only shows its top axes still reports an honest overall number.
 */
export function genreRadar(
  mine: ReadonlyMap<string, number>,
  theirs: ReadonlyMap<string, number>,
  limit = RADAR_AXES,
): RadarAxis[] {
  const mineShares = normalizeShares(mine);
  const theirsShares = normalizeShares(theirs);
  const axes = [...new Set([...mineShares.keys(), ...theirsShares.keys()])];
  const similarity = distributionSimilarity(mine, theirs) ?? 0;
  return axes
    .map((axis) => ({
      axis,
      mine: mineShares.get(axis) ?? 0,
      theirs: theirsShares.get(axis) ?? 0,
      similarity,
    }))
    .sort((a, b) => Math.max(b.mine, b.theirs) - Math.max(a.mine, a.theirs))
    .slice(0, limit);
}

/** Category (media-kind) radar from raw counts. */
export function categoryRadar(
  mine: ReadonlyMap<string, number>,
  theirs: ReadonlyMap<string, number>,
): RadarAxis[] {
  return genreRadar(mine, theirs, 6);
}