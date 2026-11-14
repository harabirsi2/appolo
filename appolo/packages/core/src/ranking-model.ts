/**
 * Personal ranking model: regularised Bradley–Terry with a Davidson tie term.
 *
 * The Elo helpers in `ranking.ts` remain the fast, incremental score used for
 * immediate feedback. This module is the statistical model that makes a
 * ranking reproducible from its comparison history and gives every item an
 * honest uncertainty estimate.
 *
 * Model, for items A and B with preference strengths θ_A, θ_B:
 *
 *   P(A > B) = e^θ_A / (e^θ_A + e^θ_B + ν·e^((θ_A+θ_B)/2))
 *   P(B > A) = e^θ_B / (e^θ_A + e^θ_B + ν·e^((θ_A+θ_B)/2))
 *   P(tie)   = ν·e^((θ_A+θ_B)/2) / (same denominator)
 *
 * ν is the Davidson tie parameter. A larger ν makes ties more likely.
 *
 * We fit θ by maximising the weighted log-likelihood minus an L2 prior,
 * which is a strictly concave problem, using damped Newton steps (with a
 * diagonal fallback for very large categories). The observed Fisher
 * information gives standard errors, so the UI can show confidence instead of
 * pretending an estimate is exact.
 *
 * No database or framework imports: this file is used by the web app, the
 * worker and the unit tests alike.
 */

export type ComparisonOutcome = "a" | "b" | "tie" | "undecided" | "skip";

export const COMPARISON_OUTCOMES: readonly ComparisonOutcome[] = [
  "a",
  "b",
  "tie",
  "undecided",
  "skip",
];

export interface ComparisonEvent {
  aId: string;
  bId: string;
  outcome: ComparisonOutcome;
  /**
   * Relative weight of the observation, 0–1. Defaults to 1 for decided
   * outcomes and 0.5 for "undecided", which is weaker evidence than an
   * explicit tie.
   */
  weight?: number;
}

export interface FitOptions {
  /** L2 prior strength. Larger values shrink toward the prior mean. */
  regularization?: number;
  /** Davidson tie parameter ν. Must be > 0. */
  tieParameter?: number;
  /** Prior mean for each item (e.g. an Elo-derived starting point). */
  prior?: ReadonlyMap<string, number>;
  maxIterations?: number;
  tolerance?: number;
  /** Upper bound on dense Newton solve size; larger fits use diagonal steps. */
  denseLimit?: number;
}

export interface FittedItem {
  id: string;
  /** Estimated preference strength. Higher is preferred. */
  theta: number;
  /** Standard error of theta. */
  standardError: number;
  /** Approximate 95% interval for theta. */
  lower: number;
  upper: number;
  /** Total observations that touched this item (skips excluded). */
  comparisons: number;
  wins: number;
  losses: number;
  ties: number;
  /** Wins / (wins + losses); null when there are no decided comparisons. */
  winRate: number | null;
  /** 0–10 expected-wins score against the other fitted items. */
  personalScore: number;
}

export interface RankingFit {
  items: FittedItem[];
  byId: Map<string, FittedItem>;
  tieParameter: number;
  logLikelihood: number;
  iterations: number;
  /** True when the optimiser met the tolerance before maxIterations. */
  converged: boolean;
}

const DEFAULT_REGULARIZATION = 0.6;
/** Largest per-item change in one Newton step (a simple trust region). */
const MAX_STEP = 3;
const DEFAULT_TIE_PARAMETER = 0.55;
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_DENSE_LIMIT = 220;
/** Cap quasi-likelihood inflation so a few near-certain comparisons cannot blow up every interval. */
const MAX_OVERDISPERSION = 4;
/** Calibration slope is bounded so a tiny or degenerate sample cannot explode the intervals. */
const MIN_CALIBRATION_SLOPE = 0.5;
const MAX_CALIBRATION_SLOPE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function weightFor(event: ComparisonEvent): number {
  if (event.outcome === "skip") return 0;
  if (event.weight !== undefined) return clamp(event.weight, 0, 1);
  return event.outcome === "undecided" ? 0.5 : 1;
}

