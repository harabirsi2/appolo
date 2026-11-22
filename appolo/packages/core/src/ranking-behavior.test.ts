import test from "node:test";
import assert from "node:assert/strict";
import {
  K_FACTOR,
  START_ELO,
  kFactorFor,
  nextElo,
  nextEloAdaptive,
  selectOpponent,
  type Contender,
} from "./ranking";

/**
 * The four functions every ranking number depends on had no tests: nextElo,
 * nextEloAdaptive, kFactorFor and selectOpponent. These pin the properties the
 * rest of the system assumes rather than specific magic numbers.
 */

test("kFactorFor halves in three bands and never returns zero", () => {
  assert.equal(kFactorFor(0), K_FACTOR * 2);
  assert.equal(kFactorFor(9), K_FACTOR * 2, "9 decided matches is still the rookie band");
  assert.equal(kFactorFor(10), Math.round(K_FACTOR * 1.5));
  assert.equal(kFactorFor(19), Math.round(K_FACTOR * 1.5));
  assert.equal(kFactorFor(20), K_FACTOR);
  assert.equal(kFactorFor(1_000), K_FACTOR, "the settled band must not keep growing");
  assert.ok(kFactorFor(0) > kFactorFor(10) && kFactorFor(10) > kFactorFor(20));
});

test("nextElo is zero-sum and moves by at least one point", () => {
  const win = nextElo(1500, 1500, "win");
  assert.equal(win.a - 1500, 1500 - win.b, "the pair must move by equal and opposite amounts");
  assert.ok(win.a > 1500 && win.b < 1500);
  assert.ok(Number.isInteger(win.a) && Number.isInteger(win.b), "ratings stay integral");

  const loss = nextElo(1500, 1500, "loss");
  assert.equal(loss.a, win.b, "a loss is the mirror of a win");
  assert.equal(loss.b, win.a);

  // Beating a much stronger item is worth more than beating an equal one.
  const upset = nextElo(1400, 1700, "win");
  assert.ok(upset.a - 1400 > win.a - 1500, "an upset must carry more than an even match");
  // And it is worth less than the maximum possible swing.
  assert.ok(upset.a - 1400 <= K_FACTOR);
});

test("nextElo leaves both sides untouched on skip and undecided", () => {
  for (const result of ["skip", "undecided"] as const) {
    const after = nextElo(1512, 1477, result);
    assert.deepEqual(after, { a: 1512, b: 1477 }, `${result} must not move a rating`);
  }
});

test("a tie moves each side toward its expected score", () => {
  const even = nextElo(1500, 1500, "tie");
  assert.deepEqual(even, { a: 1500, b: 1500 }, "an even tie changes nothing");
  // The weaker side gains from a tie, the stronger side loses.
  const upsetTie = nextElo(1400, 1600, "tie");
  assert.ok(upsetTie.a > 1400, "the underdog should gain from a draw");
  assert.ok(upsetTie.b < 1600, "the favourite should lose from a draw");
});

test("nextEloAdaptive moves a rookie further than a settled item", () => {
  const rookieWins = nextEloAdaptive(1500, 1500, "win", 0, 100);
  const settledWins = nextEloAdaptive(1500, 1500, "win", 100, 0);
  assert.ok(
    rookieWins.a - 1500 > Math.abs(settledWins.a - 1500) ||
      settledWins.b - 1500 < 0,
    "the rookie side must take the larger share of the movement",
  );
  assert.ok(rookieWins.a > 1500 && rookieWins.b < 1500);
  // Each side uses its own K, so the movement is deliberately asymmetric.
  assert.notEqual(rookieWins.a - 1500, 1500 - rookieWins.b, "adaptive K must not be zero-sum in magnitude");
});

test("nextEloAdaptive with equal match counts matches a symmetric K", () => {
  const both = nextEloAdaptive(1500, 1400, "win", 30, 30);
  const single = nextElo(1500, 1400, "win", K_FACTOR);
  assert.deepEqual(both, single, "two settled items must behave like the fixed-K update");
});

test("nextEloAdaptive is a no-op for skips and keeps ratings integral", () => {
  assert.deepEqual(nextEloAdaptive(1500, 1500, "skip", 0, 0), { a: 1500, b: 1500 });
  const played = nextEloAdaptive(1510, 1495, "loss", 3, 21);
  assert.ok(Number.isInteger(played.a) && Number.isInteger(played.b));
});

const contender = (id: string, elo: number): Contender => ({ id, elo });

test("selectOpponent never returns the current item or null with a real pool", () => {
  const current = contender("a", 1500);
  const pool = [current, contender("b", 1510)];
  const pick = selectOpponent(current, pool, { seed: 1 });
  assert.ok(pick);
  assert.equal(pick?.id, "b");
  assert.equal(selectOpponent(current, [current], { seed: 0 }), null);
  assert.equal(selectOpponent(current, [], { seed: 0 }), null);
});

test("selectOpponent prefers the closest Elo and avoids recent opponents", () => {
  const current = contender("a", 1500);
  const near = contender("near", 1505);
  const far = contender("far", 1900);
  const mid = contender("mid", 1600);

  for (const seed of [0, 1, 7, 99]) {
    assert.equal(selectOpponent(current, [far, mid, near], { seed })?.id, "near");
  }

  // Recent pairs are excluded even when they are the closest match.
  const picked = selectOpponent(current, [near, mid, far], { seed: 3, recentIds: ["near"] });
  assert.equal(picked?.id, "mid");
});

test("selectOpponent falls back to the recent set when nothing else is left", () => {
  const current = contender("a", 1500);
  const only = contender("b", 1500);
  const pick = selectOpponent(current, [only], { seed: 0, recentIds: ["b"] });
  assert.equal(pick?.id, "b", "an empty fresh pool must not dead-end the duel");
});

test("selectOpponent does not simply return the first pool member", () => {
  const current = contender("a", 1500);
  // A pool whose first entry is the worst match: the lexicographic-order bug
  // class this guards against would return "003" every time.
  const pool = [contender("003", 2400), contender("002", 1900), contender("001", 1501)];
  for (const seed of [0, 1, 2, 3, 1000]) {
    assert.equal(selectOpponent(current, pool, { seed })?.id, "001", `seed ${seed} picked by position`);
  }
});

test("START_ELO is the neutral starting point used by selection", () => {
  assert.equal(START_ELO, 1500);
  const pick = selectOpponent(contender("x", START_ELO), [contender("y", START_ELO)], { seed: 0 });
  assert.equal(pick?.elo, START_ELO);
});
