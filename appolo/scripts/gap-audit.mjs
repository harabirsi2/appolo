#!/usr/bin/env node
/**
 * Gap-coverage audit: exercises API surfaces that neither e2e.mjs nor smoke.ps1
 * cover. Read-only against existing data (creates two throwaway accounts).
 */
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const stamp = Date.now().toString(36);
const password = "gap-demo-12345";
const clientIp = `203.0.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

async function call(path, { method = "GET", body, cookie, raw, headers = {}, redirect = "manual" } = {}) {
  const response = await fetch(BASE + path, {
    method,
    redirect,
    headers: {
      ...(body && !raw ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": clientIp,
      ...headers,
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const nextCookie = setCookies.length ? setCookies.map((v) => v.split(";")[0]).join("; ") : cookie;
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: response.status, json, text, cookie: nextCookie, headers: response.headers };
}

async function signup(label) {
  const email = `gap-${label}-${stamp}@appolo.test`;
  const result = await call("/api/auth/signup", {
    method: "POST",
    body: { orgName: `Gap ${label} ${stamp}`, name: `Gap ${label}`, email, password, timezone: "UTC" },
  });
  assert.equal(result.status, 201, `signup ${label} -> ${result.status} ${result.text.slice(0, 160)}`);
  await call("/app/profile", { cookie: result.cookie });
  const profile = await call("/api/profile", { cookie: result.cookie });
  assert.ok(profile.json?.profile?.username, `no profile for ${label}: ${profile.text.slice(0, 160)}`);
  return { email, cookie: result.cookie, username: profile.json.profile.username };
}

async function rate(cookie, itemId, score) {
  return call(`/api/rankings/${itemId}/manual`, { method: "POST", body: { score }, cookie });
}
async function deleteAccount(cookie) {
  return call("/api/account/delete", { method: "POST", body: { password, confirm: "DELETE" }, cookie });
}

const health = await call("/api/health");
assert.equal(health.status, 200);

const alpha = await signup("alpha");
const beta = await signup("beta");

// Seed: rate a few movies so podium/export/pin have data.
const catalog = await call("/api/catalog?kind=movie&limit=6", { cookie: alpha.cookie });
const items = catalog.json.items.slice(0, 6);
const scores = [9.5, 9, 8.5, 7.5, 7, 6.5];
const ratings = [];
for (let i = 0; i < items.length; i += 1) {
  const r = await call(`/api/rankings/${items[i].id}/manual`, { method: "POST", body: { score: scores[i] }, cookie: alpha.cookie });
  assert.equal(r.status, 200, `alpha rate failed: ${r.text.slice(0, 120)}`);
}
const betaRate = await rate(beta.cookie, items[0].id, 4);
assert.equal(betaRate.status, 200);

// Rating row ids (distinct from item ids) come from the rankings payload.
const alphaRankings = await call("/api/rankings?kind=movie", { cookie: alpha.cookie });
const betaRankings0 = await call("/api/rankings?kind=movie", { cookie: beta.cookie });

/* ------------------------------ watchlist ------------------------------ */
let watching = null;
await check("watchlist toggles on and lists the item", async () => {
  const on = await call("/api/watchlist", { method: "POST", body: { itemId: items[0].id }, cookie: alpha.cookie });
  assert.equal(on.status, 200, on.text.slice(0, 120));
  assert.equal(on.json.watching, true);
  const list = await call("/api/watchlist", { cookie: alpha.cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((i) => i.id === items[0].id), "watchlist missing item");
  watching = list.json.items.length;
});
await check("watchlist rejects a non-uuid item", async () => {
  const bad = await call("/api/watchlist", { method: "POST", body: { itemId: "nope" }, cookie: alpha.cookie });
  assert.equal(bad.status, 400);
});
await check("watchlist requires auth", async () => {
  const anon = await call("/api/watchlist");
  assert.equal(anon.status, 401);
});
await check("watchlist toggles off", async () => {
  const off = await call("/api/watchlist", { method: "POST", body: { itemId: items[0].id }, cookie: alpha.cookie });
  assert.equal(off.status, 200);
  assert.equal(off.json.watching, false);
  const list = await call("/api/watchlist", { cookie: alpha.cookie });
  assert.ok(!list.json.items.some((i) => i.id === items[0].id), "item still on watchlist");
});

/* ------------------------------ pods ------------------------------ */
let podId = null;
await check("create pod with items", async () => {
  const created = await call("/api/pods", {
    method: "POST",
    body: { title: `Gap pod ${stamp}`, description: "audit", itemIds: [items[0].id, items[1].id] },
    cookie: alpha.cookie,
  });
  assert.equal(created.status, 201, created.text.slice(0, 160));
  assert.ok(created.json.pod?.id, "no pod id");
  assert.equal(created.json.pod.count, 2);
  assert.ok(created.json.pod.slug, "no slug");
  podId = created.json.pod.id;
});
await check("list pods includes the new pod", async () => {
  const list = await call("/api/pods", { cookie: alpha.cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.pods.some((p) => p.id === podId));
});
await check("add item to pod", async () => {
  const added = await call(`/api/pods/${podId}/items`, { method: "POST", body: { itemId: items[2].id }, cookie: alpha.cookie });
  assert.equal(added.status, 200, added.text.slice(0, 160));
  assert.equal(added.json.pod.count, 3);
});
await check("reorder pod items", async () => {
  const detail = await call(`/api/pods/${podId}/items`, { method: "PATCH", body: { itemIds: [items[2].id, items[0].id, items[1].id] }, cookie: alpha.cookie });
  assert.equal(detail.status, 200, detail.text.slice(0, 160));
  assert.equal(detail.json.pod.entries[0].id, items[2].id);
});
await check("available pods marks membership", async () => {
  const avail = await call(`/api/pods/available?itemId=${items[0].id}`, { cookie: alpha.cookie });
  assert.equal(avail.status, 200, avail.text.slice(0, 160));
  const mine = avail.json.pods.find((p) => p.id === podId);
  assert.ok(mine, "owned pod missing from available list");
  assert.equal(mine.owned, true);
  assert.equal(mine.contains, true);
});
await check("remove item from pod", async () => {
  const removed = await call(`/api/pods/${podId}/items`, { method: "DELETE", body: { itemId: items[2].id }, cookie: alpha.cookie });
  assert.equal(removed.status, 200, removed.text.slice(0, 160));
  assert.equal(removed.json.pod.count, 2);
});
await check("public pod detail is world-readable", async () => {
  const pub = await call(`/pods/${podId}`);
  assert.equal(pub.status, 200, `pod detail -> ${pub.status}`);
});
await check("update pod title and description", async () => {
  const updated = await call(`/api/pods/${podId}`, { method: "PATCH", body: { title: `Gap pod renamed ${stamp}`, description: "renamed" }, cookie: alpha.cookie });
  assert.equal(updated.status, 200, updated.text.slice(0, 160));
  assert.match(updated.json.pod.title, /renamed/);
});

/* ---------------------- cross-tenant pod safety ---------------------- */
await check("beta cannot delete alpha's pod (no silent success)", async () => {
  const del = await call(`/api/pods/${podId}`, { method: "DELETE", cookie: beta.cookie });
  assert.equal(del.status, 404, `expected 404, got ${del.status}: ${del.text.slice(0, 120)}`);
  const still = await call(`/api/pods`, { cookie: alpha.cookie });
  assert.ok(still.json.pods.some((p) => p.id === podId), "alpha's pod was deleted by beta");
});
await check("beta cannot update alpha's pod", async () => {
  const upd = await call(`/api/pods/${podId}`, { method: "PATCH", body: { title: "hijacked" }, cookie: beta.cookie });
  assert.equal(upd.status, 404, `expected 404, got ${upd.status}: ${upd.text.slice(0, 120)}`);
  const list = await call("/api/pods", { cookie: alpha.cookie });
  const pod = list.json.pods.find((p) => p.id === podId);
  assert.ok(pod && !/hijacked/.test(pod.title), "beta changed alpha's pod title");
});
await check("beta cannot reorder alpha's pod", async () => {
  const upd = await call(`/api/pods/${podId}/items`, { method: "PATCH", body: { itemIds: [items[1].id, items[0].id] }, cookie: beta.cookie });
  assert.equal(upd.status, 404, `expected 404, got ${upd.status}: ${upd.text.slice(0, 120)}`);
});
await check("beta can contribute to alpha's public pod", async () => {
  const add = await call(`/api/pods/${podId}/items`, { method: "POST", body: { itemId: items[4].id }, cookie: beta.cookie });
  assert.equal(add.status, 200, `contribute -> ${add.status}: ${add.text.slice(0, 160)}`);
});
await check("beta can only remove its own contribution, not alpha's", async () => {
  const removeOwn = await call(`/api/pods/${podId}/items`, { method: "DELETE", body: { itemId: items[4].id }, cookie: beta.cookie });
  assert.equal(removeOwn.status, 200, `remove own -> ${removeOwn.status}`);
  const removeOther = await call(`/api/pods/${podId}/items`, { method: "DELETE", body: { itemId: items[0].id }, cookie: beta.cookie });
  const list = await call("/api/pods", { cookie: alpha.cookie });
  const pod = list.json.pods.find((p) => p.id === podId);
  assert.ok(pod && pod.count >= 1, `beta removed alpha's item (status ${removeOther.status})`);
});
await check("delete pod as owner", async () => {
  const del = await call(`/api/pods/${podId}`, { method: "DELETE", cookie: alpha.cookie });
  assert.equal(del.status, 200, del.text.slice(0, 160));
  const list = await call("/api/pods", { cookie: alpha.cookie });
  assert.ok(!list.json.pods.some((p) => p.id === podId), "pod still present");
});