/** Log-sum-exp over the three Davidson outcomes, computed stably. */
function logDenominator(x: number, y: number, logNu: number): number {
  const values = [x, y, logNu + (x + y) / 2];
  const max = Math.max(...values);
  return max + Math.log(values.reduce((sum, value) => sum + Math.exp(value - max), 0));
}

interface PairProbabilities {
  pa: number;
  pb: number;
  pt: number;
}

export function davidsonProbabilities(
  thetaA: number,
  thetaB: number,
  tieParameter: number = DEFAULT_TIE_PARAMETER,
): PairProbabilities {
  const nu = tieParameter > 0 ? tieParameter : DEFAULT_TIE_PARAMETER;
  const logNu = Math.log(nu);
  const logZ = logDenominator(thetaA, thetaB, logNu);
  return {
    pa: Math.exp(thetaA - logZ),
    pb: Math.exp(thetaB - logZ),
    pt: Math.exp(logNu + (thetaA + thetaB) / 2 - logZ),
  };
}

/** Probability that A is preferred to B under the fitted model. */
export function probabilityABeatsB(
  thetaA: number,
  thetaB: number,
  tieParameter: number = DEFAULT_TIE_PARAMETER,
): number {
  return davidsonProbabilities(thetaA, thetaB, tieParameter).pa;
}

/**
 * Shannon entropy of a single comparison probability, in nats. Highest (1) at
 * p = 0.5 and zero at a certain outcome.
 */
export function comparisonEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log(p) - (1 - p) * Math.log(1 - p);
}

/** Solve A x = b in place via Gaussian elimination with partial pivoting. */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const matrix = a.map((row, index) => [...row, b[index] ?? 0]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(matrix[col]?.[col] ?? 0);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(matrix[row]?.[col] ?? 0);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-12) continue;

    if (pivot !== col) {
      const tmp = matrix[col]!;
      matrix[col] = matrix[pivot]!;
      matrix[pivot] = tmp;
    }

    const diag = matrix[col]![col]!;
    for (let row = col + 1; row < n; row += 1) {
      const factor = (matrix[row]![col] ?? 0) / diag;
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) {
        matrix[row]![k] = (matrix[row]![k] ?? 0) - factor * (matrix[col]![k] ?? 0);
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = matrix[row]![n] ?? 0;
    for (let col = row + 1; col < n; col += 1) {
      sum -= (matrix[row]![col] ?? 0) * (x[col] ?? 0);
    }
    const diag = matrix[row]![row] ?? 0;
    x[row] = Math.abs(diag) < 1e-12 ? 0 : sum / diag;
  }
  return x;
}

interface Accumulators {
  gradient: number[];
  /** Dense negative Hessian: Σ w·s·sᵀ + λI. */
  hessian: number[][];
  logLikelihood: number;
  /** Weighted Pearson statistic, used to estimate overdispersion. */
  pearson: number;
  stats: Array<{ comparisons: number; wins: number; losses: number; ties: number }>;
}

