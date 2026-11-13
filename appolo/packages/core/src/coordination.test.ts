import assert from "node:assert/strict";
import test from "node:test";
import { detectCoordinatedVoting, type CoordinationVote } from "./coordination.ts";

function votesFor(
  reviewers: string[],
  items: Array<{ id: string; score: (reviewer: string) => number }>,
): CoordinationVote[] {
  return reviewers.flatMap((reviewerId) =>
    items.map((item) => ({ reviewerId, itemId: item.id, score: item.score(reviewerId) })),
  );
}

test("two accounts rating six titles almost identically are flagged", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`,
    score: (reviewer: string) => (reviewer === "ring-a" ? 9 : 8.8),
  }));
  const report = detectCoordinatedVoting(votesFor(["ring-a", "ring-b"], items));

  assert.equal(report.pairs.length, 1);
  assert.equal(report.pairs[0]?.shared, 6);
  assert.equal(report.pairs[0]?.agreement, 1);
  assert.ok(report.suspiciousReviewers.has("ring-a"));
  assert.ok(report.suspiciousReviewers.has("ring-b"));
  assert.equal(report.suspiciousVotesByItem.get("item-0"), 2);
  assert.equal(report.suspiciousVotesByReviewer.get("ring-a"), 6);
});

test("reviewers who disagree on shared titles are not flagged", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `item-${index}`,
    score: (reviewer: string) => (reviewer === "one" ? 9 : index % 2 === 0 ? 2 : 9),
  }));
  const report = detectCoordinatedVoting(votesFor(["one", "two"], items));

  assert.equal(report.pairs.length, 0);
  assert.equal(report.suspiciousReviewers.size, 0);
});

test("a few shared titles are treated as coincidence, not coordination", () => {
  const items = Array.from({ length: 4 }, (_, index) => ({
    id: `item-${index}`,
    score: () => 7,
  }));
  const report = detectCoordinatedVoting(votesFor(["a", "b"], items));

  assert.equal(report.pairs.length, 0);
});

test("a single reviewer can never form a pair", () => {
  const votes = Array.from({ length: 10 }, (_, index) => ({
    reviewerId: "solo",
    itemId: `item-${index}`,
    score: 5,
  }));
  const report = detectCoordinatedVoting(votes);
  assert.equal(report.pairs.length, 0);
  assert.equal(report.suspiciousVotesByItem.size, 0);
});

test("one vote per reviewer and title is counted, even with several partners", () => {
  const items = Array.from({ length: 6 }, (_, index) => `item-${index}`);
  const votes: CoordinationVote[] = [];
  for (const itemId of items) {
    for (const reviewerId of ["ring-a", "ring-b", "ring-c"]) {
      votes.push({ reviewerId, itemId, score: 9 });
    }
  }
  const report = detectCoordinatedVoting(votes);

  // All three pairs are flagged, but each vote still counts once.
  assert.equal(report.pairs.length, 3);
  assert.equal(report.suspiciousVotesByItem.get("item-0"), 3);
  assert.equal(report.suspiciousVotesByReviewer.get("ring-a"), 6);
});

test("suspicion rises with more shared titles at full agreement", () => {
  const make = (shared: number) =>
    detectCoordinatedVoting(
      votesFor(
        ["a", "b"],
        Array.from({ length: shared }, (_, index) => ({ id: `item-${index}`, score: () => 8 })),
      ),
    ).pairs[0]?.suspicion ?? 0;

  assert.ok(make(15) > make(6));
});

test("scores outside the finite range are ignored", () => {
  const report = detectCoordinatedVoting([
    { reviewerId: "a", itemId: "one", score: Number.NaN },
    { reviewerId: "b", itemId: "one", score: 7 },
  ]);
  assert.equal(report.pairs.length, 0);
});
