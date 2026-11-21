import assert from "node:assert/strict";
import test from "node:test";
import { duplicateVerdict, normalizeTitle, pickCanonical, titleKey } from "./normalize";

test("normalizeTitle strips accents, punctuation and a leading article", () => {
  // Only a leading article is dropped; articles inside a title are kept (the
  // duplicate scorer ignores them when it compares word sets).
  assert.equal(normalizeTitle("The Lord of the Rings: The Fellowship"), "lord of the rings the fellowship");
  assert.equal(normalizeTitle("A Quiet Place"), "quiet place");
  assert.equal(normalizeTitle("Amélie"), "amelie");
  assert.equal(normalizeTitle("Spider-Man: No Way Home"), "spider man no way home");
  assert.equal(titleKey("Spider-Man"), titleKey("spider man"));
});

test("the same title from two providers is a duplicate even without a year", () => {
  const verdict = duplicateVerdict(
    { id: "a", kind: "movie", title: "Blade Runner 2049", year: 2017 },
    { id: "b", kind: "movie", title: "Blade Runner 2049", year: 2017 },
  );
  assert.equal(verdict.duplicate, true);
  assert.equal(verdict.reason, "exact-title-year");
});

test("a remake is not a duplicate of the original", () => {
  const verdict = duplicateVerdict(
    { id: "a", kind: "movie", title: "Dune", year: 1984 },
    { id: "b", kind: "movie", title: "Dune", year: 2021 },
  );
  assert.equal(verdict.duplicate, false);
});

test("punctuation and small word differences still merge", () => {
  const verdict = duplicateVerdict(
    { id: "a", kind: "music", title: "The Dark Side of the Moon", year: 1973 },
    { id: "b", kind: "music", title: "Dark Side of the Moon (Remastered)", year: 1973 },
  );
  assert.equal(verdict.duplicate, true, `score ${verdict.score}`);
});

test("different titles of the same year do not merge", () => {
  const verdict = duplicateVerdict(
    { id: "a", kind: "movie", title: "Heat", year: 1995 },
    { id: "b", kind: "movie", title: "Se7en", year: 1995 },
  );
  assert.equal(verdict.duplicate, false);
});

test("different kinds never merge, and a shared external ref always does", () => {
  assert.equal(
    duplicateVerdict(
      { id: "a", kind: "movie", title: "Fargo", year: 1996 },
      { id: "b", kind: "tv", title: "Fargo", year: 1996 },
    ).duplicate,
    false,
  );
  assert.equal(
    duplicateVerdict(
      { id: "a", kind: "game", title: "Elden Ring", year: 2022, externalRef: "rawg:1" },
      { id: "b", kind: "game", title: "ELDEN RING", year: 2022, externalRef: "rawg:1" },
    ).reason,
    "external-ref",
  );
});

test("pickCanonical keeps the most-rated row, then the oldest", () => {
  const rows = [
    { id: "b", createdAt: "2024-01-02T00:00:00Z" },
    { id: "a", createdAt: "2024-01-01T00:00:00Z" },
    { id: "c", createdAt: "2023-01-01T00:00:00Z" },
  ];
  const counts = new Map([
    ["a", 4],
    ["b", 9],
    ["c", 0],
  ]);
  assert.equal(pickCanonical(rows, counts).id, "b");
  assert.equal(pickCanonical(rows, new Map()).id, "c");
});