function accumulate(
  index: Map<string, number>,
  events: readonly ComparisonEvent[],
  theta: number[],
  regularization: number,
  tieParameter: number,
): Accumulators {
  const k = theta.length;
  const gradient = new Array<number>(k).fill(0);
  const hessian = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const stats = Array.from({ length: k }, () => ({ comparisons: 0, wins: 0, losses: 0, ties: 0 }));
  const logNu = Math.log(tieParameter);
  let logLikelihood = 0;
  let pearson = 0;

  for (const event of events) {
    const weight = weightFor(event);
    if (event.outcome === "skip" || weight === 0) continue;

    const ia = index.get(event.aId);
    const ib = index.get(event.bId);
    if (ia === undefined || ib === undefined) continue;

    const thetaA = theta[ia] ?? 0;
    const thetaB = theta[ib] ?? 0;
    const logZ = logDenominator(thetaA, thetaB, logNu);
    const pa = Math.exp(thetaA - logZ);
    const pb = Math.exp(thetaB - logZ);
    const pt = Math.exp(logNu + (thetaA + thetaB) / 2 - logZ);

    // Score vectors ∂logP/∂(θa, θb) for every possible outcome.
    const scoreA: [number, number] = [1 - pa - 0.5 * pt, -pa - 0.5 * pt];
    const scoreB: [number, number] = [-pb - 0.5 * pt, 1 - pb - 0.5 * pt];
    const scoreTie: [number, number] = [0.5 - pa - 0.5 * pt, 0.5 - pb - 0.5 * pt];
    const observed =
      event.outcome === "a" ? scoreA : event.outcome === "b" ? scoreB : scoreTie;

    gradient[ia] = (gradient[ia] ?? 0) + weight * observed[0];
    gradient[ib] = (gradient[ib] ?? 0) + weight * observed[1];

    // Expected Fisher information over the three outcomes: Σ P(o)·s_o·s_oᵀ.
    // Using only the observed outcome would be the wrong (rank-one) curvature.
    const expectations: Array<{ p: number; s: [number, number] }> = [
      { p: pa, s: scoreA },
      { p: pb, s: scoreB },
      { p: pt, s: scoreTie },
    ];
    for (const { p, s } of expectations) {
      const w = weight * p;
      if (w === 0) continue;
      hessian[ia]![ia] = (hessian[ia]![ia] ?? 0) + w * s[0] * s[0];
      hessian[ib]![ib] = (hessian[ib]![ib] ?? 0) + w * s[1] * s[1];
      const cross = w * s[0] * s[1];
      hessian[ia]![ib] = (hessian[ia]![ib] ?? 0) + cross;
      hessian[ib]![ia] = (hessian[ib]![ia] ?? 0) + cross;
    }

    const observedProbability = event.outcome === "a" ? pa : event.outcome === "b" ? pb : pt;
    pearson += (weight * (1 - observedProbability)) / Math.max(observedProbability, 1e-9);

    const eventLogLikelihood =
      event.outcome === "a"
        ? thetaA - logZ
        : event.outcome === "b"
          ? thetaB - logZ
          : logNu + (thetaA + thetaB) / 2 - logZ;
    logLikelihood += weight * eventLogLikelihood;

    const statsA = stats[ia]!;
    const statsB = stats[ib]!;
    statsA.comparisons += 1;
    statsB.comparisons += 1;
    if (event.outcome === "a") {
      statsA.wins += 1;
      statsB.losses += 1;
    } else if (event.outcome === "b") {
      statsB.wins += 1;
      statsA.losses += 1;
    } else {
      statsA.ties += 1;
      statsB.ties += 1;
    }
  }

  for (let i = 0; i < k; i += 1) {
    const thetaI = theta[i] ?? 0;
    logLikelihood -= (regularization / 2) * thetaI * thetaI;
    gradient[i] = (gradient[i] ?? 0) - regularization * thetaI;
    // The prior contributes λI to the information matrix.
    hessian[i]![i] = (hessian[i]![i] ?? 0) + regularization;
  }

  return { gradient, hessian, logLikelihood, pearson, stats };
}

/**
 * One-parameter logistic calibration of decided outcomes on fitted θ gaps.
 * A slope below 1 means the model is overconfident: observed choices are
 * flatter than its probabilities. A slope above 1 means underconfidence, which
 * is left alone rather than sharpened. Ties are excluded because the slope
 * describes the decided a-vs-b choice.
 */
function calibrationSlope(
  index: Map<string, number>,
  events: readonly ComparisonEvent[],
  theta: number[],
): number {
  let slope = 1;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    let gradient = 0;
    let curvature = 0;
    for (const event of events) {
      if (event.outcome !== "a" && event.outcome !== "b") continue;
      const ia = index.get(event.aId);
      const ib = index.get(event.bId);
      if (ia === undefined || ib === undefined) continue;
      const gap = (theta[ia] ?? 0) - (theta[ib] ?? 0);
      if (gap === 0) continue;
      const probability = 1 / (1 + Math.exp(-slope * gap));
      const outcome = event.outcome === "a" ? 1 : 0;
      gradient += (outcome - probability) * gap;
      curvature += probability * (1 - probability) * gap * gap;
    }
    if (Math.abs(gradient) < 1e-9) break;
    const next = clamp(slope + gradient / Math.max(curvature, 1e-9), MIN_CALIBRATION_SLOPE, MAX_CALIBRATION_SLOPE);
    if (Math.abs(next - slope) < 1e-9) {
      slope = next;
      break;
    }
    slope = next;
  }
  return slope;
}

