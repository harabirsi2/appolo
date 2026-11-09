# Appolo technical architecture

Describes the implementation as it exists, including the ranking additions from this
pass.

## 1. Stack and runtime

- **Node 20+**, pnpm 9.15.4 workspace (`apps/*`, `packages/*`).
- **Next.js 15** App Router, React 19, server components for data loading, server
  actions and route handlers for mutations.
- **PostgreSQL** via `drizzle-orm` + `postgres` (postgres-js). No ORM lazy-loading.
- **Tailwind 4** with `@theme` tokens in `apps/web/app/globals.css`.
- **Worker** process for background jobs (BullMQ in the Docker setup).
- **PowerShell** scripts for local DB/CI/smoke on Windows.

## 2. Multi-tenancy

A person is an `org`. Every tenant table has `org_id`; `withOrg(orgId, fn)` opens a
transaction and sets `app.org_id`, and `FORCE ROW LEVEL SECURITY` policies compare
`org_id` against that setting. Shared catalog tables (`catalog_items`,
`catalog_credits`) intentionally have no tenant column.

Rules that follow from this:

- Never query a tenant table outside `withOrg` in a mutation.
- Public/social reads that must be world-readable explicitly run without tenant scope
  (`getDb()`), as `profiles`, `pods` and `reviews` do.
- New tenant tables must get an RLS policy and a grant; see
  `packages/db/sql/0012_ranking_model.sql`.

## 3. Packages

| Package | Responsibilities |
|---|---|
| `@appolo/core` | Pure logic, no DB/framework: password (scrypt), tokens, validation, permissions, review limits, Elo (`ranking.ts`), BT model (`ranking-model.ts`), taste math (`taste-match.ts`) |
| `@appolo/config` | Env parsing/validation |
| `@appolo/db` | Drizzle schema, migrations (`drizzle/*.sql` + `sql/*.sql`), seed, RLS test |
| `@appolo/ui` | Buttons, inputs, empty state, `cn` |
| `@appolo/web` | Routes, components, services, API |
| `@appolo/worker` | Queue consumers |

Client components import from `@appolo/core/ranking` (the barrel pulls `node:crypto`
through password/token modules, which cannot ship to the browser).

## 4. Data model (media layer)

```
orgs ──< profiles (1:1 username)
  │
  ├──< item_ratings >── catalog_items ──< catalog_credits
  │        │                  │
  │        ├──< rating_reactions
  │        ├──< rating_comments
  │        └──< rating_events
  │
  ├──< item_matchups >── catalog_items (item + opponent)
  ├──< ranking_models (org, kind)  ← new snapshot
  ├──< follows (follower/followee org)
  ├──< pods >──< pod_items >── catalog_items
  ├──< watchlist
  ├──< search_history
  └──< social_notifications
```

Key constraints:

- `item_ratings (org_id, item_id)` unique; `catalog_items (kind, title, subtitle)`
  unique and `external_ref` unique.
- `follows (follower_org_id, followee_org_id)` unique (no duplicate follows).
- `ranking_models (org_id, kind)` unique.
- Comparisons are durable rows in `item_matchups`; nothing about a ranking depends on
  a mutable score alone.

## 5. Request flows

### Vote / comparison

```
POST /api/rankings/:itemId/vote
  → getSession (401 if anonymous)
  → voteInputSchema (win|loss|tie|undecided|skip)
  → submitVote(orgId, itemId, opponentId, result)
       └ withOrg transaction:
           upsert both item_ratings, adaptive Elo, counters (wins/losses/ties/skips)
           insert item_matchups { result, outcome, elo before/after }
           insert rating_events for decided outcomes
       └ after commit: refreshRankingModel(orgId, kind)   (best-effort)
```

### Next matchup

```
GET /api/rankings/:itemId/matchup
  → getRankingModel(orgId, kind)  (before transaction)
  → withOrg:
      load same-kind pool + target rating
      load recent opponents and pair history
      scoreInformativeOpponents(...) → opponent
      fallback to Elo-distance selectOpponent
```

### Model inspection

```
GET /api/rankings/model?kind=movie
  → refreshRankingModel (rebuild from item_matchups)
  → positions, θ, SE, 95% interval, wins/losses/ties, personal score
```

