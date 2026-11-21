/**
 * Title normalisation and duplicate scoring for the shared catalog.
 *
 * Two provider rows for the same title (TMDB and iTunes both know "Blade
 * Runner 2049", seeds carry the same films) must collapse to one rating
 * target. The rules are deliberately conservative: a false merge destroys a
 * user's ranking position, a missed merge only leaves a duplicate that a later
 * pass can catch.
 */

/** Lowercase, strip accents/punctuation, drop a leading article, collapse spaces. */
export function normalizeTitle(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
  return base;
}

/** Compact key used for exact-duplicate clustering. */
export function titleKey(value: string): string {
  return normalizeTitle(value).replace(/\s+/g, "");
}

/** Significant words, without noise that adds no identity. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "of", "vol", "volume", "part", "season", "series",
  "edition", "remastered", "deluxe", "original", "official",
]);

function tokens(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface DuplicateCandidate {
  id: string;
  kind: string;
  title: string;
  year: number | null;
  externalRef?: string | null;
}

export interface DuplicateVerdict {
  duplicate: boolean;
  score: number;
  reason: "external-ref" | "exact-title-year" | "fuzzy-title-year" | "none";
}

/**
 * Score two rows of the same kind. 0..1, where >= 0.86 is treated as the same
 * title. A differing year is heavily penalised (a remake is a different title),
 * and rows without a year need a near-exact title to match.
 */
export function duplicateVerdict(a: DuplicateCandidate, b: DuplicateCandidate): DuplicateVerdict {
  if (a.kind !== b.kind) return { duplicate: false, score: 0, reason: "none" };
  if (a.externalRef && b.externalRef && a.externalRef === b.externalRef) {
    return { duplicate: true, score: 1, reason: "external-ref" };
  }

  const keyA = titleKey(a.title);
  const keyB = titleKey(b.title);
  if (keyA && keyA === keyB && a.year === b.year) {
    return { duplicate: true, score: 1, reason: "exact-title-year" };
  }

  const titleScore = jaccard(tokens(a.title), tokens(b.title));
  let score = titleScore;
  if (a.year !== null && b.year !== null) {
    const gap = Math.abs(a.year - b.year);
    if (gap === 0) score = Math.min(1, titleScore + 0.08);
    else if (gap === 1) score = titleScore * 0.92;
    else score = titleScore * 0.5;
  } else {
    // One side has no year: require a stronger title match.
    score = titleScore * 0.95;
  }

  if (score >= 0.86) {
    return { duplicate: true, score: Number(score.toFixed(3)), reason: "fuzzy-title-year" };
  }
  return { duplicate: false, score: Number(score.toFixed(3)), reason: "none" };
}

/**
 * Pick which row of a duplicate cluster survives: the one with the most
 * ratings, then the oldest, so the canonical row is stable across runs and is
 * the one people have already ranked.
 */
export function pickCanonical<T extends { id: string; createdAt?: Date | string | null }>(
  rows: T[],
  ratingCounts: Map<string, number>,
): T {
  return [...rows].sort((a, b) => {
    const ratings = (ratingCounts.get(b.id) ?? 0) - (ratingCounts.get(a.id) ?? 0);
    if (ratings !== 0) return ratings;
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (createdA !== createdB) return createdA - createdB;
    return a.id.localeCompare(b.id);
  })[0]!;
}