/**
 * Fit a Bradley–Terry + Davidson model to comparison events.
 *
 * Skipped comparisons are ignored entirely. Ties and "undecided" outcomes
 * contribute through the Davidson tie term instead of being forced into a
 * win or loss. The result is deterministic for a given input ordering.
 */
export function fitBradleyTerry(
  events: readonly ComparisonEvent[],
  options: FitOptions = {},
): RankingFit {
  const regularization = Math.max(0.0001, options.regularization ?? DEFAULT_REGULARIZATION);
  const tieParameter = Math.max(0.001, options.tieParameter ?? DEFAULT_TIE_PARAMETER);
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const denseLimit = options.denseLimit ?? DEFAULT_DENSE_LIMIT;

  const index = new Map<string, number>();
  for (const event of events) {
    if (event.outcome === "skip") continue;
    for (const id of [event.aId, event.bId]) {
      if (!index.has(id)) index.set(id, index.size);
    }
  }
  const ids = [...index.keys()];
  const k = ids.length;

  const theta = ids.map((id) => options.prior?.get(id) ?? 0);
  let logLikelihood = 0;
  let iterations = 0;
  let converged = false;

  if (k > 0) {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      iterations = iteration + 1;
      const { gradient, hessian, logLikelihood: current } = accumulate(
        index,
        events,
        theta,
        regularization,
        tieParameter,
      );
      logLikelihood = current;

      let maxGradient = 0;
      for (const value of gradient) maxGradient = Math.max(maxGradient, Math.abs(value));
      if (maxGradient < tolerance) {
        converged = true;
        break;
      }

      const step = new Array<number>(k).fill(0);
      if (k <= denseLimit) {
        // `hessian` stores the positive expected information I = -∇²L, so the
        // Newton step for maximisation is θ += I⁻¹∇L.
        const delta = solveLinearSystem(hessian, gradient);
        for (let i = 0; i < k; i += 1) step[i] = delta[i] ?? 0;
      } else {
        for (let i = 0; i < k; i += 1) {
          step[i] = (gradient[i] ?? 0) / Math.max(hessian[i]?.[i] ?? 1, 1e-9);
        }
      }

      // Trust region: capping the step keeps a separated record from
      // overshooting into a region where the prior dominates.
      let maxStep = 0;
      for (let i = 0; i < k; i += 1) {
        step[i] = clamp(step[i] ?? 0, -MAX_STEP, MAX_STEP);
        maxStep = Math.max(maxStep, Math.abs(step[i] ?? 0));
      }
      if (maxStep < tolerance) {
        converged = true;
        break;
      }

      // Backtracking line search on the (concave) objective.
      const currentObjective = current;
      let improved = false;
      let scale = 1;
      let accepted = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const candidate = theta.map((value, i) => value + scale * (step[i] ?? 0));
        const candidateObjective = accumulate(
          index,
          events,
          candidate,
          regularization,
          tieParameter,
        ).logLikelihood;
        if (candidateObjective >= currentObjective || scale < 1e-6) {
          for (let i = 0; i < k; i += 1) theta[i] = candidate[i] ?? 0;
          improved = candidateObjective - currentObjective > 1e-9;
          accepted = true;
          break;
        }
        scale /= 2;
      }
      if (!accepted) break;
      if (!improved) {
        // The line search could no longer improve the objective: at the
        // optimum to numerical precision, or the regularised shared mode is
        // flat. Either way further iterations cannot help.
        converged = true;
        break;
      }
    }
  }

  const final = accumulate(index, events, theta, regularization, tieParameter);
  // Quasi-likelihood variance: Pearson residuals reveal overdispersion that
  // the model's Fisher information does not (e.g. a different outcome link or
  // label noise). n - k is the usual degrees-of-freedom correction.
  const effectiveObservations = events.reduce(
    (sum, event) => sum + (event.outcome === "skip" ? 0 : weightFor(event)),
    0,
  );
  const overdispersion = Math.min(
    MAX_OVERDISPERSION,
    Math.max(1, final.pearson / Math.max(effectiveObservations - k, 1)),
  );
  const slope = calibrationSlope(index, events, theta);
  const calibrationInflation = slope < 1 ? 1 / slope : 1;
  const covariance = fitCovariance(final.hessian, k);

  // Bradley–Terry is identified only up to a shared shift (only θ_i − θ_j
  // affects predictions). Centre the estimates and report uncertainty for the
  // identified differences, not for the meaningless shared mode — otherwise
  // every standard error inherits the prior's 1/λ variance.
  const meanTheta = k === 0 ? 0 : theta.reduce((sum, value) => sum + value, 0) / k;
  const meanVariance =
    k === 0 ? 0 : covariance.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0) / (k * k);
  const standardErrors = Array.from({ length: k }, (_, i) => {
    const meanCovariance =
      k === 0 ? 0 : covariance[i]!.reduce((sum, value) => sum + value, 0) / k;
    const centeredVariance =
      (covariance[i]?.[i] ?? 0) - 2 * meanCovariance + meanVariance;
    return Math.sqrt(Math.max(centeredVariance, 0));
  });

  const items: FittedItem[] = ids.map((id, i) => {
    const centeredTheta = (theta[i] ?? 0) - meanTheta;
    const se = (standardErrors[i] ?? 0) * Math.sqrt(overdispersion) * calibrationInflation;
    const stats = final.stats[i] ?? { comparisons: 0, wins: 0, losses: 0, ties: 0 };
    const decided = stats.wins + stats.losses;
    return {
      id,
      theta: centeredTheta,
      standardError: se,
      lower: centeredTheta - 1.96 * se,
      upper: centeredTheta + 1.96 * se,
      comparisons: stats.comparisons,
      wins: stats.wins,
      losses: stats.losses,
      ties: stats.ties,
      winRate: decided > 0 ? stats.wins / decided : null,
      personalScore: 0,
    };
  });

  // Personal score = 10 × mean P(this item beats each other fitted item).
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (items.length <= 1) {
      item.personalScore = 5;
      continue;
    }
    let total = 0;
    for (let j = 0; j < items.length; j += 1) {
      if (i === j) continue;
      total += probabilityABeatsB(item.theta, items[j]!.theta, tieParameter);
    }
    item.personalScore = Math.round((total / (items.length - 1)) * 10 * 10) / 10;
  }

  items.sort((a, b) => {
    if (b.theta !== a.theta) return b.theta - a.theta;
    return a.id.localeCompare(b.id);
  });

  return {
    items,
    byId: new Map(items.map((item) => [item.id, item])),
    tieParameter,
    logLikelihood,
    iterations,
    converged,
  };
}

