#!/usr/bin/env node
/**
 * End-to-end checks against a running Appolo server and a real database.
 *
 * Usage:
 *   pnpm dev            # in one terminal
 *   pnpm e2e            # in another
 *
 * BASE_URL overrides http://localhost:3000. The script creates two throwaway
 * accounts per run (unique emails), so it is safe to re-run against a dev DB.
 * It exits non-zero if any check fails.
 */
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const stamp = Date.now().toString(36);
const password = "e2e-demo-1234";
// A unique source address per run keeps the auth rate limiter from treating
// repeated test runs as one abusive client.
const clientIp = `198.18.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function call(path, { method = "GET", body, cookie, redirect = "manual" } = {}) {
  const response = await fetch(BASE + path, {
    method,
    redirect,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": clientIp,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const nextCookie = setCookies.length
    ? setCookies.map((value) => value.split(";")[0]).join("; ")
    : cookie;
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML or empty */
  }
  return { status: response.status, json, text, cookie: nextCookie, headers: response.headers };
}

async function deleteAccount(cookie) {
  return call("/api/account/delete", {
    method: "POST",
    body: { password, confirm: "DELETE" },
    cookie,
  });
}

async function signup(label) {
  const email = `e2e-${label}-${stamp}@appolo.test`;
  const result = await call("/api/auth/signup", {
    method: "POST",
    body: {
      orgName: `E2E ${label} ${stamp}`,
      name: `E2E ${label}`,
      email,
      password,
      timezone: "UTC",
    },
  });
  assert.equal(result.status, 201, `signup ${label} returned ${result.status}: ${result.text.slice(0, 160)}`);
  assert.ok(result.cookie, "signup did not set a session cookie");
  const profilePage = await call("/app/profile", { cookie: result.cookie });
  assert.equal(profilePage.status, 200, "profile page did not render");
  const profile = await call("/api/profile", { cookie: result.cookie });
  assert.equal(profile.status, 200, "profile API failed");
  assert.ok(profile.json?.profile?.username, "profile username missing");
  return { email, cookie: result.cookie, username: profile.json.profile.username };
}

const health = await call("/api/health");
await check("server is up and database is reachable", () => {
  assert.equal(health.status, 200);
  assert.equal(health.json?.ok, true);
  assert.equal(health.json?.database, "up");
});

await check("anonymous API and pages are protected", async () => {
  const api = await call("/api/rankings");
  assert.equal(api.status, 401);
  const page = await call("/app");
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location") ?? "", /\/login/);
});

const alpha = await signup("alpha");
const beta = await signup("beta");

await check("two accounts get distinct public profiles", () => {
  assert.notEqual(alpha.username, beta.username);
});

const onboarding = await call("/app/onboarding", { cookie: alpha.cookie });
const badInterests = await call("/api/onboarding/interests", {
  method: "POST",
  body: { picks: [{ kind: "not-a-kind", genre: "Drama" }] },
  cookie: alpha.cookie,
});
const savedInterests = await call("/api/onboarding/interests", {
  method: "POST",
  body: { picks: [{ kind: "movie", genre: "Drama" }, { kind: "movie", genre: "Action" }] },
  cookie: alpha.cookie,
});
const onboardingAfter = await call("/app/onboarding", { cookie: alpha.cookie });
await check("onboarding saves interests and surfaces a starter comparison", () => {
  assert.equal(onboarding.status, 200);
  assert.match(onboarding.text, /Pick what you love/);
  assert.equal(badInterests.status, 400);
  assert.equal(savedInterests.status, 200);
  assert.equal(savedInterests.json.saved, 2);
  assert.match(onboardingAfter.text, /Start comparing/);
});

const catalog = await call("/api/catalog?kind=movie&limit=6", { cookie: alpha.cookie });
const items = catalog.json?.items ?? [];
await check("catalog returns at least four movie titles", () => {
  assert.equal(catalog.status, 200);
  assert.ok(items.length >= 4, `only ${items.length} items`);
});

const sample = items.slice(0, 6);
const alphaScores = [9.5, 9, 8.5, 7.5, 7, 6.5];

for (let index = 0; index < sample.length; index += 1) {
  const item = sample[index];
  const score = alphaScores[index];
  const result = await call(`/api/rankings/${item.id}/manual`, {
    method: "POST",
    body: { score },
    cookie: alpha.cookie,
  });
  assert.equal(result.status, 200, `alpha manual rating failed for ${item.title}`);
}
const betaRate = await Promise.all(
  sample.map((item, index) =>
    call(`/api/rankings/${item.id}/manual`, {
      method: "POST",
      body: { score: Math.round((10 - alphaScores[index]) * 10) / 10 },
      cookie: beta.cookie,
    }),
  ),
);
await check("both accounts can rate the same titles", () => {
  assert.ok(betaRate.every((result) => result.status === 200));
});

const rankings = await call("/api/rankings?kind=movie", { cookie: alpha.cookie });
await check("ratings persist and are ordered", () => {
  assert.equal(rankings.status, 200);
  assert.ok(rankings.json.rankings.length >= 4);
  for (let index = 1; index < rankings.json.rankings.length; index += 1) {
    assert.ok(
      rankings.json.rankings[index - 1].score >= rankings.json.rankings[index].score,
      "rankings are not descending",
    );
  }
});

const movieIds = rankings.json.rankings.map((item) => item.id);
const reversedOrder = [...movieIds].reverse();
const reorder = await call("/api/rankings/order", {
  method: "POST",
  body: { kind: "movie", itemIds: reversedOrder },
  cookie: alpha.cookie,
});
const reordered = await call("/api/rankings?kind=movie", { cookie: alpha.cookie });
const partialOrder = await call("/api/rankings/order", {
  method: "POST",
  body: { kind: "movie", itemIds: reversedOrder.slice(0, 2) },
  cookie: alpha.cookie,
});
await check("manual drag order is stored as explicit events, not matchups", () => {
  assert.equal(reorder.status, 200, `reorder failed: ${reorder.text.slice(0, 160)}`);
  assert.deepEqual(reorder.json.order, reversedOrder);
  assert.ok(reorder.json.moved > 0);
  assert.equal(reordered.json.rankings[0].id, reversedOrder[0]);
  assert.equal(reordered.json.rankings.at(-1).id, reversedOrder.at(-1));
  assert.equal(partialOrder.status, 400, "a partial order should be rejected");
});

const modelAfterReorder = await call("/api/rankings/model?kind=movie", { cookie: alpha.cookie });
await check("reordering does not fabricate comparisons", () => {
  assert.equal(modelAfterReorder.json.comparisons, 0);
});

const rankingsPage = await call("/app/rankings?kind=movie", { cookie: alpha.cookie });
await check("rankings screen renders the reorder control for a saved order", () => {
  assert.equal(rankingsPage.status, 200);
  assert.match(rankingsPage.text, /Reorder/);
});

const [first, second] = sample;
const tieVote = await call(`/api/rankings/${first.id}/vote`, {
  method: "POST",
  body: { opponentId: second.id, result: "tie" },
  cookie: alpha.cookie,
});
await check("a tie vote is accepted", () => {
  assert.equal(tieVote.status, 200);
  assert.equal(tieVote.json.result, "tie");
});

const modelAfterVote = await call("/api/rankings/model?kind=movie", { cookie: alpha.cookie });
await check("model rebuilds from comparison history and records the tie", () => {
  assert.equal(modelAfterVote.status, 200);
  assert.equal(modelAfterVote.json.comparisons, 1);
  assert.equal(modelAfterVote.json.converged, true);
  assert.ok(modelAfterVote.json.items.some((item) => item.ties === 1));
});

const allRankings = await call("/app/rankings", { cookie: alpha.cookie });
await check("all rankings view uses the fitted model", () => {
  assert.equal(allRankings.status, 200);
  assert.match(allRankings.text, /Model order from \d+ comparisons across/);
});

const undo = await call(`/api/rankings/${first.id}/undo`, { method: "POST", cookie: alpha.cookie });
const modelAfterUndo = await call("/api/rankings/model?kind=movie", { cookie: alpha.cookie });
await check("undo removes the comparison and rebuilds the model", () => {
  assert.equal(undo.status, 200);
  assert.equal(undo.json.undone, true);
  assert.equal(modelAfterUndo.json.comparisons, 0);
});

const follow = await call("/api/follow", {
  method: "POST",
  body: { username: alpha.username, follow: true },
  cookie: beta.cookie,
});
await check("beta can follow alpha", () => {
  assert.equal(follow.status, 200);
  assert.equal(follow.json.following, true);
});

const reviewText = `E2E review ${stamp}: the ranking engine earned this score.`;
const review = await call(`/api/rankings/${first.id}/review`, {
  method: "POST",
  body: { text: reviewText, tags: ["e2e"] },
  cookie: alpha.cookie,
});
const homeFeed = await call("/app", { cookie: beta.cookie });
await check("home feed ranks followed reviews and explains why", () => {
  assert.equal(review.status, 200, `review save failed: ${review.text.slice(0, 160)}`);
  assert.equal(homeFeed.status, 200);
  assert.match(homeFeed.text, /E2E review/);
  assert.match(homeFeed.text, /From someone you follow/);
});

const alphaFirstRating = rankings.json.rankings.find((item) => item.id === first.id)?.ratingId;
const dismiss = await call("/api/feed/dismiss", {
  method: "POST",
  body: { ratingId: alphaFirstRating },
  cookie: beta.cookie,
});
const dismissedFeed = await call("/app", { cookie: beta.cookie });
await check("dismissing a recommendation hides it from the For-you feed", () => {
  assert.equal(dismiss.status, 200, `dismiss failed: ${dismiss.text.slice(0, 160)}`);
  // The flight payload also carries prefetched item pages, where the review
  // legitimately stays. Only the visible markup decides what the feed shows.
  const visible = dismissedFeed.text.replace(/<script[\s\S]*?<\/script>/gi, "");
  assert.ok(!visible.includes(reviewText), "the dismissed review is still in the feed");
});

const newerReviewText = `E2E newer ${stamp}: chronological check.`;
const secondReview = await call(`/api/rankings/${second.id}/review`, {
  method: "POST",
  body: { text: newerReviewText, tags: ["e2e"] },
  cookie: alpha.cookie,
});
const followingFeed = await call("/app?feed=following", { cookie: beta.cookie });
await check("following feed shows followed reviews newest-first", () => {
  assert.equal(secondReview.status, 200);
  assert.equal(followingFeed.status, 200);
  assert.match(followingFeed.text, /Following/);
  const newerAt = followingFeed.text.indexOf(newerReviewText);
  const olderAt = followingFeed.text.indexOf(reviewText);
  assert.ok(newerAt >= 0 && olderAt >= 0, "reviews missing from the following feed");
  assert.ok(newerAt < olderAt, "following feed is not newest-first");
});

const compare = await call(`/app/compare/${alpha.username}`, { cookie: beta.cookie });
await check("taste comparison renders with evidence and confidence", () => {
  assert.equal(compare.status, 200);
  const text = compare.text.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  assert.match(text, /\d+% match/);
  assert.match(text, /shared titles/);
  assert.match(text, /τ-b -?\d/);
  assert.match(text, /confidence/);
  assert.match(text, /Match by category/);
  assert.match(text, /Movies/);
  const percent = Number(text.match(/(\d+)% match/)?.[1] ?? "100");
  assert.ok(percent < 50, `opposite rankings scored ${percent}% — genre prior too strong`);
});

await check("session data survives a fresh login", async () => {
  const login = await call("/api/auth/login", {
    method: "POST",
    body: { email: alpha.email, password },
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  const after = await call("/api/rankings?kind=movie", { cookie: login.cookie });
  assert.equal(after.status, 200);
  assert.ok(after.json.rankings.some((item) => item.id === first.id));
});

const mediaExport = await call("/api/account/export", { cookie: alpha.cookie });
await check("media export covers ratings, reviews, matchups and ranking order", () => {
  assert.equal(mediaExport.status, 200, `export failed: ${mediaExport.text.slice(0, 160)}`);
  const data = JSON.parse(mediaExport.text);
  assert.ok(Array.isArray(data.ratings) && data.ratings.length >= 4);
  assert.ok(Array.isArray(data.reviews) && data.reviews.some((review) => review.text.includes("E2E review")));
  assert.ok(Array.isArray(data.matchups));
  assert.ok(data.rankingOrder.some((row) => row.kind === "movie"));
});

const formulaContact = await call("/api/contacts", {
  method: "POST",
  body: { name: "=cmd|' /C calc'!A0", company: "+1 (555) 010-0100" },
  cookie: alpha.cookie,
});
const contactsExport = await call("/api/contacts/export", { cookie: alpha.cookie });
await check("contact export neutralizes spreadsheet formulas but keeps phone numbers", () => {
  assert.equal(formulaContact.status, 201, `contact create failed: ${formulaContact.text.slice(0, 160)}`);
  assert.equal(contactsExport.status, 200, `export failed: ${contactsExport.text.slice(0, 160)}`);
  assert.match(contactsExport.headers.get("content-disposition") ?? "", /attachment/);
  assert.ok(contactsExport.text.includes("'=cmd|' /C calc'!A0"), "formula cell was not neutralized");
  assert.ok(contactsExport.text.includes("+1 (555) 010-0100"), "phone number was mangled");
});

let lastExport = null;
for (let attempt = 0; attempt < 5; attempt += 1) {
  lastExport = await call("/api/contacts/export", { cookie: alpha.cookie });
}
await check("a burst of contact exports is rate limited with a retry hint", () => {
  assert.equal(lastExport.status, 429);
  assert.equal(lastExport.json?.code, "RATE_LIMITED");
  assert.ok(Number(lastExport.headers.get("retry-after")) >= 1);
});

const reactionRatingId = reordered.json.rankings[0].ratingId;
let lastReaction = null;
for (let attempt = 0; attempt < 61; attempt += 1) {
  lastReaction = await call(`/api/ratings/${reactionRatingId}/react`, {
    method: "POST",
    body: { emoji: "🔥" },
    cookie: beta.cookie,
  });
}
await check("a burst of reactions is rate limited with a retry hint", () => {
  assert.equal(lastReaction.status, 429);
  assert.equal(lastReaction.json?.code, "RATE_LIMITED");
  assert.ok(Number(lastReaction.headers.get("retry-after")) >= 1);
});

let lastComment = null;
for (let attempt = 0; attempt < 21; attempt += 1) {
  lastComment = await call(`/api/ratings/${reactionRatingId}/comments`, {
    method: "POST",
    body: { body: `E2E comment burst ${attempt}` },
    cookie: beta.cookie,
  });
}
await check("a burst of comments is rate limited with a retry hint", () => {
  assert.equal(lastComment.status, 429);
  assert.equal(lastComment.json?.code, "RATE_LIMITED");
  assert.ok(Number(lastComment.headers.get("retry-after")) >= 1);
});

const commentPage = await call(`/api/ratings/${reactionRatingId}/comments?limit=5&offset=0`);
const commentPageTwo = await call(`/api/ratings/${reactionRatingId}/comments?limit=5&offset=5`);
await check("comments paginate with a total and non-overlapping pages", () => {
  assert.equal(commentPage.status, 200);
  assert.equal(commentPage.json.comments.length, 5);
  assert.ok(commentPage.json.total >= 20, `only ${commentPage.json.total} comments`);
  assert.equal(commentPageTwo.status, 200);
  assert.equal(commentPageTwo.json.comments.length, 5);
  const firstIds = new Set(commentPage.json.comments.map((item) => item.id));
  assert.ok(commentPageTwo.json.comments.every((item) => !firstIds.has(item.id)));
});

const badDelete = await call("/api/account/delete", {
  method: "POST",
  body: { password: "not-the-password", confirm: "DELETE" },
  cookie: beta.cookie,
});
const weakConfirm = await call("/api/account/delete", {
  method: "POST",
  body: { password, confirm: "delete" },
  cookie: beta.cookie,
});
await check("deletion requires the password and the typed confirmation", () => {
  assert.equal(badDelete.status, 400);
  assert.equal(weakConfirm.status, 400);
});

const deleted = await deleteAccount(beta.cookie);
const betaLoginAfter = await call("/api/auth/login", { method: "POST", body: { email: beta.email, password } });
const alphaLoginAfter = await call("/api/auth/login", { method: "POST", body: { email: alpha.email, password } });
await check("account deletion removes the user, workspace and media data", () => {
  assert.equal(deleted.status, 200, `delete failed: ${deleted.text.slice(0, 160)}`);
  assert.equal(betaLoginAfter.status, 401, "deleted account can still sign in");
  assert.equal(alphaLoginAfter.status, 200, "deleting one account removed another");
});

// Leave no test data behind to skew community rankings between runs.
const alphaDeleted = await deleteAccount(alpha.cookie);
await check("e2e cleans up its remaining test account", () => {
  assert.equal(alphaDeleted.status, 200, `alpha delete failed: ${alphaDeleted.text.slice(0, 160)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
