/**
 * Deterministic, explainable ranking for the home feed.
 *
 * The feed mixes four signals instead of just "newest first":
 *   - freshness  exponential decay on the review's last edit time
 *   - affinity   reviews written by accounts the viewer follows
 *   - relevance  genre overlap with what the viewer has rated highly
 *   - engagement reactions and comments the review has collected
 *
 * A small hash-based exploration bonus keeps tied, equally good reviews from
 * always appearing in the same order for every viewer and avoids a feed that
 * never changes. Every ranked entry carries a human-readable reason so the UI
 * can explain why it was shown.
 */

export interface FeedInput {
  id: string;
  authorId: string;
  /** Last edit time of the review. */
  createdAt: Date | string | number;
  /** Author's rating, used only for deterministic tie-breaking today. */
  score?: number;
  genres?: readonly string[];
  /** Media kind, used by the diversity pass to avoid kind runs. */
  kind?: string;
  followed?: boolean;
  reactions?: number;
  comments?: number;
}

export interface FeedContext {
  now?: Date;
  /** Accounts the viewer follows (their reviews get the affinity boost). */
  followedAuthorIds?: Iterable<string>;
  /** Genre names mapped to a positive weight, e.g. counts from the viewer's ratings. */
  genreWeights?: Readonly<Record<string, number>>;
  /** Reviews already shown elsewhere, excluded from the result. */
  seenIds?: Iterable<string>;
}

export interface FeedWeights {
  freshness: number;
  engagement: number;
  affinity: number;
  relevance: number;
}

export interface FeedOptions {
  /** Time for the freshness signal to halve. Default 36 hours. */
  halfLifeHours?: number;
  /** Maximum exploration bonus, added after the weighted sum. Default 0.06. */
  exploration?: number;
  weights?: Partial<FeedWeights>;
}

export type FeedReasonCode = "followed" | "taste" | "popular" | "fresh";

export interface FeedReason {
  code: FeedReasonCode;
  label: string;
}

export interface RankedFeedEntry<T extends FeedInput> {
  item: T;
  score: number;
  components: FeedWeights & { exploration: number };
  reason: FeedReason;
}

const DEFAULT_WEIGHTS: FeedWeights = {
  freshness: 0.34,
  engagement: 0.2,
  affinity: 0.3,
  relevance: 0.16,
};

const DEFAULT_HALF_LIFE_HOURS = 36;
const DEFAULT_EXPLORATION = 0.06;

const REASONS: Record<FeedReasonCode, string> = {
  followed: "From someone you follow",
  taste: "Matches your taste",
  popular: "Popular right now",
  fresh: "Fresh pick",
};

/** FNV-1a mapped into [0, 1). Stable across processes and deploys. */
export function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

/** Turn a list of genres into normalised weights (share of the viewer's ratings). */
export function normalizeGenreWeights(genres: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const raw of genres) {
    const genre = raw.trim().toLowerCase();
    if (!genre) continue;
    counts[genre] = (counts[genre] ?? 0) + 1;
    total += 1;
  }
  if (total === 0) return {};
  for (const key of Object.keys(counts)) counts[key] = (counts[key] ?? 0) / total;
  return counts;
}

/**
 * Merge rating-derived genre weights with onboarding interests.
 *
 * Interests act as a prior: they keep `priorShare` of the total weight even as
 * ratings accumulate, so a brand-new profile still gets a relevant feed while an
 * established profile is nudged rather than overridden by a few picks.
 */
export function blendGenreWeights(
  ratingWeights: Readonly<Record<string, number>>,
  interests: Iterable<string>,
  options: { priorShare?: number } = {},
): Record<string, number> {
  const prior = normalizeGenreWeights(interests);
  const priorShare = Math.min(0.9, Math.max(0, options.priorShare ?? 0.35));

  if (Object.keys(prior).length === 0) return { ...ratingWeights };
  if (Object.keys(ratingWeights).length === 0) return prior;

  const blended: Record<string, number> = {};
  for (const [genre, weight] of Object.entries(ratingWeights)) {
    blended[genre] = (blended[genre] ?? 0) + weight * (1 - priorShare);
  }
  for (const [genre, weight] of Object.entries(prior)) {
    blended[genre] = (blended[genre] ?? 0) + weight * priorShare;
  }

  let total = 0;
  for (const weight of Object.values(blended)) total += weight;
  if (total <= 0) return {};
  for (const genre of Object.keys(blended)) blended[genre] = (blended[genre] ?? 0) / total;
  return blended;
}