/**
 * Invert the (symmetric positive definite) information matrix.
 *
 * Gauss–Jordan elimination with partial pivoting on [H | I] in one pass.
 * Solving H·x = e_i separately for every column would cost O(k⁴); a single
 * inversion is O(k³), which keeps the fit responsive as a catalog grows.
 */
function fitCovariance(information: number[][], k: number): number[][] {
  if (k === 0) return [];

  const left = information.map((row) => [...row]);
  const inverse: number[][] = Array.from({ length: k }, (_, row) =>
    Array.from({ length: k }, (_, col) => (row === col ? 1 : 0)),
  );

  for (let col = 0; col < k; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < k; row += 1) {
      if (Math.abs(left[row]![col] ?? 0) > Math.abs(left[pivot]![col] ?? 0)) pivot = row;
    }
    if (pivot !== col) {
      [left[col], left[pivot]] = [left[pivot]!, left[col]!];
      [inverse[col], inverse[pivot]] = [inverse[pivot]!, inverse[col]!];
    }

    const diagonal = left[col]![col] ?? 0;
    if (Math.abs(diagonal) < 1e-12) continue;
    const scale = 1 / diagonal;
    for (let j = 0; j < k; j += 1) {
      left[col]![j] = (left[col]![j] ?? 0) * scale;
      inverse[col]![j] = (inverse[col]![j] ?? 0) * scale;
    }

    for (let row = 0; row < k; row += 1) {
      if (row === col) continue;
      const factor = left[row]![col] ?? 0;
      if (factor === 0) continue;
      for (let j = 0; j < k; j += 1) {
        left[row]![j] = (left[row]![j] ?? 0) - factor * (left[col]![j] ?? 0);
        inverse[row]![j] = (inverse[row]![j] ?? 0) - factor * (inverse[col]![j] ?? 0);
      }
    }
  }

  return inverse;
}