## 6. Security

- Passwords: scrypt with per-user salt (`packages/core/src/password.ts`).
- Sessions: random opaque token, hashed at rest, http-only cookie, server-side lookup.
- Authorization: `requireSession` in pages, explicit session checks in every API route;
  mutation handlers validate with Zod before touching the DB.
- Tenancy: RLS + `withOrg`; the app role is non-superuser where configured.
- Uploads/metadata URLs are strings today; file upload validation is not implemented.
- Rate limiting and account deletion/export for the media layer are open items.
- No secrets are read from or written to client bundles; provider keys stay server-side.

## 7. Ranking integration details

- `apps/web/lib/services/rankings.ts`: `refreshRankingModel`, `getRankingModel`,
  `outcomeForResult`, revised `nextMatchup`, revised `submitVote`.
- `packages/core/src/ranking-model.ts`: fitter, probabilities, entropy, selection.
- `packages/core/src/taste-match.ts`: Kendall tau-b, cosine, coverage/confidence.
- `apps/web/lib/services/social.ts`: `matchPercent` and `compareTaste` now delegate to
  `tasteMatch`; the compare page prints the basis/confidence.
- New API routes: `apps/web/app/api/rankings/model/route.ts` (model inspection)
  and `apps/web/app/api/rankings/[itemId]/undo/route.ts` (reverse the latest
  comparison and refit).
- `apps/web/app/app/rankings/page.tsx` orders by θ for a selected kind and shows
  model score, interval, comparison count and confidence.
- Community scores use `packages/core/src/community.ts` shrinkage; `catalogLeaderboard`
  and `similarItems` expose `average` (shrunk), `rawAverage` and `confidence`.

## 7a. Home feed ranking

`packages/core/src/feed-rank.ts` is a pure, synchronous ranker. `feedForYou` in
`apps/web/lib/services/social.ts` gathers candidates (followed authors + recent global
reviews), attaches reaction/comment totals and the viewer's genre weights, then calls
`rankFeed`. Signals:

| Signal | Weight | Source |
| --- | --- | --- |
| affinity | 0.30 | viewer follows the author |
| freshness | 0.34 | exponential decay, 36 h half-life (`updatedAt`) |
| engagement | 0.20 | log-scaled reactions + 2 × comments |
| relevance | 0.16 | genre overlap with the viewer's rated titles |
| exploration | ≤ 0.06 | stable FNV-1a hash of the review id |

Each ranked entry carries a reason label that the review card renders. The function
filters seen ids, clamps negative ages and breaks exact ties by id, so equal inputs
always produce the same order. Weights and half-life are parameters with documented
defaults; tune them once feed analytics exist rather than guessing per user.

## 8. Migrations

Two directories are applied by `packages/db/src/migrate.ts`, in order: `drizzle/` then
`sql/`; names are tracked in `_appolo_migrations`.

Important: the Drizzle meta snapshot is **stale** relative to the schema (many media
tables were added through hand-written SQL). Running `drizzle-kit generate` currently
proposes re-creating tables that already exist. The new ranking changes are therefore
a hand-written idempotent migration, `sql/0012_ranking_model.sql`:

- `item_matchups.outcome text`
- `item_ratings.ties integer not null default 0`
- `ranking_models` table + unique index + RLS policy + grant

Fix the snapshot separately (regenerate baselines from a clean database) before
relying on `db:generate` again.

## 9. Verification commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test                 # packages/core unit tests (30)
pnpm --filter @appolo/web build
# with a PostgreSQL instance:
pnpm db:migrate && pnpm db:seed && pnpm db:rls-test
pnpm e2e                  # HTTP e2e against a running server (creates test accounts)
pnpm smoke                # PowerShell, needs a running server
```

## 10. Environment notes

- `.env` holds `DATABASE_URL` and `MIGRATE_DATABASE_URL`; never commit it.
- Local DB script expects port 55432 and Windows PostgreSQL binaries.
- The cloud VM had no Postgres server or Docker, so this pass used portable PostgreSQL
  16.2 binaries on port 55432 (the same port the Windows script uses). Migrations,
  seed, RLS test, build and the media/ranking API flows were verified there. Development
  data in that ephemeral cluster is disposable and is not committed.