function ageHours(createdAt: FeedInput["createdAt"], now: Date): number {
  const time = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return DEFAULT_HALF_LIFE_HOURS * 4;
  return Math.max(0, (now.getTime() - time) / 3_600_000);
}

function relevanceFor(genres: readonly string[] | undefined, weights: Readonly<Record<string, number>>): number {
  const keys = Object.keys(weights);
  if (!genres || genres.length === 0 || keys.length === 0) return 0;
  let total = 0;
  for (const key of keys) total += weights[key] ?? 0;
  if (total <= 0) return 0;
  let matched = 0;
  for (const genre of new Set(genres.map((value) => value.trim().toLowerCase()))) {
    matched += weights[genre] ?? 0;
  }
  return Math.min(1, matched / total);
}

/**
 * Rank feed candidates highest-first. Pure and synchronous: pass in the
 * viewer's follow graph, genre weights and any already-seen review ids.
 */
export function rankFeed<T extends FeedInput>(
  items: readonly T[],
  context: FeedContext = {},
  options: FeedOptions = {},
): RankedFeedEntry<T>[] {
  const now = context.now ?? new Date();
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const halfLife = Math.max(1, options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS);
  const exploration = Math.max(0, options.exploration ?? DEFAULT_EXPLORATION);
  const followed = context.followedAuthorIds ? new Set(context.followedAuthorIds) : null;
  const seen = context.seenIds ? new Set(context.seenIds) : null;
  const genreWeights = context.genreWeights ?? {};

  const ranked = items
    .filter((item) => !seen?.has(item.id))
    .map((item) => {
      const freshness = Math.pow(0.5, ageHours(item.createdAt, now) / halfLife);
      const engagement = Math.min(
        1,
        Math.log1p(Math.max(0, item.reactions ?? 0) + 2 * Math.max(0, item.comments ?? 0)) / Math.log1p(60),
      );
      const affinity = followed ? (followed.has(item.authorId) || item.followed ? 1 : 0) : item.followed ? 1 : 0;
      const relevance = relevanceFor(item.genres, genreWeights);
      const bonus = exploration * hashUnit(item.id);
      const score =
        weights.freshness * freshness +
        weights.engagement * engagement +
        weights.affinity * affinity +
        weights.relevance * relevance +
        bonus;

      let code: FeedReasonCode = "fresh";
      if (affinity > 0) code = "followed";
      else if (relevance >= 0.45) code = "taste";
      else if (engagement >= 0.5) code = "popular";

      return {
        item,
        score: Math.round(score * 1_000_000) / 1_000_000,
        components: { freshness, engagement, affinity, relevance, exploration: bonus },
        reason: { code, label: REASONS[code] },
      };
    });

  ranked.sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
  return ranked;
}


export interface DiversityOptions {
  /** Penalty per repeat of the same media kind inside the recent window. */
  kindPenalty?: number;
  /** Penalty per repeat of the same primary genre inside the recent window. */
  genrePenalty?: number;
  /** How many already-selected entries count as recent. Default 3. */
  recentWindow?: number;
}

/**
 * Re-order ranked entries so the same kind or primary genre does not cluster.
 * Scores still dominate and nothing is dropped; repeats only nudge a candidate
 * down, so the feed stays explainable and complete.
 */
export function diversifyRankedFeed<T extends FeedInput>(
  ranked: readonly RankedFeedEntry<T>[],
  options: DiversityOptions = {},
): RankedFeedEntry<T>[] {
  const kindPenalty = Math.max(0, options.kindPenalty ?? 0.05);
  const genrePenalty = Math.max(0, options.genrePenalty ?? 0.03);
  const window = Math.max(1, options.recentWindow ?? 3);
  const primaryGenre = (entry: RankedFeedEntry<T>): string | null => {
    const genre = entry.item.genres?.[0];
    return genre ? genre.trim().toLowerCase() : null;
  };

  const remaining = [...ranked];
  const ordered: RankedFeedEntry<T>[] = [];
  while (remaining.length > 0) {
    const recent = ordered.slice(-window);
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const genre = primaryGenre(candidate);
      const kindRepeats = candidate.item.kind
        ? recent.filter((entry) => entry.item.kind === candidate.item.kind).length
        : 0;
      const genreRepeats = genre ? recent.filter((entry) => primaryGenre(entry) === genre).length : 0;
      const adjusted = candidate.score - kindPenalty * kindRepeats - genrePenalty * genreRepeats;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return ordered;
}