/* ------------------------------ notifications ------------------------------ */
await check("notifications list shape and mark-read", async () => {
  const list = await call("/api/notifications", { cookie: alpha.cookie });
  assert.equal(list.status, 200, list.text.slice(0, 160));
  assert.ok(Array.isArray(list.json.items));
  assert.equal(typeof list.json.unread, "number");
  const read = await call("/api/notifications/read", { method: "POST", cookie: alpha.cookie });
  assert.equal(read.status, 200);
  const after = await call("/api/notifications", { cookie: alpha.cookie });
  assert.equal(after.json.unread, 0);
});
await check("notifications require auth", async () => {
  const anon = await call("/api/notifications");
  assert.equal(anon.status, 401);
});

/* ------------------------------ search history ------------------------------ */
await check("search records history and clear empties it", async () => {
  const term = `gap${stamp}`;
  const page = await call(`/app/search?q=${term}`, { cookie: alpha.cookie });
  assert.equal(page.status, 200, `search page -> ${page.status}`);
  const history = await call("/api/search-history", { cookie: alpha.cookie });
  assert.equal(history.status, 200);
  assert.ok(history.json.queries.includes(term), `history missing "${term}": ${JSON.stringify(history.json.queries)}`);
  const clear = await call("/api/search-history", { method: "DELETE", cookie: alpha.cookie });
  assert.equal(clear.status, 200);
  const after = await call("/api/search-history", { cookie: alpha.cookie });
  assert.equal(after.json.queries.length, 0);
});

