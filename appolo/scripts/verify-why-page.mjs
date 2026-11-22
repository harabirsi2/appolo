/**
 * Smoke-check the "Why is this #1?" drill-down against a running server.
 *
 *   node scripts/verify-why-page.mjs
 *
 * Signs up a throwaway account, votes five times on movies, then reads the
 * item page and the /why page and checks the explanation and the confidence
 * badge are actually rendered. Deletes the account afterwards.
 */
const BASE = process.env.APP_BASE ?? "http://127.0.0.1:3000";
const stamp = Date.now().toString(36);
const password = "why-check-1234";
const email = `why-${stamp}@appolo.test`;

const signup = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ orgName: `WHY ${stamp}`, name: "WHY", email, password, timezone: "UTC" }),
});
if (signup.status >= 400) throw new Error(`signup ${signup.status}`);
const cookie = (signup.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ");
const catalog = await (await fetch(`${BASE}/api/catalog?kind=movie&limit=6`, { headers: { cookie } })).json();
const items = catalog.items ?? [];
if (items.length < 4) throw new Error("need four movies");

for (let i = 1; i < 5; i += 1) {
  await fetch(`${BASE}/api/rankings/${items[0].id}/vote`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ opponentId: items[i].id, result: i % 2 === 0 ? "loss" : "win" }),
  });
}

const itemPage = await (await fetch(`${BASE}/app/item/${items[0].id}`, { headers: { cookie } })).text();
const whyPage = await fetch(`${BASE}/app/item/${items[0].id}/why`, { headers: { cookie }, redirect: "manual" });
const why = await whyPage.text();
// A title in a different kind has no rating at all, so /why must bounce back.
const tv = await (await fetch(`${BASE}/api/catalog?kind=tv&limit=1`, { headers: { cookie } })).json();
const unrated = await fetch(`${BASE}/app/item/${tv.items?.[0]?.id}/why`, { headers: { cookie }, redirect: "manual" });

// React separates interpolated text with comment markers (`±<!-- -->0.3`).
const clean = (html) => html.replace(/<!--.*?-->/g, "");
const itemText = clean(itemPage);

const result = {
  itemHasWhyLink: itemText.includes("See why"),
  itemHasBadge: /±\s*\d\.\d/.test(itemText) && itemText.includes("comparisons"),
  whyStatus: whyPage.status,
  whyHeading: /#\d in Movies/.test(why),
  whyHasIntervals: why.includes("95% range") || why.includes("±"),
  whyHasMovers: why.includes("Comparisons that moved it most"),
  whyHasEloDelta: /[+-]\d+<\/span>/.test(why),
  unratedItem: tv.items?.[0]?.title ?? null,
  unratedStatus: unrated.status,
  unratedLocation: unrated.headers.get("location"),
  unratedExplained: clean(await unrated.text()).includes("Why it sits here"),
};
console.log(result);

await fetch(`${BASE}/api/account/delete`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ password, confirm: "DELETE" }),
});

const ok =
  result.itemHasWhyLink &&
  result.itemHasBadge &&
  result.whyStatus === 200 &&
  result.whyHeading &&
  result.whyHasIntervals &&
  result.whyHasMovers &&
  result.whyHasEloDelta &&
  // Either a real redirect, or a streamed redirect that never renders the page.
  (!result.unratedExplained && (result.unratedStatus === 307 || result.unratedStatus === 302 || result.unratedStatus === 200));
console.log(ok ? "PASS: explanation and confidence render" : "FAIL");
process.exit(ok ? 0 : 1);
