/**
 * Ranking-quality evaluation harness.
 *
 * `ranking-model.test.ts` proves the fitter behaves correctly on constructed
 * examples. This harness asks a different question: given a known latent
 * ordering, noisy pairwise preferences, ties and users with wildly different
 * activity levels, how much of the truth does the fit recover?
 *
 * Preferences are sampled from the same Davidson model the fitter assumes,
 * with per-user noise on top, so the generator is a plausible simulator rather
 * than a mirror of the optimiser. Everything is seeded and pure, which makes
 * the evaluation reproducible and cheap enough to run on every commit.
 */
import {
  davidsonProbabilities,
  fitBradleyTerry,
  type ComparisonEvent,
  type FittedItem,
  type RankingFit,
} from "./ranking-model.ts";

/** Mulberry32: small, deterministic, and good enough for preference noise. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box–Muller; one call per sample keeps the generator order-insensitive.
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Draw centred latent strengths; the only random input to an outcome process. */
export function createSyntheticStrengths(seed = 42, items = 24): Map<string, number> {
  return drawStrengths(createRng(seed), items);
}

function drawStrengths(rng: () => number, itemCount: number): Map<string, number> {
  const ids = Array.from({ length: itemCount }, (_, i) => `item-${String(i).padStart(2, "0")}`);
  const raw = ids.map(() => rng() * 3 - 1.5);
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  return new Map(ids.map((id, i) => [id, raw[i]! - mean]));
}

function shuffledIndices(rng: () => number, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export interface SyntheticOptions {
  seed?: number;
  /** Number of items with latent strengths. */
  items?: number;
  /** Number of simulated users. */
  users?: number;
  /** Approximate number of generated comparisons across all users. */
  comparisons?: number;
  /** Davidson tie parameter used to sample outcomes. */
  tieParameter?: number;
  /** Standard deviation of the per-user strength perturbation. */
  userNoise?: number;
  /** Fraction of users restricted to a handful of comparisons. */
  sparseFraction?: number;
}

export interface SyntheticPreferences {
  /** Centred true strengths, exactly what a perfect fit would recover. */
  strengths: Map<string, number>;
  /** Comparisons to fit the model on. */
  events: ComparisonEvent[];
  users: number;
  sparseUsers: number;
  tieRate: number;
}

function randomPair(rng: () => number, ids: readonly string[], n: number): [string, string] {
  const a = Math.floor(rng() * n);
  let b = Math.floor(rng() * (n - 1));
  if (b >= a) b += 1;
  return [ids[a]!, ids[b]!];
}

function sampleOutcome(rng: () => number, thetaA: number, thetaB: number, tieParameter: number): ComparisonEvent["outcome"] {
  const { pa, pt } = davidsonProbabilities(thetaA, thetaB, tieParameter);
  const draw = rng();
  if (draw < pa) return "a";
  if (draw < pa + pt) return "tie";
  return "b";
}

/** Sample preferences from centred strengths, with no user-level noise. */
export function sampleComparisons(
  strengths: ReadonlyMap<string, number>,
  count: number,
  options: { seed?: number; tieParameter?: number } = {},
): ComparisonEvent[] {
  const rng = createRng(options.seed ?? 1);
  const tieParameter = options.tieParameter ?? 0.55;
  const ids = [...strengths.keys()];
  if (ids.length < 2) return [];
  const events: ComparisonEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const [aId, bId] = randomPair(rng, ids, ids.length);
    const outcome = sampleOutcome(rng, strengths.get(aId)!, strengths.get(bId)!, tieParameter);
    events.push({ aId, bId, outcome });
  }
  return events;
}

/**
 * Generate a population of users with different noise levels and activity.
 * Sparse users cast only a few comparisons, which is the realistic shape of a
 * new account and the main stress on shrinkage.
 */
export function generateSyntheticPreferences(options: SyntheticOptions = {}): SyntheticPreferences {
  const seed = options.seed ?? 42;
  const itemCount = options.items ?? 24;
  const userCount = options.users ?? 32;
  const targetComparisons = options.comparisons ?? 1_600;
  const tieParameter = options.tieParameter ?? 0.55;
  const userNoise = options.userNoise ?? 0.35;
  const sparseFraction = options.sparseFraction ?? 0.3;

  const rng = createRng(seed);
  const strengths = drawStrengths(rng, itemCount);
  const ids = [...strengths.keys()];

  const allEvents: ComparisonEvent[] = [];
  // Warm-up pass: every item appears, so a single unlucky draw cannot make an
  // item invisible to the fit.
  const warmupOrder = shuffledIndices(rng, itemCount);
  for (let i = 0; i < itemCount; i += 1) {
    const aId = ids[warmupOrder[i]!]!;
    const bId = ids[warmupOrder[(i + 1) % itemCount]!]!;
    const bias = gaussian(rng) * userNoise;
    allEvents.push({
      aId,
      bId,
      outcome: sampleOutcome(rng, strengths.get(aId)! + bias, strengths.get(bId)! + bias, tieParameter),
    });
  }

  const sparseUsers = Math.max(1, Math.round(userCount * sparseFraction));
  const perUser = Math.max(1, Math.floor(targetComparisons / userCount));
  let ties = 0;
  for (let user = 0; user < userCount; user += 1) {
    const sparse = user < sparseUsers;
    const activity = sparse ? 1 + Math.floor(rng() * 3) : Math.max(1, Math.floor(perUser * (0.4 + rng() * 1.6)));
    const userBias = gaussian(rng) * userNoise;
    const userScale = 0.6 + rng() * 0.6;
    for (let i = 0; i < activity; i += 1) {
      const [aId, bId] = randomPair(rng, ids, itemCount);
      const thetaA = strengths.get(aId)! * userScale + userBias;
      const thetaB = strengths.get(bId)! * userScale + userBias;
      const outcome = sampleOutcome(rng, thetaA, thetaB, tieParameter);
      if (outcome === "tie") ties += 1;
      allEvents.push({ aId, bId, outcome });
    }
  }

  return {
    strengths,
    events: allEvents,
    users: userCount,
    sparseUsers,
    tieRate: ties / Math.max(allEvents.length, 1),
  };
}