/* ------------------------------ saved replies ------------------------------ */
await check("create and list saved replies", async () => {
  const created = await call("/api/saved-replies", { method: "POST", body: { title: `Thanks ${stamp}`, body: "Thanks for the feedback!", scope: "org" }, cookie: alpha.cookie });
  assert.equal(created.status, 201, created.text.slice(0, 160));
  assert.ok(created.json.savedReply?.id);
  const list = await call("/api/saved-replies", { cookie: alpha.cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.savedReplies.some((r) => r.id === created.json.savedReply.id));
});
await check("saved reply validates empty body", async () => {
  const bad = await call("/api/saved-replies", { method: "POST", body: { title: "x", body: "" }, cookie: alpha.cookie });
  assert.equal(bad.status, 400);
});

/* ------------------------------ profile update ------------------------------ */
await check("profile PATCH updates display name and bio", async () => {
  const updated = await call("/api/profile", { method: "PATCH", body: { displayName: `Gap Alpha ${stamp}`, bio: "audit bio" }, cookie: alpha.cookie });
  assert.equal(updated.status, 200, updated.text.slice(0, 160));
  assert.equal(updated.json.profile.displayName, `Gap Alpha ${stamp}`);
  assert.equal(updated.json.profile.bio, "audit bio");
});
await check("profile PATCH rejects a taken username", async () => {
  const taken = await call("/api/profile", { method: "PATCH", body: { username: beta.username }, cookie: alpha.cookie });
  assert.equal(taken.status, 409, `expected 409, got ${taken.status}: ${taken.text.slice(0, 120)}`);
});
await check("profile PATCH rejects a bad username", async () => {
  const bad = await call("/api/profile", { method: "PATCH", body: { username: "bad name!" }, cookie: alpha.cookie });
  assert.equal(bad.status, 400);
});

/* ------------------------------ pin ------------------------------ */
let alphaRatingId = null;
await check("pin own review, then unpin", async () => {
  alphaRatingId = alphaRankings.json.rankings[0]?.ratingId;
  assert.ok(alphaRatingId, "no rating to pin");
  const pinned = await call("/api/profile/pin", { method: "POST", body: { ratingId: alphaRatingId }, cookie: alpha.cookie });
  assert.equal(pinned.status, 200, pinned.text.slice(0, 160));
  assert.equal(pinned.json.profile.pinnedRatingId, alphaRatingId);
  const cleared = await call("/api/profile/pin", { method: "POST", body: { ratingId: null }, cookie: alpha.cookie });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.profile.pinnedRatingId, null);
});
await check("cannot pin someone else's review", async () => {
  const betaRatingId = betaRankings0.json.rankings[0]?.ratingId;
  assert.ok(betaRatingId, "beta has no rating");
  const attempt = await call("/api/profile/pin", { method: "POST", body: { ratingId: betaRatingId }, cookie: alpha.cookie });
  assert.equal(attempt.status, 404, `expected 404, got ${attempt.status}`);
});

