import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity, genreProfile, kendallTauB, tasteMatch } from "./taste-match.ts";

function pairs(values: Array<[number, number]>) {
  return values.map(([mine, theirs], index) => ({ id: `i${index}`, mine, theirs }));
}

test("Kendall tau-b is 1 for identical orders and -1 for reversed orders", () => {
  assert.equal(kendallTauB(pairs([[1, 1], [2, 2], [3, 3], [4, 4]])), 1);
  assert.equal(kendallTauB(pairs([[1, 4], [2, 3], [3, 2], [4, 1]])), -1);
});

test("Kendall tau-b handles ties without dividing by zero", () => {
  const tau = kendallTauB(pairs([[5, 5], [5, 5], [5, 5]]));
  assert.equal(tau, null);

  const mostlyTied = kendallTauB(pairs([[1, 1], [2, 2], [3, 3], [3, 4]]));
  assert.ok(mostlyTied !== null && mostlyTied > 0 && mostlyTied < 1);
});

test("insufficient shared data returns null rather than a fake percentage", () => {
  const result = tasteMatch({ shared: [] });
  assert.equal(result.match, null);
  assert.equal(result.confidence, "low");
  assert.match(result.basis, /No shared/);
});

test("identical taste scores 100 with high confidence once enough items are shared", () => {
  const shared = pairs(Array.from({ length: 24 }, (_, index) => [10 - index * 0.2, 10 - index * 0.2]));
  const result = tasteMatch({ shared });
  assert.ok(result.match !== null && result.match >= 99);
  assert.equal(result.confidence, "high");
  assert.equal(result.kendallTauB, 1);
  assert.equal(result.agreements, 24);
});

test("opposite rankings produce a much lower match than identical ones", () => {
  const identical = tasteMatch({
    shared: pairs(Array.from({ length: 20 }, (_, index) => [index, index])),
  });
  const reversed = tasteMatch({
    shared: pairs(Array.from({ length: 20 }, (_, index) => [index, 20 - index])),
  });
  assert.ok(identical.match! > reversed.match!);
  assert.ok(reversed.match! < 50);
  assert.ok(reversed.kendallTauB! < 0);
});

test("shared genres do not rescue opposite opinions", () => {
  const genres = new Map([["Drama", 8], ["Sci-Fi", 5]]);
  const result = tasteMatch({
    shared: pairs(Array.from({ length: 8 }, (_, index) => [index, 8 - index])),
    mineProfile: genres,
    theirsProfile: genres,
  });
  assert.ok(result.match !== null);
  assert.ok(result.match < 45);
});

test("a single shared title is labelled low confidence, not high", () => {
  const result = tasteMatch({ shared: pairs([[8, 8]]) });
  assert.equal(result.shared, 1);
  assert.equal(result.confidence, "low");
  assert.equal(result.kendallTauB, null);
  assert.ok(result.match !== null);
});

test("genre vectors use cosine similarity and ignore empty profiles", () => {
  const a = genreProfile([{ genres: ["Drama", "Sci-Fi"] }, { genres: ["Drama"] }]);
  const b = genreProfile([{ genres: ["Drama"] }, { genres: ["Sci-Fi"] }]);
  assert.ok(Math.abs((cosineSimilarity(a, b) ?? 0) - 0.949) < 0.01);
  assert.equal(cosineSimilarity(a, new Map()), null);
});
