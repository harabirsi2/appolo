import assert from "node:assert/strict";
import test from "node:test";
import { fitBradleyTerry, logLikelihoodGradient, type ComparisonEvent } from "./ranking-model.ts";
import {
  evaluateSyntheticPreferences,
  createRng,
  createSyntheticStrengths,
  generateSyntheticPreferences,
  heldOutAccuracy,
  intervalCoverage,
  medianIntervalWidth,
  perItemIntervalCoverage,
  sampleComparisons,
  spearmanCorrelation,
} from "./ranking-quality.ts";

/**
 * Thresholds are deliberately below the observed values on this machine
 * (Spearman 0.90–0.96, held-out accuracy 0.68–0.73, interval coverage mean
 * 0.958 over four seeds at 24 items / ~1,300 comparisons, per-seed minimum
 * 0.875). They are chosen to fail on a real regression — a broken prior, a
 * mis-centred fit, ignored ties — not on run-to-run noise, since every stage is
 * seeded and deterministic.
 */
const MIN_SPEARMAN = 0.85;
const MIN_HELD_OUT_ACCURACY = 0.65;
/** Coverage at 95% should approach 0.95; judging four seeds together averages
 *  out the binomial noise a single 24-item sample carries. */
const COVERAGE_SEEDS = [1, 7, 42, 99];
/** Robustness floor for preferences drawn from a process the fitter does not
 * assume, so the check is about surviving misspecification, not mirroring the
 * optimiser. */
const MIN_MISSPECIFIED_SPEARMAN = 0.85;
/** Nominal coverage is 0.95, and the corrected intervals reach it over 20 seeds. */
const MIN_MISSPECIFIED_COVERAGE = 0.95;
const MIN_MEAN_INTERVAL_COVERAGE = 0.85;
/** A single seed this far below nominal is a calibration bug, not luck. */
const MIN_PER_SEED_INTERVAL_COVERAGE = 0.7;
const RUNTIME_BUDGET_MS = 5_000;

test("generator produces ties, sparse users and full coverage", () => {
  const synthetic = generateSyntheticPreferences({ seed: 11, items: 16, users: 24, comparisons: 800 });
  assert.equal(synthetic.strengths.size, 16);
  assert.ok(synthetic.sparseUsers > 0, "expected at least one sparse user");
  assert.ok(synthetic.sparseUsers < synthetic.users, "not every user should be sparse");
  assert.ok(synthetic.tieRate > 0.05, `expected meaningful tie rate, got ${synthetic.tieRate}`);
  const seen = new Set(synthetic.events.flatMap((event) => [event.aId, event.bId]));
  assert.equal(seen.size, synthetic.strengths.size, "every item should appear in the sample");
  assert.ok(synthetic.events.length > 500, "the sample should be large enough to fit");
});

/** Standard normal CDF (Abramowitz–Stegun 26.2.17), used for a probit link. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989423 * Math.exp((-z * z) / 2);
  const tail =
    density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - tail : tail;
}

const PROBIT_SCALE = 1.2;
const LABEL_FLIP_RATE = 0.2;
const MISSPECIFIED_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const MISSPECIFIED_ITEMS = 40;
const MISSPECIFIED_COMPARISONS = 2_400;
/** Fixed population and repeated event samples expose item-level coverage. */
const PER_ITEM_REPLICATIONS = 20;
const PER_ITEM_EVENT_SEED = 500;
const BOTTOM_DECILE_SIZE = 10;
/** The corrected bottom decile reaches 0.935; allow ordinary sampling noise. */
const MIN_BOTTOM_DECILE_COVERAGE = 0.9;
/** A bottom decile far below the rest is the regression this guards against. */
const MAX_BOTTOM_DECILE_GAP = 0.05;

/**
 * A different process than `fitBradleyTerry` assumes: a probit link, no ties,
 * and 20% of decided outcomes flipped.
 */
function sampleMisspecifiedPreferences(
  strengths: ReadonlyMap<string, number>,
  count: number,
  seed: number,
): ComparisonEvent[] {
  const rng = createRng(seed);
  const ids = [...strengths.keys()];
  const events: ComparisonEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const aIndex = Math.floor(rng() * ids.length);
    let bIndex = Math.floor(rng() * (ids.length - 1));
    if (bIndex >= aIndex) bIndex += 1;
    const aId = ids[aIndex]!;
    const bId = ids[bIndex]!;
    const pA = normalCdf((strengths.get(aId)! - strengths.get(bId)!) / PROBIT_SCALE);
    let outcome: ComparisonEvent["outcome"] = rng() < pA ? "a" : "b";
    if (rng() < LABEL_FLIP_RATE) outcome = outcome === "a" ? "b" : "a";
    events.push({ aId, bId, outcome });
  }
  return events;
}