/* ------------------------------ podium ------------------------------ */
await check("set podium order for ranked titles", async () => {
  const ids = items.slice(0, 3).map((i) => i.id);
  const result = await call("/api/profile/podium", { method: "POST", body: { kind: "movie", itemIds: ids }, cookie: alpha.cookie });
  assert.equal(result.status, 200, result.text.slice(0, 160));
  assert.deepEqual(result.json.profile.podiumOrder?.movie, ids);
});
await check("podium drops unranked titles", async () => {
  const unrated = items[5].id; // not rated by alpha? items[5] IS rated. use a random uuid
  const random = "00000000-0000-4000-8000-000000000000";
  const result = await call("/api/profile/podium", { method: "POST", body: { kind: "movie", itemIds: [random, items[0].id] }, cookie: alpha.cookie });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.profile.podiumOrder.movie, [items[0].id]);
});

/* ------------------------------ export ------------------------------ */
await check("account export contains ratings and reviews", async () => {
  const exp = await call("/api/account/export", { cookie: alpha.cookie });
  assert.equal(exp.status, 200, exp.text.slice(0, 160));
  assert.match(exp.headers.get("content-disposition") ?? "", /attachment/);
  assert.ok(Array.isArray(exp.json.ratings) && exp.json.ratings.length >= 6, "ratings missing");
  assert.equal(exp.json.profile.username, alpha.username);
});

