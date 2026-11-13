/**
 * Community score aggregation.
 *
 * A raw average from one or two ratings is not a community verdict. We shrink
 * each item's mean toward a neutral prior in proportion to how little evidence
 * it has:
 *
 *   shrunk = (mean · n + priorMean · priorWeight) / (n + priorWeight)
 *
 * This is Bayesian-style shrinkage with a fixed prior. It stops a single
 * enthusiastic reviewer from putting an obscure title at the top of a public
 * leaderboard, while barely moving items with large samples.
 *
 * The prior mean (6.5) and weight (8) are documented starting values, not
 * calibrated constants. Popularity is tracked separately from rating quality.
 */

export type CommunityConfidence = "none" | "low" | "medium" | "high";

export interface CommunityScoreInput {
  /** Raw average score on the 0–10 scale. */
  mean: number;
  /** Number of contributors behind the average. */
  count: number;
  priorMean?: number;
  priorWeight?: number;
  /** Ratings flagged by coordinated-voting detection; each carries half weight. */
  suspicious?: number;
}

export interface CommunityScore {
  /** Conservative score shown publicly, 0–10 to one decimal. */
  score: number | null;
  /** Unsrunk average, for internal comparisons/debugging. */
  raw: number | null;
  count: number;
  confidence: CommunityConfidence;
  /** How far the prior moved the raw average (positive ⇒ pulled down). */
  adjustment: number;
  /** Evidence count after suspicious ratings are down-weighted. */
  effectiveCount: number;
  suspicious: number;
  coordination: "none" | "suspected";
}

export const COMMUNITY_PRIOR_MEAN = 6.5;
export const COMMUNITY_PRIOR_WEIGHT = 8;

export function communityConfidence(count: number): CommunityConfidence {
  if (count <= 0) return "none";
  if (count < 5) return "low";
  if (count < 20) return "medium";
  return "high";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shrinkCommunityScore(input: CommunityScoreInput): CommunityScore {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) {
    return {
      score: null,
      raw: null,
      count: 0,
      confidence: "none",
      adjustment: 0,
      effectiveCount: 0,
      suspicious: 0,
      coordination: "none",
    };
  }

  const suspicious = Math.min(count, Math.max(0, Math.floor(input.suspicious ?? 0)));
  // A coordinated vote counts as half a vote: it is not proof of bad faith,
  // but it is not independent evidence either.
  const effectiveCount = count - suspicious * 0.5;
  const priorMean = clamp(input.priorMean ?? COMMUNITY_PRIOR_MEAN, 0, 10);
  const priorWeight = Math.max(0, input.priorWeight ?? COMMUNITY_PRIOR_WEIGHT);
  const raw = clamp(input.mean, 0, 10);
  const shrunk =
    priorWeight === 0
      ? raw
      : (raw * effectiveCount + priorMean * priorWeight) / (effectiveCount + priorWeight);

  return {
    score: Math.round(clamp(shrunk, 0, 10) * 10) / 10,
    raw: Math.round(raw * 10) / 10,
    count,
    confidence: communityConfidence(effectiveCount),
    adjustment: Math.round((shrunk - raw) * 10) / 10,
    effectiveCount: Math.round(effectiveCount * 10) / 10,
    suspicious,
    coordination: suspicious > 0 ? "suspected" : "none",
  };
}
