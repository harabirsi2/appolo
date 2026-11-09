import assert from "node:assert/strict";
import { test } from "node:test";
import { hashUnit, normalizeGenreWeights, rankFeed, type FeedInput } from "./feed-rank.js";

const now = new Date("2026-05-01T12:00:00.000Z");

function review(overrides: Partial<FeedInput> & { id: string }): FeedInput {
  return {
    authorId: "author-1",
    createdAt: new Date(now.getTime() - 3_600_000),
    genres: [],
    ...overrides,
  };
}

test("newer reviews outrank older ones with no other signal", () => {
  const ranked = rankFeed(
    [
      review({ id: "old", createdAt: new Date(now.getTime() - 96 * 3_600_000) }),
      review({ id: "new", createdAt: new Date(now.getTime() - 60_000) }),
    ],
    { now },
    { exploration: 0 },
  );
  assert.equal(ranked[0]!.item.id, "new");
  assert.ok(ranked[0]!.components.freshness > ranked[1]!.components.freshness);
});

test("following an author is the strongest single boost", () => {
  const ranked = rankFeed(
    [
      review({ id: "stranger", authorId: "a", createdAt: new Date(now.getTime() - 60_000) }),
      review({ id: "followed", authorId: "b", createdAt: new Date(now.getTime() - 30 * 3_600_000) }),
    ],
    { now, followedAuthorIds: ["b"] },
    { exploration: 0 },
  );
  assert.equal(ranked[0]!.item.id, "followed");
  assert.equal(ranked[0]!.reason.code, "followed");
  assert.equal(ranked[0]!.reason.label, "From someone you follow");
});

test("genre overlap raises relevance and explains the pick", () => {
  const genreWeights = normalizeGenreWeights(["Drama", "Drama", "Drama", "Comedy"]);
  assert.equal(genreWeights.drama, 0.75);
  const ranked = rankFeed(
    [
      review({ id: "off-taste", genres: ["Horror"] }),
      review({ id: "on-taste", genres: ["drama"] }),
    ],
    { now, genreWeights },
    { exploration: 0 },
  );
  assert.equal(ranked[0]!.item.id, "on-taste");
  assert.equal(ranked[0]!.reason.code, "taste");
  assert.equal(ranked[1]!.components.relevance, 0);
});

test("engagement can lift an older review and is capped", () => {
  const ranked = rankFeed(
    [
      review({ id: "quiet", reactions: 0, comments: 0 }),
      review({ id: "discussed", reactions: 40, comments: 12, createdAt: new Date(now.getTime() - 20 * 3_600_000) }),
    ],
    { now },
    { exploration: 0 },
  );
  assert.equal(ranked[0]!.item.id, "discussed");
  assert.equal(ranked[0]!.reason.code, "popular");
  assert.ok(ranked[0]!.components.engagement <= 1);
});

test("seen reviews are excluded and output order is deterministic", () => {
  const items = [review({ id: "b" }), review({ id: "a" }), review({ id: "c" })];
  const first = rankFeed(items, { now, seenIds: ["c"] });
  const second = rankFeed(items, { now, seenIds: ["c"] });
  assert.deepEqual(
    first.map((entry) => entry.item.id),
    second.map((entry) => entry.item.id),
  );
  assert.ok(!first.some((entry) => entry.item.id === "c"));
});

test("hashUnit is stable and inside [0, 1)", () => {
  assert.equal(hashUnit("review-123"), hashUnit("review-123"));
  assert.notEqual(hashUnit("review-123"), hashUnit("review-124"));
  for (const value of ["", "a", "Appolo", "9f8e7d"]) {
    const unit = hashUnit(value);
    assert.ok(unit >= 0 && unit < 1);
  }
});
