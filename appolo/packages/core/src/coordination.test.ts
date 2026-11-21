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

test("a reviewer ring counts each vote once even when two partners share a title", () => {
  // A→B→C→A: every reviewer has exactly two partners and the pair windows
  // slide, so B's and C's votes on the overlap are reachable from two flagged
  // pairs. Each (reviewer, title) may still only be counted once.
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => `ring-${from + index}`);
  const plan: Record<string, string[]> = {
    ringA: [...range(0, 5), ...range(6, 11)],
    ringB: range(0, 8),
    ringC: range(3, 11),
  };
  const votes: CoordinationVote[] = Object.entries(plan).flatMap(([reviewerId, items]) =>
    items.map((itemId) => ({ reviewerId, itemId, score: 9 })),
  );

  const report = detectCoordinatedVoting(votes);

  assert.equal(report.pairs.length, 3);
  for (const pair of report.pairs) assert.equal(pair.agreement, 1);

  // ring-0..2 are rated by A and B, ring-3..8 by all three, ring-9..11 by A and C.
  const expectedByItem = [
    ...Array.from({ length: 3 }, () => 2),
    ...Array.from({ length: 6 }, () => 3),
    ...Array.from({ length: 3 }, () => 2),
  ];
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => report.suspiciousVotesByItem.get(`ring-${index}`)),
    expectedByItem,
  );
  assert.deepEqual(Object.fromEntries(report.suspiciousVotesByReviewer), {
    ringA: 12,
    ringB: 9,
    ringC: 9,
  });

  // Every flagged pair covers every vote here, so the counted total must equal
  // the number of distinct (reviewer, title) pairs — 12 + 9 + 9.
  const counted = [...report.suspiciousVotesByItem.values()].reduce((sum, n) => sum + n, 0);
  const uniqueVotes = new Set(votes.map((vote) => `${vote.reviewerId}\u0000${vote.itemId}`)).size;
  assert.equal(counted, uniqueVotes, "a vote reachable from two pairs was counted twice");
  assert.equal(counted, 30);
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