export interface InformativePairOptions {
  /** Item the user is currently rating. */
  targetId: string;
  /** Candidate opponents with their fitted theta / standard error. */
  candidates: readonly { id: string; theta: number; standardError: number }[];
  /** How many times each unordered pair has already been compared. */
  pairCounts?: ReadonlyMap<string, number>;
  /** How often each item has been shown, for exposure balance. */
  exposure?: ReadonlyMap<string, number>;
  /** Opponents that should be avoided because they were just shown. */
  recentIds?: readonly string[];
  tieParameter?: number;
  targetTheta?: number;
  targetStandardError?: number;
}

export interface InformativePairScore {
  id: string;
  utility: number;
  entropy: number;
  probability: number;
}

/** Stable key for an unordered pair. */
export function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
}

/**
 * Rank candidate opponents by how much a comparison would teach the model.
 *
 * utility = entropy(p) × combined uncertainty × exposure balance
 *           ÷ (1 + times already compared) with a penalty for a repeat of the
 *           immediately previous opponent.
 *
 * Obvious matchups (p near 0 or 1) score low even when they are uncertain, so
 * the app stops asking the same lopsided question forever.
 */
export function scoreInformativeOpponents(
  options: InformativePairOptions,
): InformativePairScore[] {
  const tieParameter = options.tieParameter ?? DEFAULT_TIE_PARAMETER;
  const targetTheta = options.targetTheta ?? 0;
  const targetSe = clamp(options.targetStandardError ?? 1, 0, 10);
  const recent = new Set(options.recentIds ?? []);
  const maxExposure = Math.max(1, ...[...(options.exposure?.values() ?? [1])]);
  const exposureFor = (id: string) => options.exposure?.get(id) ?? 1;

  return options.candidates
    .filter((candidate) => candidate.id !== options.targetId)
    .map((candidate) => {
      const probability = probabilityABeatsB(targetTheta, candidate.theta, tieParameter);
      const entropy = comparisonEntropy(probability);
      const uncertainty = clamp((targetSe + clamp(candidate.standardError, 0, 10)) / 2, 0, 1);
      // Items shown less often get a boost; repeated pairs get damped.
      const exposureBalance = 1 / Math.sqrt(exposureFor(candidate.id) / maxExposure + 1);
      const pairCount = options.pairCounts?.get(pairKey(options.targetId, candidate.id)) ?? 0;
      const repeatPenalty = recent.has(candidate.id) ? 0.25 : 1;
      const utility =
        (entropy * (0.35 + 0.65 * uncertainty) * exposureBalance * repeatPenalty) /
        (1 + pairCount);

      return { id: candidate.id, utility, entropy, probability };
    })
    .sort((a, b) => {
      if (b.utility !== a.utility) return b.utility - a.utility;
      return a.id.localeCompare(b.id);
    });
}

/** Pick the single most informative opponent, or null when none is usable. */
export function selectInformativeOpponent(options: InformativePairOptions): string | null {
  return scoreInformativeOpponents(options)[0]?.id ?? null;
}
