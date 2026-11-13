/**
 * Coordinated-voting detection.
 *
 * Community scores are only as trustworthy as the independence of the people
 * behind them. Two accounts that rate the same titles in near-lockstep (same
 * direction and nearly the same scores) add less evidence than two independent
 * reviewers, even though they look identical to a plain average.
 *
 * This module looks for reviewer pairs with:
 *   - enough shared titles to rule out coincidence (`minShared`, default 5), and
 *   - close agreement on almost all of them (`flagAgreement`, default 0.9).
 *
 * It is deliberately conservative. It does not delete votes or accuse anyone:
 * it reports which votes are suspicious so aggregation can down-weight them and
 * the UI can say that coordination was suspected. Small communities will
 * naturally share titles; the thresholds require sustained, tight agreement.
 */

export interface CoordinationVote {
  reviewerId: string;
  itemId: string;
  /** Score on the same 0–10 scale used everywhere else. */
  score: number;
}

export interface CoordinationOptions {
  /** Shared titles required before a pair can be flagged. */
  minShared?: number;
  /** Absolute score difference still treated as agreement. */
  closeThreshold?: number;
  /** Share of shared titles that must agree. */
  flagAgreement?: number;
}

export interface CoordinationPair {
  a: string;
  b: string;
  shared: number;
  /** Fraction of shared titles rated within `closeThreshold`. */
  agreement: number;
  /** 0–1 heuristic: sustained, near-identical agreement. */
  suspicion: number;
}

export interface CoordinationReport {
  pairs: CoordinationPair[];
  /** Reviewer ids that are part of at least one flagged pair. */
  suspiciousReviewers: Set<string>;
  /** Flagged votes per item, counted once per reviewer and title. */
  suspiciousVotesByItem: Map<string, number>;
  /** Flagged votes per reviewer. */
  suspiciousVotesByReviewer: Map<string, number>;
}

export const DEFAULT_MIN_SHARED = 5;
export const DEFAULT_CLOSE_THRESHOLD = 0.5;
export const DEFAULT_FLAG_AGREEMENT = 0.9;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Detect reviewer pairs whose scores move together across shared titles.
 * Runs in O(Σ k²) over reviewers per item, which is fine for community sizes
 * where a single title has tens — not thousands — of ratings.
 */
export function detectCoordinatedVoting(
  votes: readonly CoordinationVote[],
  options: CoordinationOptions = {},
): CoordinationReport {
  const minShared = options.minShared ?? DEFAULT_MIN_SHARED;
  const closeThreshold = options.closeThreshold ?? DEFAULT_CLOSE_THRESHOLD;
  const flagAgreement = options.flagAgreement ?? DEFAULT_FLAG_AGREEMENT;

  const byItem = new Map<string, CoordinationVote[]>();
  for (const vote of votes) {
    if (!Number.isFinite(vote.score)) continue;
    const list = byItem.get(vote.itemId) ?? [];
    list.push(vote);
    byItem.set(vote.itemId, list);
  }

  interface PairAccumulator {
    a: string;
    b: string;
    shared: number;
    close: number;
    items: string[];
  }
  const pairs = new Map<string, PairAccumulator>();

  for (const [itemId, itemVotes] of byItem) {
    // One vote per reviewer per title; keep the first so duplicates cannot
    // inflate the shared count.
    const unique = new Map<string, CoordinationVote>();
    for (const vote of itemVotes) {
      if (!unique.has(vote.reviewerId)) unique.set(vote.reviewerId, vote);
    }
    const list = [...unique.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const first = list[i]!;
        const second = list[j]!;
        const [a, b] =
          first.reviewerId < second.reviewerId
            ? [first.reviewerId, second.reviewerId]
            : [second.reviewerId, first.reviewerId];
        const key = `${a}\u0000${b}`;
        const pair = pairs.get(key) ?? { a, b, shared: 0, close: 0, items: [] };
        pair.shared += 1;
        if (Math.abs(first.score - second.score) <= closeThreshold) pair.close += 1;
        pair.items.push(itemId);
        pairs.set(key, pair);
      }
    }
  }

  const flagged: CoordinationPair[] = [];
  const suspiciousReviewers = new Set<string>();
  const suspiciousVotesByItem = new Map<string, number>();
  const suspiciousVotesByReviewer = new Map<string, number>();

  for (const pair of pairs.values()) {
    if (pair.shared < minShared) continue;
    const agreement = pair.close / pair.shared;
    if (agreement < flagAgreement) continue;

    // Stronger suspicion when agreement is both high and sustained.
    const suspicion = clamp01(
      ((agreement - flagAgreement) / (1 - flagAgreement)) * 0.5 +
        Math.min(1, (pair.shared - minShared) / 10) * 0.5,
    );
    flagged.push({ a: pair.a, b: pair.b, shared: pair.shared, agreement, suspicion });
    suspiciousReviewers.add(pair.a);
    suspiciousReviewers.add(pair.b);

    // Each flagged vote counts once even if a reviewer has several partners.
    const seen = new Set<string>();
    for (const itemId of pair.items) {
      for (const reviewerId of [pair.a, pair.b]) {
        const key = `${reviewerId}\u0000${itemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        suspiciousVotesByItem.set(itemId, (suspiciousVotesByItem.get(itemId) ?? 0) + 1);
        suspiciousVotesByReviewer.set(
          reviewerId,
          (suspiciousVotesByReviewer.get(reviewerId) ?? 0) + 1,
        );
      }
    }
  }

  flagged.sort((left, right) => right.suspicion - left.suspicion);
  return { pairs: flagged, suspiciousReviewers, suspiciousVotesByItem, suspiciousVotesByReviewer };
}
