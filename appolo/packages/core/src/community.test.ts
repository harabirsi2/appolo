import assert from "node:assert/strict";
import test from "node:test";
import { communityConfidence, shrinkCommunityScore } from "./community.ts";

test("no ratings means no score", () => {
  const result = shrinkCommunityScore({ mean: 9.5, count: 0 });
  assert.equal(result.score, null);
  assert.equal(result.confidence, "none");
});

test("a single high rating is pulled toward the prior", () => {
  const result = shrinkCommunityScore({ mean: 10, count: 1 });
  assert.ok(result.score !== null && result.score < 7);
  assert.equal(result.raw, 10);
  assert.equal(result.confidence, "low");
  assert.ok(result.adjustment < 0);
});

test("large samples move very little", () => {
  const result = shrinkCommunityScore({ mean: 8, count: 400 });
  assert.ok(result.score !== null && Math.abs(result.score - 8) < 0.1);
  assert.equal(result.confidence, "high");
});

test("confidence thresholds are explicit", () => {
  assert.equal(communityConfidence(0), "none");
  assert.equal(communityConfidence(1), "low");
  assert.equal(communityConfidence(5), "medium");
  assert.equal(communityConfidence(20), "high");
});

test("shrinkage is monotonic in count for a mean above the prior", () => {
  const one = shrinkCommunityScore({ mean: 9, count: 1 }).score!;
  const ten = shrinkCommunityScore({ mean: 9, count: 10 }).score!;
  const hundred = shrinkCommunityScore({ mean: 9, count: 100 }).score!;
  assert.ok(one < ten && ten < hundred && hundred < 9);
});
