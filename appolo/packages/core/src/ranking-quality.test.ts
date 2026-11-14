import assert from "node:assert/strict";
import test from "node:test";
import { fitBradleyTerry, type ComparisonEvent } from "./ranking-model.ts";
import {
  evaluateSyntheticPreferences,
  generateSyntheticPreferences,
  heldOutAccuracy,
  intervalCoverage,
  medianIntervalWidth,
  sampleComparisons,
  spearmanCorrelation,
} from "./ranking-quality.ts";

/**
 * Thresholds are deliberately below the observed values on this machine
 * (Spearman 0.90–0.96, held-out accuracy 0.68–0.73, interval coverage
 * 0.79–0.96 at 24 items / ~1,300 comparisons). They are chosen to fail on a
 * real regression — a broken prior, a mis-centred fit, ignored ties — not on
 * run-to-run noise, since every stage is seeded and deterministic.
 */
const MIN_SPEARMAN = 0.85;
const MIN_HELD_OUT_ACCURACY = 0.65;
const MIN_INTERVAL_COVERAGE = 0.75;
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

test("confidence intervals cover the true strengths", () => {
  const synthetic = generateSyntheticPreferences({ seed: 42, items: 24, users: 32, comparisons: 1_600 });
  const fit = fitBradleyTerry(synthetic.events);
  const coverage = intervalCoverage(fit, synthetic.strengths);
  assert.equal(coverage.total, synthetic.strengths.size);
  assert.ok(
    coverage.rate >= MIN_INTERVAL_COVERAGE,
    `interval coverage ${coverage.rate.toFixed(2)} (${coverage.covered}/${coverage.total}) below ${MIN_INTERVAL_COVERAGE}`,
  );
  // A 95% interval that covers everything would be uselessly wide; the model
  // should still be informative for a well-sampled population.
  const width = medianIntervalWidth(fit.items);
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}