/** Spearman rank correlation, ignoring ids that the fit did not include. */
export function spearmanCorrelation(fit: RankingFit, strengths: ReadonlyMap<string, number>): number {
  const shared = fit.items.map((item) => item.id).filter((id) => strengths.has(id));
  if (shared.length < 3) return 0;
  const fittedRank = new Map(shared.map((id) => [id, 0]));
  const sortedFitted = [...shared].sort((a, b) => fit.byId.get(b)!.theta - fit.byId.get(a)!.theta);
  sortedFitted.forEach((id, rank) => fittedRank.set(id, rank));

  const trueRank = new Map(shared.map((id) => [id, 0]));
  const sortedTrue = [...shared].sort((a, b) => strengths.get(b)! - strengths.get(a)!);
  sortedTrue.forEach((id, rank) => trueRank.set(id, rank));

  const n = shared.length;
  let squared = 0;
  for (const id of shared) {
    const d = fittedRank.get(id)! - trueRank.get(id)!;
    squared += d * d;
  }
  return 1 - (6 * squared) / (n * (n * n - 1));
}

/**
 * Accuracy of the model's predicted winner on decided held-out comparisons.
 * Ties and skips are excluded because there is no single winner to score.
 */
export function heldOutAccuracy(
  fit: RankingFit,
  events: readonly ComparisonEvent[],
): { correct: number; total: number; accuracy: number } {
  let correct = 0;
  let total = 0;
  for (const event of events) {
    if (event.outcome !== "a" && event.outcome !== "b") continue;
    const a = fit.byId.get(event.aId);
    const b = fit.byId.get(event.bId);
    if (!a || !b || a.theta === b.theta) continue;
    const predicted = a.theta > b.theta ? "a" : "b";
    // Score against the sampled outcome, not the latent ordering: this is the
    // model's actual predictive accuracy on data it did not see.
    if (predicted === event.outcome) correct += 1;
    total += 1;
  }
  return { correct, total, accuracy: total === 0 ? 0 : correct / total };
}

/** Fraction of true strengths inside the model's 95% intervals. */
export function intervalCoverage(
  fit: RankingFit,
  strengths: ReadonlyMap<string, number>,
  minimumComparisons = 1,
): { covered: number; total: number; rate: number } {
  let covered = 0;
  let total = 0;
  for (const item of fit.items) {
    const truth = strengths.get(item.id);
    if (truth === undefined || item.comparisons < minimumComparisons) continue;
    total += 1;
    if (truth >= item.lower && truth <= item.upper) covered += 1;
  }
  return { covered, total, rate: total === 0 ? 0 : covered / total };
}

export interface ItemIntervalCoverage {
  id: string;
  covered: number;
  total: number;
  rate: number;
}

/**
 * Aggregate 95% interval coverage for each item over repeated fits of the same
 * population. Per-item rates make a bottom-of-scale gap visible where a pooled
 * rate would average it away.
 */
export function perItemIntervalCoverage(
  fits: readonly RankingFit[],
  strengths: ReadonlyMap<string, number>,
  minimumComparisons = 1,
): Map<string, ItemIntervalCoverage> {
  const coverage = new Map<string, ItemIntervalCoverage>();
  for (const fit of fits) {
    for (const item of fit.items) {
      const truth = strengths.get(item.id);
      if (truth === undefined || item.comparisons < minimumComparisons) continue;
      const entry = coverage.get(item.id) ?? { id: item.id, covered: 0, total: 0, rate: 0 };
      entry.total += 1;
      if (truth >= item.lower && truth <= item.upper) entry.covered += 1;
      entry.rate = entry.covered / entry.total;
      coverage.set(item.id, entry);
    }
  }
  return coverage;
}

/** Median interval width across items meeting a comparison threshold. */
export function medianIntervalWidth(items: readonly FittedItem[], minimumComparisons = 0): number {
  const widths = items
    .filter((item) => item.comparisons >= minimumComparisons)
    .map((item) => item.upper - item.lower)
    .sort((a, b) => a - b);
  if (widths.length === 0) return 0;
  const middle = Math.floor(widths.length / 2);
  return widths.length % 2 === 0 ? (widths[middle - 1]! + widths[middle]!) / 2 : widths[middle]!;
}

/** Convenience wrapper so tests and scripts fit the same generated population. */
export function evaluateSyntheticPreferences(options: SyntheticOptions = {}): {
  synthetic: SyntheticPreferences;
  fit: RankingFit;
  spearman: number;
  coverage: { covered: number; total: number; rate: number };
} {
  const synthetic = generateSyntheticPreferences(options);
  const fit = fitBradleyTerry(synthetic.events);
  return {
    synthetic,
    fit,
    spearman: spearmanCorrelation(fit, synthetic.strengths),
    coverage: intervalCoverage(fit, synthetic.strengths),
  };
}
