import { z } from "zod";

/**
 * Pure ranking engine for the head-to-head ("which is better?") mini-game.
 *
 * Every item starts at the same Elo, and each vote is a zero-sum update
 * between the two contenders. A personalised 0–10 score is derived from the
 * resulting Elo so the same item can land differently for different people.
 *
 * This module has no database or framework dependencies so it can be reused
 * by the API, the worker, and tests alike.
 */

export const MEDIA_KINDS = ["movie", "tv", "music", "podcast", "book", "game"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const mediaKindSchema = z.enum(MEDIA_KINDS);

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  movie: "Movies",
  tv: "TV",
  music: "Music",
  podcast: "Podcasts",
  book: "Books",
  game: "Video games",
};

export const MEDIA_KIND_SINGULAR: Record<MediaKind, string> = {
  movie: "Movie",
  tv: "TV show",
  music: "Album",
  podcast: "Podcast",
  book: "Book",
  game: "Video game",
};

/** Curated genres shown on the Add/Browse page, grouped by media kind. */
export const GENRES: Record<MediaKind, string[]> = {
  movie: ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller", "Romance", "Animation", "Documentary"],
  // No "Anime" chip: the catalog's animated TV titles are Western, and no row
  // carries an `anime` genre. `isAnime` still labels genuinely tagged titles.
  tv: ["Drama", "Comedy", "Sci-Fi", "Reality", "Crime", "Animation", "Documentary"],
  music: ["Pop", "Hip-Hop", "R&B", "Rock", "Electronic", "Indie", "Jazz", "Country"],
  podcast: ["True Crime", "News", "Comedy", "Culture", "Science", "History", "Technology"],
  book: ["Fiction", "Fantasy", "Sci-Fi", "Nonfiction", "Mystery", "Romance", "Biography", "Poetry"],
  game: ["Action", "Adventure", "RPG", "Shooter", "Strategy", "Indie", "Sports", "Horror"],
};

/**
 * Case-insensitive comparison key for a genre label.
 *
 * The catalog mixes casings ("Action" from the base seed, "action" from the
 * expansion rows), so every filter must compare on this key rather than on the
 * raw string.
 */
export function genreKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Elo every item begins at before its first matchup. */
export const START_ELO = 1500;

/** Standard Elo K-factor. Higher means each vote moves the score more. */
export const K_FACTOR = 32;

/** Elo that maps to a score of 0. */
export const SCORE_FLOOR_ELO = 1200;

/** Elo points per score point (so 1800 Elo maps to a perfect 10.0). */
export const SCORE_SPAN = 60;

export const MATCH_RESULTS = ["win", "loss", "tie", "undecided", "skip"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];
export const matchResultSchema = z.enum(MATCH_RESULTS);

/** Outcomes that must leave both Elo ratings untouched. */
export function isNoOpResult(result: MatchResult): boolean {
  return result === "skip" || result === "undecided";
}

export const voteInputSchema = z.object({
  opponentId: z.string().uuid(),
  result: matchResultSchema.default("win"),
});
export type VoteInput = z.infer<typeof voteInputSchema>;

export const matchupRequestSchema = z.object({
  kind: mediaKindSchema.optional(),
  exclude: z.array(z.string().uuid()).max(50).optional(),
});
export type MatchupRequest = z.infer<typeof matchupRequestSchema>;

