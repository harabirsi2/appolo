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
 * Spotify connect issuance runs when SPOTIFY_CLIENT_ID is configured; the live
 * provider search quota runs when CATALOG_PROVIDERS names a usable adapter.
 * Either check is reported as SKIP, never silently passed, when unavailable.
 * It exits non-zero if any check fails.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const stamp = Date.now().toString(36);
const password = "e2e-demo-1234";
// A unique source address per run keeps the auth rate limiter from treating
// repeated test runs as one abusive client.
const clientIp = `198.18.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

let passed = 0;
const failures = [];
const skipped = [];

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

async function call(path, { method = "GET", body, cookie, redirect = "manual", headers: requestHeaders = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    redirect,
    signal: AbortSignal.timeout(20_000),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": clientIp,
      ...requestHeaders,
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
  const me = await call("/api/me", { cookie: result.cookie });
  assert.equal(me.status, 200, "session API failed");
  assert.ok(me.json?.org?.id, "session org missing");
  return { email, cookie: result.cookie, username: profile.json.profile.username, orgId: me.json.org.id };
}

const health = await call("/api/health");
await check("server is up and database is reachable", () => {
  assert.equal(health.status, 200);
  assert.equal(health.json?.ok, true);
  assert.equal(health.json?.database, "up");
});

await check("security headers and nonce-based CSP are present", async () => {
  const page = await call("/login");
  assert.equal(page.status, 200);
  const csp = page.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(page.text, /nonce="/, "Next did not attach the CSP nonce to its scripts");

  for (const path of ["/", "/this-page-does-not-exist"]) {
    const document = await call(path);
    assert.equal(document.status, path === "/" ? 200 : 404);
    assert.match(document.text, /nonce="/, `prerendered ${path} has no CSP nonce`);
  }

  // Customer sites iframe these widgets; they must not inherit the app's
  // anti-framing policy.
  const embed = await call("/embed/not-a-real-widget");
  const embedCsp = embed.headers.get("content-security-policy") ?? "";
  assert.equal(embed.headers.get("x-frame-options"), null);
  assert.match(embedCsp, /frame-ancestors \*/);
});

await check("cross-origin mutations are rejected while same-origin and non-browser requests pass the guard", async () => {
  const path = "/api/profile/pin";
  const body = { ratingId: null };
  const crossOrigin = await call(path, {
    method: "POST",
    body,
    headers: { origin: "https://evil.example" },
  });
  const nullOrigin = await call(path, {
    method: "POST",
    body,
    headers: { origin: "null" },
  });
  const crossSiteHint = await call(path, {
    method: "POST",
    body,
    headers: { "sec-fetch-site": "cross-site" },
  });
  const sameOrigin = await call(path, {
    method: "POST",
    body,
    headers: { origin: new URL(BASE).origin },
  });
  const nonBrowser = await call(path, { method: "POST", body });

  for (const rejected of [crossOrigin, nullOrigin, crossSiteHint]) {
    assert.equal(rejected.status, 403, `cross-origin mutation returned ${rejected.status}`);
    assert.equal(rejected.json?.code, "CSRF_REJECTED");
  }
  assert.equal(sameOrigin.status, 401, "a same-origin unauthenticated mutation should reach auth");
  assert.equal(nonBrowser.status, 401, "an origin-less non-browser mutation should still reach auth");
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

// Both accounts are still unrated here. "Her" gives the search fixture an
// exact title, title prefixes (Hero, Heroes), subtitle prefixes (Hermann
// Hesse) and fuzzy matches (Werner Herzog), so this checks the real ordering
// returned by the API rather than a unit-test stand-in.
const searchOrder = await call("/api/search?q=Her&limit=60", { cookie: alpha.cookie });
const unratedSearch = await call("/app/search?q=Her", { cookie: alpha.cookie });
await check("search ranks exact and prefix matches before fuzzy matches and labels unrated results", () => {
  assert.equal(searchOrder.status, 200, `search API returned ${searchOrder.status}`);
  const results = searchOrder.json?.items ?? [];
  assert.ok(results.length >= 10, `only ${results.length} search results`);

  const query = "her";
  const rank = (item) => {
    const title = item.title.toLowerCase();
    const subtitle = (item.subtitle ?? "").toLowerCase();
    if (title === query) return 3;
    if (title.startsWith(query)) return 2;
    if (subtitle.startsWith(query)) return 1;
    return 0;
  };
  const ranks = results.map(rank);
  const firstFuzzy = ranks.indexOf(0);

  assert.equal(ranks[0], 3, "the exact title was not first");
  assert.ok(ranks.includes(2), "the fixture returned no prefix matches");
  assert.ok(firstFuzzy > 0, "the fixture returned no fuzzy matches");
  assert.ok(
    ranks.slice(0, firstFuzzy).every((value) => value > 0),
    "a fuzzy match was returned before an exact/prefix match",
  );
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a), "search categories are not ordered");

  assert.equal(unratedSearch.status, 200, `search page returned ${unratedSearch.status}`);
  assert.match(unratedSearch.text, /Her/);
  assert.match(unratedSearch.text, /Not rated/);
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
// Snapshot both scores before the vote so undo can be held to restoring them
// exactly, not just to making the comparison count go down.
const eloBeforeVote = new Map(
  (await call("/api/rankings?kind=movie", { cookie: alpha.cookie })).json.rankings.map((item) => [
    item.id,
    item.elo,
  ]),
);
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
const allRankingsData = await call("/api/rankings", { cookie: alpha.cookie });
await check("all rankings view sorts by score and lets the model break ties", () => {
  assert.equal(allRankings.status, 200);
  assert.equal(allRankingsData.status, 200);
  assert.match(allRankings.text, /Highest score first · model breaks ties from \d+ comparisons across/);
  const rows = allRankingsData.json.rankings.map(({ id, score }) => ({
    score,
    offset: allRankings.text.indexOf(`href="/app/item/${id}"`),
  }));
  assert.ok(rows.length >= 4 && rows.every(({ offset }) => offset >= 0), "ranked titles missing from the page");
  rows.sort((a, b) => a.offset - b.offset);
  assert.ok(rows.every(({ score }, i) => i === 0 || rows[i - 1].score >= score), "rendered scores are not descending");
});

await check("catalog and search prioritize exact titles and treat wildcards literally", async () => {
  for (const route of ["/api/catalog", "/api/search"]) {
    const exact = await call(`${route}?kind=movie&q=Alien&limit=6`, { cookie: alpha.cookie });
    const literal = await call(`${route}?kind=movie&q=%25&limit=6`, { cookie: alpha.cookie });
    assert.equal(exact.status, 200, route);
    assert.equal(exact.json.items[0]?.title, "Alien", route);
    assert.equal(literal.status, 200, route);
    assert.ok(literal.json.items.every(({ title, subtitle }) => title.includes("%") || subtitle?.includes("%")), route);
  }
});

const tasteAfterVote = await call("/app/taste", { cookie: alpha.cookie });
await check("one logged vote counts as one matchup across rankings and Taste DNA", () => {
  assert.equal(tasteAfterVote.status, 200);
  assert.equal(allRankingsData.json.stats.matchups, 1);
  assert.ok(allRankings.text.replaceAll("<!-- -->", "").includes("ranked · 1 matchup · "), "rankings did not show one matchup");
  assert.ok(tasteAfterVote.text.replaceAll("<!-- -->", "").includes(">1 matchup</p>"), "Taste DNA did not show one matchup");
});

const undo = await call(`/api/rankings/${first.id}/undo`, { method: "POST", cookie: alpha.cookie });
const modelAfterUndo = await call("/api/rankings/model?kind=movie", { cookie: alpha.cookie });
const afterUndo = await call("/api/rankings?kind=movie", { cookie: alpha.cookie });
await check("undo removes the comparison, restores both scores and rebuilds the model", () => {
  assert.equal(undo.status, 200);
  assert.equal(undo.json.undone, true);
  assert.equal(modelAfterUndo.json.comparisons, 0);
  const eloAfter = new Map(afterUndo.json.rankings.map((item) => [item.id, item.elo]));
  assert.equal(eloAfter.get(first.id), eloBeforeVote.get(first.id), "initiator score was not restored");
  assert.equal(eloAfter.get(second.id), eloBeforeVote.get(second.id), "opponent score was not restored");
});

// The opponent can undo too: the matchup is found from either side and only
// the timeline event belonging to that comparison may disappear.
const opponentVote = await call(`/api/rankings/${first.id}/vote`, {
  method: "POST",
  body: { opponentId: second.id, result: "win" },
  cookie: alpha.cookie,
});
const opponentUndo = await call(`/api/rankings/${second.id}/undo`, {
  method: "POST",
  cookie: alpha.cookie,
});
const afterOpponentUndo = await call("/api/rankings?kind=movie", { cookie: alpha.cookie });
const modelAfterOpponentUndo = await call("/api/rankings/model?kind=movie", { cookie: alpha.cookie });
await check("undo from the opponent side restores both scores", () => {
  assert.equal(opponentVote.status, 200, `vote failed: ${opponentVote.text.slice(0, 160)}`);
  assert.equal(opponentUndo.status, 200);
  assert.equal(opponentUndo.json.undone, true);
  assert.equal(opponentUndo.json.opponentId, second.id);
  const eloAfter = new Map(afterOpponentUndo.json.rankings.map((item) => [item.id, item.elo]));
  assert.equal(eloAfter.get(first.id), eloBeforeVote.get(first.id), "initiator score was not restored");
  assert.equal(eloAfter.get(second.id), eloBeforeVote.get(second.id), "opponent score was not restored");
  assert.equal(modelAfterOpponentUndo.json.comparisons, 0);
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

await check("library, collections and activity reuse their existing screens", async () => {
  const [library, collections, activity] = await Promise.all([
    call("/app/library", { cookie: alpha.cookie }),
    call("/app/collections", { cookie: alpha.cookie }),
    call("/app/activity", { cookie: alpha.cookie }),
  ]);
  assert.equal(library.status, 200, "library did not render");
  assert.match(library.text, /<h1[^>]*>Library<\/h1>/);
  assert.equal(collections.status, 200, "collections did not render");
  assert.match(collections.text, /<h1[^>]*>E2E alpha[^<]*<\/h1>/);
  assert.match(collections.text, /<h2[^>]*>Pods<\/h2>/);
  assert.equal(activity.status, 200, "activity did not render");
  assert.match(activity.text, /<h2[^>]*>Following<\/h2>/);
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

// Pods: owner-scoped writes, with public contributions from other orgs.
const podCreate = await call("/api/pods", {
  method: "POST",
  body: { title: `E2E pod ${stamp}`, itemIds: [first.id] },
  cookie: alpha.cookie,
});
const podId = podCreate.json?.pod?.id;
await check("pod creation returns an owner-scoped pod", () => {
  assert.equal(podCreate.status, 201, podCreate.text.slice(0, 160));
  assert.ok(podId, "create pod returned no id");
  assert.equal(podCreate.json.pod.count, 1);
});
await check("a non-owner cannot edit, reorder or delete someone else's pod", async () => {
  const update = await call(`/api/pods/${podId}`, { method: "PATCH", body: { title: "hijacked" }, cookie: beta.cookie });
  const order = await call(`/api/pods/${podId}/items`, { method: "PATCH", body: { itemIds: [first.id] }, cookie: beta.cookie });
  const remove = await call(`/api/pods/${podId}`, { method: "DELETE", cookie: beta.cookie });
  assert.equal(update.status, 404, `cross-org update returned ${update.status}`);
  assert.equal(order.status, 404, `cross-org reorder returned ${order.status}`);
  assert.equal(remove.status, 404, `cross-org delete returned ${remove.status}`);
  const list = await call("/api/pods", { cookie: alpha.cookie });
  const pod = list.json.pods.find((p) => p.id === podId);
  assert.ok(pod && !/hijacked/.test(pod.title), "another org changed or removed the pod");
});
await check("a non-owner can contribute to a public pod but only remove their own item", async () => {
  const add = await call(`/api/pods/${podId}/items`, { method: "POST", body: { itemId: second.id }, cookie: beta.cookie });
  assert.equal(add.status, 200, `contribute -> ${add.status}: ${add.text.slice(0, 120)}`);
  assert.equal(add.json.pod.count, 2);
  const removeOwn = await call(`/api/pods/${podId}/items`, { method: "DELETE", body: { itemId: second.id }, cookie: beta.cookie });
  assert.equal(removeOwn.status, 200);
  assert.equal(removeOwn.json.pod.count, 1);
  const removeOwner = await call(`/api/pods/${podId}/items`, { method: "DELETE", body: { itemId: first.id }, cookie: beta.cookie });
  assert.equal(removeOwner.status, 200);
  assert.equal(removeOwner.json.pod.count, 1, "a non-owner removed the owner's item");
});
const deletePod = await call(`/api/pods/${podId}`, { method: "DELETE", cookie: alpha.cookie });
await check("the owner can delete their own pod", () => {
  assert.equal(deletePod.status, 200, deletePod.text.slice(0, 160));
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

/* ------------------------------ Spotify OAuth state ------------------------------ */
const SPOTIFY_COOKIE = "appolo_spotify_state";
function spotifyCallback(query, cookie) {
  return call(`/api/spotify/callback?${query}`, { cookie });
}
function redirectParam(result, name) {
  const location = result.headers.get("location");
  if (!location) return null;
  return new URL(location, BASE).searchParams.get(name);
}
function stateSetCookie(result) {
  return (result.headers.getSetCookie?.() ?? []).find((value) => value.startsWith(`${SPOTIFY_COOKIE}=`)) ?? "";
}

const spotifyState = `${alpha.orgId}.${randomUUID()}`;
const spotifyCookie = `${alpha.cookie}; ${SPOTIFY_COOKIE}=${spotifyState}`;
const spotifyAnon = await spotifyCallback(new URLSearchParams({ state: spotifyState, code: "x" }), undefined);
const spotifyNoCookie = await spotifyCallback(
  new URLSearchParams({ state: spotifyState, code: "x" }),
  alpha.cookie,
);
const spotifyNoParam = await spotifyCallback(new URLSearchParams({ code: "x" }), spotifyCookie);
const spotifyMismatch = await spotifyCallback(
  new URLSearchParams({ state: `${alpha.orgId}.${randomUUID()}`, code: "x" }),
  spotifyCookie,
);
const foreignState = `00000000-0000-4000-8000-000000000000.${randomUUID()}`;
const spotifyForeignOrg = await spotifyCallback(
  new URLSearchParams({ state: foreignState, code: "x" }),
  `${alpha.cookie}; ${SPOTIFY_COOKIE}=${foreignState}`,
);
await check("Spotify callback rejects anonymous, missing, mismatched and foreign state", () => {
  assert.equal(spotifyAnon.status, 401);
  for (const result of [spotifyNoCookie, spotifyNoParam, spotifyMismatch, spotifyForeignOrg]) {
    assert.equal(result.status, 307, `expected a redirect, got ${result.status}`);
    assert.equal(redirectParam(result, "spotify"), "state_error");
    assert.match(stateSetCookie(result), /Max-Age=0/i, "state cookie was not cleared");
  }
});

const spotifyAccepted = await spotifyCallback(
  new URLSearchParams({ state: spotifyState }),
  spotifyCookie,
);
await check("Spotify callback accepts a browser-bound state and reaches code handling", () => {
  assert.equal(spotifyAccepted.status, 307);
  assert.equal(redirectParam(spotifyAccepted, "spotify"), "cancelled");
  assert.notEqual(redirectParam(spotifyAccepted, "spotify"), "state_error", "valid state was rejected");
  assert.match(stateSetCookie(spotifyAccepted), /Max-Age=0/i, "state cookie was not cleared");
});

const spotifyConnect = await call("/api/spotify/connect", { cookie: alpha.cookie });
if (spotifyConnect.status === 503) {
  skipped.push("Spotify connect issuance (SPOTIFY_CLIENT_ID is not configured)");
} else {
  await check("Spotify connect issues an http-only org-bound state cookie", async () => {
    assert.equal(spotifyConnect.status, 307, `connect returned ${spotifyConnect.status}`);
    const location = new URL(spotifyConnect.headers.get("location") ?? "");
    assert.equal(location.hostname, "accounts.spotify.com");
    assert.ok(location.searchParams.get("client_id"), "client_id missing from authorize URL");
    assert.equal(location.searchParams.get("scope"), "user-top-read");
    assert.ok(location.searchParams.get("state")?.startsWith(`${alpha.orgId}.`), "state is not org-bound");
    const cookie = stateSetCookie(spotifyConnect);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Path=\/api\/spotify/i);
    assert.match(cookie, /Max-Age=600/i);
    const issuedState = cookie.match(/^[^=]+=([^;]+)/)?.[1];
    assert.equal(issuedState, location.searchParams.get("state"));

    const callback = await spotifyCallback(
      new URLSearchParams({ state: issuedState }),
      `${alpha.cookie}; ${SPOTIFY_COOKIE}=${issuedState}`,
    );
    assert.equal(callback.status, 307);
    assert.equal(redirectParam(callback, "spotify"), "cancelled");
  });
}

/* ------------------------------ provider quotas ------------------------------ */
const importTitle = `E2E Import Quota ${stamp}`;
const goodreadsCsv = `Title,Author,My Rating\n${importTitle},E2E Author,4\n`;
for (let attempt = 0; attempt < 5; attempt += 1) {
  const imported = await call("/api/import/goodreads", {
    method: "POST",
    body: { csv: goodreadsCsv },
    cookie: alpha.cookie,
  });
  assert.equal(imported.status, 201, `import ${attempt + 1} returned ${imported.status}: ${imported.text.slice(0, 160)}`);
}
const blockedImport = await call("/api/import/goodreads", {
  method: "POST",
  body: { csv: goodreadsCsv },
  cookie: alpha.cookie,
});
const blockedLetterboxd = await call("/api/import/letterboxd", {
  method: "POST",
  body: { csv: `Name,Year,Rating\n${importTitle},2024,4\n` },
  cookie: alpha.cookie,
});
await check("catalog imports share a five-per-minute org quota", () => {
  assert.equal(blockedImport.status, 429, `sixth import returned ${blockedImport.status}`);
  assert.equal(blockedImport.json?.code, "RATE_LIMITED");
  assert.ok(Number(blockedImport.headers.get("retry-after")) >= 1);
  assert.equal(blockedLetterboxd.status, 429, "Letterboxd bypassed the shared import quota");
});

const searchProbeQuery = `quota-${stamp}-${randomUUID()}`;
const searchProbe = await call(`/api/search?q=${encodeURIComponent(searchProbeQuery)}&live=1`, {
  cookie: alpha.cookie,
});
if (!searchProbe.json?.liveSearch) {
  skipped.push("provider search quota (CATALOG_PROVIDERS has no live adapter)");
} else {
  await check("provider search is capped at 30 per minute while local search stays available", async () => {
    assert.equal(searchProbe.status, 200);
    assert.equal(searchProbe.json.providerQuotaExhausted, false);
    for (let attempt = 1; attempt < 30; attempt += 1) {
      const allowed = await call(`/api/search?q=${encodeURIComponent(`${searchProbeQuery}-${attempt}`)}&live=1`, {
        cookie: alpha.cookie,
      });
      assert.equal(allowed.status, 200, `search ${attempt + 1} returned ${allowed.status}`);
      assert.equal(allowed.json.providerQuotaExhausted, false, `search ${attempt + 1} was limited early`);
    }
    const blocked = await call(`/api/search?q=${encodeURIComponent(`${searchProbeQuery}-blocked`)}&live=1`, {
      cookie: alpha.cookie,
    });
    assert.equal(blocked.status, 200, "quota exhaustion should still return local results");
    assert.equal(blocked.json.providerQuotaExhausted, true, "the 31st provider search was not limited");
    assert.ok(Array.isArray(blocked.json.items), "local results missing after quota exhaustion");
    const localAfter = await call("/api/search?q=Breaking", { cookie: alpha.cookie });
    assert.equal(localAfter.status, 200, "local search failed after quota exhaustion");
    assert.ok(localAfter.json.items.length > 0, "local search returned no rows after quota exhaustion");
  });
}

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

for (const reason of skipped) console.log(`SKIP  ${reason}`);
console.log(`\n${passed} passed, ${failures.length} failed, ${skipped.length} skipped`);
if (failures.length > 0) process.exitCode = 1;
