/**
 * Taste matching between two profiles.
 *
 * Every person's 0–10 scores are relative to their own taste, so comparing raw
 * numbers alone is misleading. We combine three signals:
 *
 *   1. rank agreement — Kendall's tau-b over shared items (tie-aware), mapped
 *      from [-1, 1] to [0, 1];
 *   2. rating similarity — 1 − normalised mean absolute score difference;
 *   3. profile similarity — cosine similarity of genre-count vectors, used to
 *      keep the score meaningful when the pair share very few titles.
 *
 * Coverage shrinks evidence-heavy signals toward the weaker profile signal as
 * shared items approach zero:
 *
 *   coverage = shared / (shared + 15)
 *   match    = 100 × (coverage × (0.70·rankAgreement + 0.30·ratingSimilarity)
 *                     + (1 − coverage) × profileSimilarity)
 *
 * The weights are documented starting values, not proven optima. A result is
 * only reported with a confidence label the data supports, and `null` means
 * "not enough information" rather than a fabricated percentage.
 */

export interface SharedScore {
  id: string;
  mine: number;
  theirs: number;
}

export type MatchConfidence = "low" | "medium" | "high";

export interface TasteMatchResult {
  /** 0–100, or null when there is no shared data and no profile signal. */
  match: number | null;
  /** 0–1 evidence weight behind the shared-item signals. */
  coverage: number;
  shared: number;
  agreements: number;
  /** (kendallTauB + 1) / 2, or null with fewer than two shared items. */
  rankAgreement: number | null;
  /** 1 − mean|Δscore| / 10, or null with no shared items. */
  ratingSimilarity: number | null;
  kendallTauB: number | null;
  confidence: MatchConfidence;
  /** Short human explanation of what the number rests on. */
  basis: string;
}

export const MIN_SHARED_FOR_RANK_AGREEMENT = 2;
export const HIGH_CONFIDENCE_SHARED = 20;
export const MEDIUM_CONFIDENCE_SHARED = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Kendall's tau-b for paired observations.
 *
 * tau-b is the tie-aware variant:
 *   (C − D) / sqrt((n0 − n1)(n0 − n2))
 * where C/D are concordant/discordant pairs, n0 = n(n−1)/2, and n1/n2 count
 * pairs tied in x/y. Items sharing a score are common in practice (lots of
 * 7.0s), so the tau-b correction matters.
 *
 * Returns null when fewer than two pairs exist or the denominator is zero.
 */
export function kendallTauB(pairs: readonly Pick<SharedScore, "mine" | "theirs">[]): number | null {
  const n = pairs.length;
  if (n < 2) return null;

  let concordant = 0;
  let discordant = 0;
  let tiedX = 0;
  let tiedY = 0;

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = pairs[i]!;
      const b = pairs[j]!;
      const dx = a.mine - b.mine;
      const dy = a.theirs - b.theirs;
      if (dx === 0 && dy === 0) {
        tiedX += 1;
        tiedY += 1;
      } else if (dx === 0) {
        tiedX += 1;
      } else if (dy === 0) {
        tiedY += 1;
      } else if (dx > 0 === dy > 0) {
        concordant += 1;
      } else {
        discordant += 1;
      }
    }
  }

  const n0 = (n * (n - 1)) / 2;
  const denominator = Math.sqrt((n0 - tiedX) * (n0 - tiedY));
  if (denominator === 0) return null;
  return clamp((concordant - discordant) / denominator, -1, 1);
}

/** Cosine similarity of two count vectors keyed by genre/creator. */
export function cosineSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number | null {
  if (a.size === 0 || b.size === 0) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, value] of a) {
    normA += value * value;
    const other = b.get(key);
    if (other !== undefined) dot += value * other;
  }
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return null;
  return clamp(dot / (Math.sqrt(normA) * Math.sqrt(normB)), 0, 1);
}

export interface TasteMatchInput {
  shared: readonly SharedScore[];
  /** Optional genre/count vectors for the profile-similarity term. */
  mineProfile?: ReadonlyMap<string, number>;
  theirsProfile?: ReadonlyMap<string, number>;
  /** Category filter, used only for the explanation text. */
  kindLabel?: string;
}

/**
 * Compare two taste profiles. The caller is responsible for supplying only
 * canonical item IDs and only titles both profiles actually ranked.
 */
export function tasteMatch(input: TasteMatchInput): TasteMatchResult {
  const shared = input.shared;
  const count = shared.length;

  const tau = kendallTauB(shared);
  const rankAgreement = tau === null ? null : (tau + 1) / 2;

  let ratingSimilarity: number | null = null;
  if (count > 0) {
    const meanAbsoluteDifference =
      shared.reduce((sum, pair) => sum + Math.abs(pair.mine - pair.theirs), 0) / count;
    ratingSimilarity = clamp(1 - meanAbsoluteDifference / 10, 0, 1);
  }

  const profileSimilarity = input.mineProfile && input.theirsProfile
    ? cosineSimilarity(input.mineProfile, input.theirsProfile)
    : null;

  const coverage = count / (count + 15);
  const evidence = 0.7 * (rankAgreement ?? 0.5) + 0.3 * (ratingSimilarity ?? 0.5);
  // With no genre vectors the shared-item evidence is the best fallback we
  // have; the coverage weight still stops one lucky match reading as 100%.
  const fallback = profileSimilarity ?? evidence;

  const match = count === 0 && profileSimilarity === null
    ? null
    : Math.round(clamp(100 * (coverage * evidence + (1 - coverage) * fallback), 0, 100));

  const confidence: MatchConfidence =
    count >= HIGH_CONFIDENCE_SHARED ? "high" : count >= MEDIUM_CONFIDENCE_SHARED ? "medium" : "low";

  const scope = input.kindLabel ? ` ${input.kindLabel}` : "";
  const basis =
    count === 0
      ? `No shared${scope} titles yet — this is a profile-only estimate.`
      : count < MIN_SHARED_FOR_RANK_AGREEMENT
        ? `Based on ${count} shared${scope} title; not enough for a ranking correlation.`
        : `${count} shared${scope} titles · ${confidence} confidence · `
          + `${tau === null ? "rank order unavailable" : `τ-b ${tau.toFixed(2)}`}, `
          + `${ratingSimilarity === null ? "rating gap unavailable" : `avg gap ${(10 * (1 - ratingSimilarity)).toFixed(1)}`}.`;

  return {
    match,
    coverage: Math.round(coverage * 100) / 100,
    shared: count,
    agreements: shared.filter((pair) => Math.abs(pair.mine - pair.theirs) <= 0.5).length,
    rankAgreement,
    ratingSimilarity,
    kendallTauB: tau,
    confidence,
    basis,
  };
}

/** Build a genre-count vector from items that carry genres. */
export function genreProfile(items: readonly { genres: readonly string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return counts;
}