export const catalogQuerySchema = z.object({
  kind: mediaKindSchema.optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/* ------------------------------------------------------------------ */
/* Elo math                                                            */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Probability that `a` beats `b` given both Elo ratings. */
export function expectedWinProbability(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * Update two Elo ratings after a result seen from `a`'s perspective.
 * The change is zero-sum: whatever `a` gains, `b` loses. Skipped matchups
 * return both ratings unchanged.
 */
export function nextElo(
  a: number,
  b: number,
  outcome: MatchResult,
  k = K_FACTOR,
): { a: number; b: number } {
  if (isNoOpResult(outcome)) return { a, b };
  const expected = expectedWinProbability(a, b);
  const actual = outcome === "win" ? 1 : outcome === "tie" ? 0.5 : 0;
  const delta = Math.round(k * (actual - expected));
  return { a: a + delta, b: b - delta };
}

/** Map an Elo rating onto the personalised 0–10 score, rounded to 0.1. */
export function scoreForElo(elo: number): number {
  const raw = (elo - SCORE_FLOOR_ELO) / SCORE_SPAN;
  return Math.round(clamp(raw, 0, 10) * 10) / 10;
}

/**
 * K-factor by how many decided matchups (wins + losses) an item has played.
 * New items move faster so their score settles in fewer votes.
 */
export function kFactorFor(decidedMatches: number): number {
  if (decidedMatches < 10) return K_FACTOR * 2;
  if (decidedMatches < 20) return Math.round(K_FACTOR * 1.5);
  return K_FACTOR;
}

/**
 * Like nextElo, but each side uses its own K-factor, so a brand-new item can
 * move quickly against a settled one without dragging the settled one far.
 * Skipped matchups return both ratings unchanged.
 */
export function nextEloAdaptive(
  a: number,
  b: number,
  outcome: MatchResult,
  decidedA: number,
  decidedB: number,
): { a: number; b: number } {
  if (isNoOpResult(outcome)) return { a, b };
  const expected = expectedWinProbability(a, b);
  const actual = outcome === "win" ? 1 : outcome === "tie" ? 0.5 : 0;
  return {
    a: a + Math.round(kFactorFor(decidedA) * (actual - expected)),
    b: b + Math.round(kFactorFor(decidedB) * (expected - actual)),
  };
}

export interface ScoreBand {
  label: string;
  tone: "brand" | "success" | "warn" | "neutral" | "danger";
}

/** Human label for a score, used across the UI. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 9) return { label: "All-timer", tone: "brand" };
  if (score >= 7.5) return { label: "Loved it", tone: "success" };
  if (score >= 6) return { label: "Solid", tone: "success" };
  if (score >= 4.5) return { label: "Mixed", tone: "warn" };
  if (score >= 3) return { label: "Not for me", tone: "neutral" };
  return { label: "Nope", tone: "danger" };
}

/* ------------------------------------------------------------------ */
/* Opponent selection                                                  */
/* ------------------------------------------------------------------ */

export interface Contender {
  id: string;
  elo: number;
}

/**
 * Choose the next head-to-head opponent for `current` from `pool`.
 *
 * Preference order:
 *   1. never face yourself,
 *   2. avoid items already faced recently (so a run doesn't loop),
 *   3. prefer the closest Elo, i.e. the matchup that is most informative.
 *
 * A small deterministic jitter derived from a seed keeps the pick varied
 * between sessions without making it unpredictable within a request.
 */
export function selectOpponent(
  current: Contender,
  pool: readonly Contender[],
  options: { recentIds?: readonly string[]; seed?: number } = {},
): Contender | null {
  const recent = new Set(options.recentIds ?? []);
  const candidates = pool.filter((c) => c.id !== current.id);
  if (candidates.length === 0) return null;

  const fresh = candidates.filter((c) => !recent.has(c.id));
  const usable = fresh.length > 0 ? fresh : candidates;
  const seed = options.seed ?? 0;

  let best: Contender | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  usable.forEach((candidate, index) => {
    // Distance in Elo dominates; jitter only breaks near-ties.
    const jitter = (((seed + index * 2654435761) >>> 0) % 1000) / 1000;
    const cost = Math.abs(candidate.elo - current.elo) - jitter * 12;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  });

  return best;
}

/* ------------------------------------------------------------------ */
/* Ranking helpers                                                     */
/* ------------------------------------------------------------------ */

export interface Rankable {
  id: string;
  elo: number;
  matches: number;
}

/** Sort rankables by Elo descending, then by how many matchups backed it. */
export function rankByElo<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.elo !== a.elo) return b.elo - a.elo;
    return b.matches - a.matches;
  });
}

/** Assign 1-based positions, sharing a position on exact Elo ties. */
export function withPositions<T extends Rankable>(items: readonly T[]): (T & { position: number })[] {
  const ranked = rankByElo(items);
  let lastElo: number | null = null;
  let lastPosition = 0;
  return ranked.map((item, index) => {
    const position = item.elo === lastElo ? lastPosition : index + 1;
    lastElo = item.elo;
    lastPosition = position;
    return { ...item, position };
  });
}