function misspecifiedScenario(seed: number): {
  strengths: Map<string, number>;
  fit: ReturnType<typeof fitBradleyTerry>;
} {
  const strengths = createSyntheticStrengths(seed, MISSPECIFIED_ITEMS);
  const events = sampleMisspecifiedPreferences(strengths, MISSPECIFIED_COMPARISONS, seed + 100);
  return { strengths, fit: fitBradleyTerry(events) };
}

test("recovers the latent ordering from noisy preferences", () => {
  for (const seed of [7, 42]) {
    const { spearman, fit } = evaluateSyntheticPreferences({ seed, items: 24, users: 32, comparisons: 1_600 });
    assert.ok(fit.converged, `fit did not converge for seed ${seed}`);
    assert.ok(
      spearman >= MIN_SPEARMAN,
      `seed ${seed}: Spearman ${spearman.toFixed(3)} below ${MIN_SPEARMAN}`,
    );
  }
});

test("recovers the ordering when outcomes follow a different process", () => {
  for (const seed of MISSPECIFIED_SEEDS) {
    const { strengths, fit } = misspecifiedScenario(seed);
    assert.ok(fit.converged, `misspecified fit did not converge for seed ${seed}`);
    const spearman = spearmanCorrelation(fit, strengths);
    assert.ok(
      spearman >= MIN_MISSPECIFIED_SPEARMAN,
      `seed ${seed}: Spearman ${spearman.toFixed(3)} under a misspecified outcome process ` +
        `below ${MIN_MISSPECIFIED_SPEARMAN}`,
    );
  }
});

/**
 * The intervals carry a Pearson overdispersion correction and an outward
 * attenuation allowance, so a process with heavier noise than the fitter
 * assumes covers its true strengths instead of claiming false certainty.
 * Gate the pooled rate; individual seeds are noisier.
 */
test("keeps 95% intervals close to nominal coverage under the probit process", (t) => {
  let covered = 0;
  let total = 0;
  const perSeed: string[] = [];
  const zScores: number[] = [];
  for (const seed of MISSPECIFIED_SEEDS) {
    const { strengths, fit } = misspecifiedScenario(seed);
    assert.ok(fit.converged, `misspecified fit did not converge for seed ${seed}`);
    const coverage = intervalCoverage(fit, strengths);
    assert.equal(coverage.total, strengths.size);
    covered += coverage.covered;
    total += coverage.total;
    perSeed.push(`seed ${seed} ${coverage.covered}/${coverage.total}`);
    for (const item of fit.items) {
      const error = item.theta - strengths.get(item.id)!;
      const side = error > 0 ? item.theta - item.lower : item.upper - item.theta;
      zScores.push(Math.abs(error) / (side / 1.96));
    }
  }
  const ordered = [...zScores].sort((a, b) => a - b);
  const q95 = ordered[Math.ceil(0.95 * ordered.length) - 1]!;
  const pooled = covered / total;
  t.diagnostic(
    `probit-process 95% interval coverage ${pooled.toFixed(3)} ` +
      `(${covered}/${total}); ${perSeed.join(", ")}; ` +
      `95th percentile error as a fraction of the outward interval side ${q95.toFixed(2)}`,
  );
  assert.ok(
    pooled >= MIN_MISSPECIFIED_COVERAGE,
    `misspecified coverage ${pooled.toFixed(3)} below ${MIN_MISSPECIFIED_COVERAGE}`,
  );
});

