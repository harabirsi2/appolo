# Appolo — full-code review (2026-11-10)

Scope: `apps/web` routes/pages/components, `apps/web/lib` services, `packages/core`,
`packages/db`, auth/session and RLS boundaries. This pass targeted correctness
under concurrency, auth edge cases, N+1 query patterns and redundant work per
request. Everything below was reproduced locally against the dev database and
re-verified after the fix.

## Fixed

### 1. Duplicate session work on every protected page

`app-layout` and the page each called `requireSession`, and `getSession` ran a
session lookup plus a tenant-scoped workspace query each time, so one navigation
paid for two identical lookups.

- `getSession` is now wrapped in React's `cache`, so one request performs one
  lookup regardless of how many server components ask.
- Measured on `/app`: session index scans dropped **2.2 → 1.1 per request** and
  total DB transactions **28.4 → 27.2 per request**.

### 2. Disabled/invited memberships could sign in

Session lookup joined memberships without checking `status`, so a `disabled` or
`invited` member with a valid session kept access (sign-in only checked that a
membership existed).

- Session reads now require `memberships.status = 'active'`.
- Sign-in reports an inactive membership explicitly.
- Workspace selection is ordered by membership age, so a multi-workspace user
  never gets an arbitrary workspace from a `LIMIT 1`.

### 3. N+1 follow counts and a suggestions bug

`searchProfiles` ran one follow-count query per result; `suggestedProfiles` ran
one per candidate and, worse, took the first 40 profiles alphabetically and only
then filtered followed accounts — a user following those 40 got **no
suggestions at all** even though others existed.

- New `followCountsFor(ids)` aggregates followers/following for any number of
  profiles in two grouped queries.
- Suggestions exclude followed accounts in SQL and then apply `LIMIT`, so the
  result set is correct and bounded.
- Search terms escape `%`, `_` and `\`, so `q=%` matches nothing instead of
  every profile.
- Measured on `/app/search?q=e2e`: follow-count queries **17.2 → 6.4 per
  request**, total DB transactions **19.1 → 13.0 per request**.

### 4. Lost updates and double-undo

`submitVote` read both ratings, computed Elo, then updated them with no lock, so
two simultaneous votes could overwrite each other. `undoLastComparison` selected
the newest matchup and decremented counters without locking it, so a double
click could decrement the same matchup twice.

- `getOrInitRatings` inserts both rows in one statement, then selects them
  `FOR UPDATE` ordered by item id — concurrent votes on the same pair serialize
  without deadlocking.
- Undo locks the matchup row `FOR UPDATE`; the second transaction waits and then
  finds nothing to undo.
- Verified over HTTP: two concurrent votes both applied (`matches = 2`,
  `wins = 2` on the winner, 2 matchups persisted); two concurrent undos on one
  matchup produced one `undone: true` and one `undone: false`, with counters and
  matchups decremented exactly once.

### 5. Undoing a tie left a timeline event

`submitVote` records a `rated` event for ties, but undo only removed events for
`win`/`loss`, leaving a stale “Tied with …” entry in history.

- Undo now mirrors the vote's counted outcomes (`win`, `loss`, `tie`) and
  removes the matching event.
- Verified: tie vote → 1 matchup + 1 event; undo → 0 matchups + 0 events.

### 6. Watchlisting an unknown item returned 500

A well-formed UUID absent from `catalog_items` reached the foreign key and
surfaced as an internal error.

- `toggleWatchlist` now returns a 404 `ITEM_NOT_FOUND`; normal toggle on/off
  verified.

## Remaining risks (not changed in this pass)

Ordered by expected impact. None are regressions from this review.

1. **No rate limiting or lockout on `/api/auth/login` or `/signup`.** Passwords
   use scrypt, but online guessing and account enumeration are unthrottled.
   A DB-backed attempt counter per email/IP is the smallest robust fix; an
   in-memory limiter would not hold across instances.
2. **Sessions are never pruned.** Expired rows accumulate because there is no
   cron/worker job. A periodic `delete from sessions where expires_at < now()`
   belongs with whichever scheduler the project adopts.
3. **Catalog provider enrichment is synchronous.** When `CATALOG_PROVIDERS` is
   enabled, a search with 3+ characters can await up to 4 s of external calls
   before returning local results. Move insertion to the background and return
   local matches immediately.
4. **Review-platform sync is one transaction per fetched review**
   (`reviews.ts`, import loop). Batch the upserts or move the sync to a job.
5. **Search indexes.** `ILIKE '%term%'` and `genre = any(genres)` have no trigram
   or GIN index. Correct at 56 rows; plan `pg_trgm` + GIN before catalog growth,
   and confirm the extension is available on the target database first.
6. **Global discovery queries scan across tenants by design** (`popularThisWeek`,
   the global branch of `feedForYou`). They are candidates for caching or a
   materialized view once profile/review volume grows; today they are the main
   source of per-page DB reads.
7. **`ensureProfile` costs up to six queries for a brand-new account**
   (two existence checks, an insert, then a re-read). It is only hit once per
   account, so it was left as-is; the caller already checks first.
8. **No ESLint.** Unused imports, floating promises and hook misuse are only
   caught by review. Type checking covers the rest.
9. **Worker is still a heartbeat stub.** Model rebuilds are process-local and
   self-healing via the comparison-count check in `getRankingModel`; a real queue
   is still the right long-term home for them.

## Security checks performed

- Every route under `app/api` either requires a session, verifies a Twilio
  signature, or is an intentionally public surface (health, auth, public
  profiles, token/key-scoped widgets and review links).
- Tenant isolation continues to rely on `withOrg` setting `app.org_id` per
  transaction; the new batch follow-count queries run on the public `follows`
  table and only aggregate counts, as the existing code did.

## Verification

- `pnpm typecheck` clean.
- `pnpm --filter @appolo/core test` 37/37.
- `pnpm --filter @appolo/web build` clean.
- `scripts/e2e.mjs` 13/13, including vote/undo and tenant isolation.
- Concurrency, tie-undo and watchlist probes run against the dev database
  (temporary scripts, removed after use).