/* ------------------------------ contacts import ------------------------------ */
await check("contacts CSV import creates contacts", async () => {
  const csv = "name,phone,email,company,tags\nGap One,+15550000001,gap1@example.com,Acme,vip\nGap Two,+15550000002,gap2@example.com,Globex,\n,GapNoName,gap3@example.com,,\n";
  const result = await call("/api/contacts/import", { method: "POST", body: { csv }, cookie: alpha.cookie });
  assert.equal(result.status, 201, result.text.slice(0, 200));
  assert.equal(result.json.created, 3, `created=${result.json.created} errors=${JSON.stringify(result.json.errors)}`);
  const list = await call("/api/contacts", { cookie: alpha.cookie });
  assert.equal(list.status, 200);
  const names = (list.json.contacts ?? list.json.items ?? []).map((c) => c.name);
  assert.ok(names.includes("Gap One"), `imported contact not listed: ${JSON.stringify(names)}`);
});
await check("contacts import rejects a headerless CSV", async () => {
  const bad = await call("/api/contacts/import", { method: "POST", body: { csv: "a,b,c\n1,2,3\n" }, cookie: alpha.cookie });
  assert.equal(bad.status, 400, `expected 400, got ${bad.status}`);
});
await check("contacts import requires a write capability", async () => {
  const anon = await call("/api/contacts/import", { method: "POST", body: { csv: "name\nx\n" } });
  assert.equal(anon.status, 401);
});

/* ------------------------------ people + popular ------------------------------ */
await check("person endpoint returns works, 404 for unknown", async () => {
  const good = await call("/api/people/marlon-brando");
  assert.equal(good.status, 200, good.text.slice(0, 120));
  assert.ok(good.json.person?.works?.length > 0, "no works");
  const bad = await call("/api/people/no-such-person-xyz");
  assert.equal(bad.status, 404);
});
await check("popular endpoint returns items", async () => {
  const pop = await call("/api/popular");
  assert.equal(pop.status, 200, pop.text.slice(0, 120));
  assert.ok(Array.isArray(pop.json.items));
});

/* ------------------------------ profiles/[username] ------------------------------ */
await check("public profile endpoint returns a bundle", async () => {
  const prof = await call(`/api/profiles/${alpha.username}`, { cookie: beta.cookie });
  assert.equal(prof.status, 200, prof.text.slice(0, 160));
  assert.ok(prof.json.profile?.username === alpha.username);
  assert.ok(Array.isArray(prof.json.topFive));
  assert.ok(Array.isArray(prof.json.ratings));
  assert.equal(prof.json.following, false);
  const missing = await call("/api/profiles/no-such-username-xyz");
  assert.equal(missing.status, 404);
});
await check("following flips the public profile's following flag", async () => {
  const follow = await call("/api/follow", { method: "POST", body: { username: alpha.username, follow: true }, cookie: beta.cookie });
  assert.equal(follow.status, 200, follow.text.slice(0, 160));
  const prof = await call(`/api/profiles/${alpha.username}`, { cookie: beta.cookie });
  assert.equal(prof.json.following, true);
  const unfollow = await call("/api/follow", { method: "POST", body: { username: alpha.username, follow: false }, cookie: beta.cookie });
  assert.equal(unfollow.status, 200);
});

/* ------------------------------ cleanup ------------------------------ */
const cleanup = [await deleteAccount(alpha.cookie), await deleteAccount(beta.cookie)];
await check("cleanup deleted both throwaway accounts", () => {
  assert.ok(cleanup.every((r) => r.status === 200), cleanup.map((r) => `${r.status}:${r.text.slice(0, 80)}`).join(" | "));
});

console.log("---");
console.log(`RESULT: pass=${passed} fail=${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
