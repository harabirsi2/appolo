import test from "node:test";
import assert from "node:assert/strict";
import { expectedWinsAgainst, scoreInterval, type FittedItem } from "./ranking-model";

function item(overrides: Partial<FittedItem> & { id: string }): FittedItem {
  const theta = overrides.theta ?? 0;
  return {
    id: overrides.id,
    theta,
    standardError: overrides.standardError ?? 0.2,
    lower: overrides.lower ?? theta - 0.39,
    upper: overrides.upper ?? theta + 0.39,
    comparisons: overrides.comparisons ?? 12,
    wins: overrides.wins ?? 7,
    losses: overrides.losses ?? 5,
    ties: overrides.ties ?? 0,
    winRate: overrides.winRate ?? 0.58,
    personalScore: overrides.personalScore ?? 0,
  };
}

test("expected wins is 5 with no opponents and monotone in theta", () => {
  assert.equal(expectedWinsAgainst(0.8, [], 0.5), 5);
  const weak = expectedWinsAgainst(-1, [0, 0, 1], 0.5);
  const strong = expectedWinsAgainst(1, [0, 0, 1], 0.5);
  assert.ok(strong > weak, `${strong} should exceed ${weak}`);
});

test("score interval brackets the point score and shrinks with the standard error", () => {
  const field = [item({ id: "a", theta: 1.2 }), item({ id: "b", theta: 0 }), item({ id: "c", theta: -0.8 })];
  const tight = scoreInterval(item({ id: "a", theta: 1.2, standardError: 0.1, lower: 1.0, upper: 1.4 }), field, 0.5);
  const wide = scoreInterval(item({ id: "a", theta: 1.2, standardError: 0.6, lower: -0.1, upper: 2.5 }), field, 0.5);

  assert.ok(tight.lower <= tight.score && tight.score <= tight.upper);
  assert.ok(wide.lower <= wide.score && wide.score <= wide.upper);
  assert.ok(wide.margin > tight.margin, "a wider theta interval must widen the score margin");
});

test("the interval stays inside 0..10 even at the extremes", () => {
  const field = [item({ id: "a", theta: 6 }), item({ id: "b", theta: -6 }), item({ id: "c", theta: -6 })];
  const top = scoreInterval(item({ id: "a", theta: 6, lower: 2, upper: 9 }), field, 0.5);
  const bottom = scoreInterval(item({ id: "c", theta: -6, lower: -9, upper: -2 }), field, 0.5);
  for (const interval of [top, bottom]) {
    assert.ok(interval.lower >= 0 && interval.upper <= 10, JSON.stringify(interval));
    assert.ok(interval.margin >= 0 && interval.margin <= 5);
  }
});
