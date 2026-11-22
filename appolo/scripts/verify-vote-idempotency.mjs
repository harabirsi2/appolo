/**
 * Prove the offline-replay contract against a running server:
 *
 *   node scripts/verify-vote-idempotency.mjs
 *
 * Signs up a throwaway account, sends the same vote twice with one
 * Idempotency-Key, and checks through the app's own API that the second
 * delivery was a replay: identical response, flagged, and exactly one matchup
 * counted (both counters are read before and after, so the check does not need
 * database access — the tenant rows are behind RLS anyway). Deletes the account.
 */
const BASE = process.env.APP_BASE ?? "http://127.0.0.1:3000";
const stamp = Date.now().toString(36);
const password = "idem-check-1234";
const email = `idem-${stamp}@appolo.test`;

const signup = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ orgName: `IDEM ${stamp}`, name: "IDEM", email, password, timezone: "UTC" }),
});
if (signup.status >= 400) throw new Error(`signup failed: ${signup.status}`);
const cookie = (signup.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ");

const catalog = await (await fetch(`${BASE}/api/catalog?kind=movie&limit=2`, { headers: { cookie } })).json();
const [a, b] = catalog.items ?? [];
if (!a || !b) throw new Error("catalog needs two movies");

const state = async () => {
  const response = await fetch(`${BASE}/api/rankings/${a.id}`, { headers: { cookie }, cache: "no-store" });
  const body = await response.json();
  return { matches: body.rating?.matches ?? 0, history: (body.history ?? []).length };
};

const before = await state();
const key = crypto.randomUUID();
const send = () =>
  fetch(`${BASE}/api/rankings/${a.id}/vote`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ opponentId: b.id, result: "win" }),
  });

const first = await send();
const firstBody = await first.json();
const second = await send();
const secondBody = await second.json();
const after = await state();

const result = {
  firstStatus: first.status,
  secondStatus: second.status,
  replayHeader: second.headers.get("x-idempotent-replay"),
  secondReplayed: secondBody.replayed === true,
  sameDelta: firstBody.itemDelta === secondBody.itemDelta,
  sameScore: firstBody.item?.score === secondBody.item?.score,
  matchesAdded: after.matches - before.matches,
  historyAdded: after.history - before.history,
};
console.log(result);

await fetch(`${BASE}/api/account/delete`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ password, confirm: "DELETE" }),
});

const ok =
  result.firstStatus === 200 &&
  result.secondStatus === 200 &&
  result.replayHeader === "1" &&
  result.secondReplayed &&
  result.sameDelta &&
  result.sameScore &&
  result.matchesAdded === 1 &&
  result.historyAdded === 1;
console.log(ok ? "PASS: one vote, one matchup, replayed response" : "FAIL");
process.exit(ok ? 0 : 1);
