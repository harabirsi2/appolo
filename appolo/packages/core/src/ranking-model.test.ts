import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonEntropy,
  davidsonProbabilities,
  fitBradleyTerry,
  pairKey,
  probabilityABeatsB,
  scoreInformativeOpponents,
  selectInformativeOpponent,
  type ComparisonEvent,
} from "./ranking-model.ts";

function repeat(aId: string, bId: string, outcome: ComparisonEvent["outcome"], n: number): ComparisonEvent[] {
  return Array.from({ length: n }, () => ({ aId, bId, outcome }));
}

test("a consistently preferred item gets a higher theta", () => {
  const fit = fitBradleyTerry(repeat("a", "b", "a", 12));
  const a = fit.byId.get("a")!;
  const b = fit.byId.get("b")!;
  assert.ok(a.theta > b.theta);
  assert.ok(a.winRate === 1);
  assert.ok(b.winRate === 0);
  assert.ok(fit.converged);
});

test("reversing the comparison reverses the preference", () => {
  const forward = fitBradleyTerry(repeat("a", "b", "a", 10));
  const reverse = fitBradleyTerry(repeat("a", "b", "b", 10));
  assert.ok(forward.byId.get("a")!.theta > forward.byId.get("b")!.theta);
  assert.ok(reverse.byId.get("b")!.theta > reverse.byId.get("a")!.theta);
  assert.ok(Math.abs(forward.byId.get("a")!.theta + reverse.byId.get("a")!.theta) < 1e-6);
});

test("the same events always fit to the same result", () => {
  const events = [
    ...repeat("a", "b", "a", 5),
    ...repeat("b", "c", "b", 4),
    ...repeat("a", "c", "a", 3),
    ...repeat("b", "c", "tie", 2),
  ];
  const first = fitBradleyTerry(events);
  const second = fitBradleyTerry(events);
  assert.deepEqual(
    first.items.map((item) => [item.id, item.theta, item.personalScore]),
    second.items.map((item) => [item.id, item.theta, item.personalScore]),
  );
});

test("skipped comparisons never change the fit", () => {
  const decided = [...repeat("a", "b", "a", 6), ...repeat("a", "c", "b", 2)];
  const withSkips = [...decided, ...repeat("a", "b", "skip", 20)];
  const withoutSkips = fitBradleyTerry(decided);
  const withSkipsFit = fitBradleyTerry(withSkips);
  assert.equal(withoutSkips.byId.get("a")!.theta, withSkipsFit.byId.get("a")!.theta);
  assert.equal(withoutSkips.byId.get("a")!.comparisons, withSkipsFit.byId.get("a")!.comparisons);
});

test("explicit ties keep the items level without producing extreme scores", () => {
  const fit = fitBradleyTerry(repeat("a", "b", "tie", 20));
  const a = fit.byId.get("a")!;
  const b = fit.byId.get("b")!;
  assert.ok(Math.abs(a.theta - b.theta) < 1e-6);
  assert.ok(a.ties === 20 && b.ties === 20);
  assert.ok(a.winRate === null);
  // Expected wins, not expected non-losses: a heavy tie rate pulls the
  // score below 5 because ties do not count as wins.
  assert.equal(a.personalScore, b.personalScore);
  assert.ok(a.personalScore > 3 && a.personalScore < 5);
});

test("undecided is weaker evidence than a repeat of a decided win", () => {
  const decided = fitBradleyTerry(repeat("a", "b", "a", 10));
  const undecided = fitBradleyTerry([
    ...repeat("a", "b", "a", 10),
    ...repeat("a", "b", "undecided", 10),
  ]);
  assert.ok(undecided.byId.get("a")!.theta < decided.byId.get("a")!.theta);
});

test("uncertainty shrinks as comparisons accumulate", () => {
  const few = fitBradleyTerry(repeat("a", "b", "a", 3));
  const many = fitBradleyTerry(repeat("a", "b", "a", 40));
  assert.ok(many.byId.get("a")!.standardError < few.byId.get("a")!.standardError);
  assert.ok(many.byId.get("a")!.theta > few.byId.get("a")!.theta);
});

test("personal scores stay within 0–10 and are relative to the fitted set", () => {
  const fit = fitBradleyTerry([
    ...repeat("a", "b", "a", 10),
    ...repeat("a", "c", "a", 10),
    ...repeat("b", "c", "b", 10),
  ]);
  for (const item of fit.items) {
    assert.ok(item.personalScore >= 0 && item.personalScore <= 10);
  }
  assert.ok(fit.byId.get("a")!.personalScore > fit.byId.get("c")!.personalScore);
});

test("Davidson probabilities sum to one and are symmetric", () => {
  const p = davidsonProbabilities(0.8, -0.3, 0.55);
  assert.ok(Math.abs(p.pa + p.pb + p.pt - 1) < 1e-9);
  assert.ok(p.pa > p.pb);
  assert.equal(probabilityABeatsB(0.8, -0.3), p.pa);
});

test("comparison entropy peaks at an even matchup", () => {
  assert.ok(comparisonEntropy(0.5) > comparisonEntropy(0.9));
  assert.equal(comparisonEntropy(0), 0);
  assert.equal(comparisonEntropy(1), 0);
});

test("comparison selection avoids obvious and recently repeated matchups", () => {
  const candidates = [
    { id: "even", theta: 0.05, standardError: 0.9 },
    { id: "obvious", theta: 6, standardError: 0.05 },
    { id: "recent", theta: 0, standardError: 0.9 },
  ];
  const pick = selectInformativeOpponent({
    targetId: "target",
    targetTheta: 0,
    targetStandardError: 0.9,
    candidates,
    recentIds: ["recent"],
    pairCounts: new Map([[pairKey("target", "even"), 0]]),
  });
  assert.equal(pick, "even");

  const scored = scoreInformativeOpponents({
    targetId: "target",
    targetTheta: 0,
    targetStandardError: 0.9,
    candidates,
  });
  assert.ok(scored[0]!.utility > scored[scored.length - 1]!.utility);
});

test("large fits keep finite, centred uncertainty beyond the dense solver limit", () => {
  const events: ComparisonEvent[] = Array.from({ length: 520 }, (_, index) => ({
    aId: `item-${index % 260}`,
    bId: `item-${(index * 37 + 11) % 260}`,
    outcome: index % 7 === 0 ? "tie" : index % 3 === 0 ? "b" : "a",
  }));

  const fit = fitBradleyTerry(events);
  assert.equal(fit.items.length, 260);
  for (const item of fit.items) {
    assert.ok(Number.isFinite(item.theta), `${item.id} theta is not finite`);
    assert.ok(Number.isFinite(item.standardError), `${item.id} standard error is not finite`);
    assert.ok(item.standardError >= 0);
    assert.ok(item.lower <= item.theta && item.theta <= item.upper);
  }
});