test("makes the bottom-of-scale coverage gap visible per item", (t) => {
  const strengths = createSyntheticStrengths(42, MISSPECIFIED_ITEMS);
  const fits = [];
  for (let run = 0; run < PER_ITEM_REPLICATIONS; run += 1) {
    const fit = fitBradleyTerry(
      sampleMisspecifiedPreferences(strengths, MISSPECIFIED_COMPARISONS, PER_ITEM_EVENT_SEED + run),
    );
    assert.ok(fit.converged, `per-item fit did not converge for replication ${run}`);
    fits.push(fit);
  }

  const perItem = perItemIntervalCoverage(fits, strengths);
  assert.equal(perItem.size, strengths.size);
  for (const entry of perItem.values()) {
    assert.equal(entry.total, PER_ITEM_REPLICATIONS, `${entry.id} has an incomplete replication count`);
  }

  const bottomIds = new Set(
    [...strengths.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, BOTTOM_DECILE_SIZE)
      .map(([id]) => id),
  );
  const bottom = [...perItem.values()].filter((entry) => bottomIds.has(entry.id));
  const rest = [...perItem.values()].filter((entry) => !bottomIds.has(entry.id));
  const sum = (entries: typeof bottom) =>
    entries.reduce(
      (acc, entry) => ({ covered: acc.covered + entry.covered, total: acc.total + entry.total }),
      { covered: 0, total: 0 },
    );
  const bottomSum = sum(bottom);
  const restSum = sum(rest);
  const bottomRate = bottomSum.covered / bottomSum.total;
  const restRate = restSum.covered / restSum.total;
  const gap = restRate - bottomRate;
  const lowest = [...perItem.values()]
    .sort((a, b) => a.rate - b.rate || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((entry) => `${entry.id} ${entry.covered}/${entry.total}`);

  t.diagnostic(
    `per-item 95% coverage: bottom decile ${bottomRate.toFixed(3)} ` +
      `(${bottomSum.covered}/${bottomSum.total}), rest ${restRate.toFixed(3)} ` +
      `(${restSum.covered}/${restSum.total}), gap ${gap.toFixed(3)}; lowest ${lowest.join(", ")}`,
  );
  assert.ok(
    bottomRate >= MIN_BOTTOM_DECILE_COVERAGE,
    `bottom-decile coverage ${bottomRate.toFixed(3)} below ${MIN_BOTTOM_DECILE_COVERAGE}`,
  );
  assert.ok(
    gap <= MAX_BOTTOM_DECILE_GAP,
    `bottom-decile gap ${gap.toFixed(3)} above ${MAX_BOTTOM_DECILE_GAP}`,
  );
});

test("predicts held-out comparisons better than chance", () => {
  const synthetic = generateSyntheticPreferences({ seed: 42, items: 24, users: 32, comparisons: 1_600 });
  const fit = fitBradleyTerry(synthetic.events);
  const heldOut = sampleComparisons(synthetic.strengths, 800, { seed: 1042 });
  const accuracy = heldOutAccuracy(fit, heldOut);
  assert.ok(accuracy.total > 500, "held-out set should be large enough to be meaningful");
  assert.ok(
    accuracy.accuracy >= MIN_HELD_OUT_ACCURACY,
    `held-out accuracy ${accuracy.accuracy.toFixed(3)} below ${MIN_HELD_OUT_ACCURACY}`,
  );
});

test("confidence intervals cover the true strengths across seeds", () => {
  const rates: { seed: number; rate: number; covered: number; total: number }[] = [];
  let lastFit: ReturnType<typeof fitBradleyTerry> | undefined;

  for (const seed of COVERAGE_SEEDS) {
    const { synthetic, fit, coverage } = evaluateSyntheticPreferences({
      seed,
      items: 24,
      users: 32,
      comparisons: 1_600,
    });
    assert.ok(fit.converged, `fit did not converge for seed ${seed}`);
    assert.equal(coverage.total, synthetic.strengths.size);
    assert.ok(
      coverage.rate >= MIN_PER_SEED_INTERVAL_COVERAGE,
      `seed ${seed}: interval coverage ${coverage.rate.toFixed(2)} (${coverage.covered}/${coverage.total}) ` +
        `below the per-seed floor ${MIN_PER_SEED_INTERVAL_COVERAGE}`,
    );
    rates.push({ seed, ...coverage });
    lastFit = fit;
  }

  const mean = rates.reduce((sum, entry) => sum + entry.rate, 0) / rates.length;
  assert.ok(
    mean >= MIN_MEAN_INTERVAL_COVERAGE,
    `mean interval coverage ${mean.toFixed(3)} across seeds ${COVERAGE_SEEDS.join(", ")} ` +
      `(${rates.map((entry) => entry.rate.toFixed(2)).join(", ")}) below ${MIN_MEAN_INTERVAL_COVERAGE}`,
  );

  // A 95% interval that covers everything would be uselessly wide; the model
  // should still be informative for a well-sampled population.
  const width = medianIntervalWidth(lastFit!.items);
  assert.ok(width < 2, `median 95% interval width ${width.toFixed(2)} is too wide to be useful`);
});

test("fitted strengths are invariant to event order and side assignment", () => {
  const synthetic = generateSyntheticPreferences({ seed: 3, items: 20, users: 24, comparisons: 1_200 });
  const baseline = fitBradleyTerry(synthetic.events);

  const shuffled = [...synthetic.events].reverse();
  // Deterministic interleave so the test does not depend on Math.random.
  for (let i = 0; i < shuffled.length; i += 2) {
    [shuffled[i], shuffled[(i * 7 + 1) % shuffled.length]] = [
      shuffled[(i * 7 + 1) % shuffled.length]!,
      shuffled[i]!,
    ];
  }
  const orderFit = fitBradleyTerry(shuffled);

  const flipped = synthetic.events.map((event) => ({
    aId: event.bId,
    bId: event.aId,
    outcome: event.outcome === "a" ? ("b" as const) : event.outcome === "b" ? ("a" as const) : event.outcome,
  }));
  const flippedFit = fitBradleyTerry(flipped);

  for (const item of baseline.items) {
    const byOrder = orderFit.byId.get(item.id)!;
    const byFlip = flippedFit.byId.get(item.id)!;
    assert.ok(
      Math.abs(item.theta - byOrder.theta) < 1e-6,
      `order changed ${item.id}: ${item.theta} vs ${byOrder.theta}`,
    );
    assert.ok(
      Math.abs(item.theta - byFlip.theta) < 1e-6,
      `side flip changed ${item.id}: ${item.theta} vs ${byFlip.theta}`,
    );
  }
});

test("cold-start items are shrunk and visibly less certain", () => {
  const synthetic = generateSyntheticPreferences({ seed: 42, items: 12, users: 20, comparisons: 900 });
  const events: ComparisonEvent[] = [
    ...synthetic.events,
    { aId: "cold", bId: "item-00", outcome: "a" },
    { aId: "cold", bId: "item-01", outcome: "b" },
    // A skipped comparison is not evidence, so it must not fit the item.
    { aId: "unseen", bId: "item-00", outcome: "skip" },
  ];
  const fit = fitBradleyTerry(events);
  const cold = fit.byId.get("cold");
  assert.ok(cold, "an item with comparisons should be fitted");
  assert.equal(fit.byId.has("unseen"), false, "an item with only skips must not be fabricated");

  const warm = fit.items.filter((item) => item.id !== "cold" && item.comparisons >= 10);
  const warmMedianSe = median(warm.map((item) => item.standardError));
  assert.ok(cold.standardError > warmMedianSe * 2, `cold SE ${cold.standardError} vs warm ${warmMedianSe}`);
  const coldWidth = cold.upper - cold.lower;
  const warmWidth = medianIntervalWidth(warm);
  assert.ok(coldWidth > warmWidth * 1.5, `cold interval ${coldWidth.toFixed(2)} vs warm ${warmWidth.toFixed(2)}`);
  // With two comparisons the prior should keep the estimate from running away.
  assert.ok(Math.abs(cold.theta) < 2, `cold theta ${cold.theta.toFixed(2)} escaped the prior`);
});

test("fits a large catalog inside the runtime budget", () => {
  const synthetic = generateSyntheticPreferences({ seed: 5, items: 300, users: 120, comparisons: 12_000 });
  const started = performance.now();
  const fit = fitBradleyTerry(synthetic.events);
  const elapsed = performance.now() - started;

  assert.ok(fit.items.length >= 300, "the fit should include every observed item");
  assert.ok(fit.converged, "the large fit should converge");
  assert.ok(
    elapsed < RUNTIME_BUDGET_MS,
    `300 items / ${synthetic.events.length} comparisons took ${elapsed.toFixed(0)} ms, budget ${RUNTIME_BUDGET_MS} ms`,
  );
  assert.ok(
    spearmanCorrelation(fit, synthetic.strengths) >= MIN_SPEARMAN,
    "the large fit should still recover the ordering",
  );
});

/**
 * A fit that reports convergence must be a stationary point of the objective it
 * optimises. With the cross terms referencing the wrong item, the fitter stopped
 * after two Newton steps at a point whose true gradient was large (max|g| ≈ 1.2
 * at seed 42 and ≈ 7.3 at seed 7), while still reporting `converged: true`.
 */
test("the fitted solution is a stationary point of the penalised likelihood", () => {
  for (const seed of [7, 42]) {
    const synthetic = generateSyntheticPreferences({ seed, items: 8, users: 12, comparisons: 800 });
    const fit = fitBradleyTerry(synthetic.events);
    assert.ok(fit.converged, `fit did not converge for seed ${seed}`);

    const theta = new Map(fit.items.map((item) => [item.id, item.theta]));
    const gradient = logLikelihoodGradient(synthetic.events, theta);
    const maxAbs = Math.max(...[...gradient.values()].map(Math.abs));
    assert.ok(
      maxAbs < 1e-4,
      `seed ${seed}: fitted solution is not stationary, max|grad| = ${maxAbs.toFixed(4)}`,
    );
  }
});

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}
