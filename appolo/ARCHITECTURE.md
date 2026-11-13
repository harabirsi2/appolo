# Appolo — Architecture

What actually runs in this repository. For the feature surface see
[`FEATURE_MAP.md`](FEATURE_MAP.md); for the ranking maths see
[`docs/RANKING_SYSTEM.md`](docs/RANKING_SYSTEM.md).

---

## 1. Stack

| Layer | Choice |
|---|---|
| Web | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 with design tokens in `docs/DESIGN_SYSTEM.md` |
| Database | PostgreSQL 18 (16+ compatible), Drizzle ORM, SQL migrations |
| Auth | Database sessions, scrypt password hashes, HttpOnly cookie `appolo_session` |
| Runtime | Node 20+; `pnpm` workspaces |
| Worker | `apps/worker` — BullMQ/Redis loop, currently only a heartbeat job |
| Images | `next/image` with `sharp`; covers cached locally under `apps/web/public/covers` |

## 2. Repository layout

```
apps/web          Next.js app: routes, server components, route handlers, services
apps/worker       Queue worker entrypoint (heartbeat only today)
packages/core     Pure logic: ranking model, Elo, feed ranking, taste similarity,
                  community shrinkage, coordinated-vote detection, domain types
packages/db       Drizzle schema, migrations, seed catalog, RLS test
packages/ui       Shared UI primitives
packages/config   Shared TS/lint configuration
scripts           preflight, e2e, visual, a11y, baseline images
docs              architecture, ranking, performance, security, testing, roadmap
```

## 3. Data model (media layer)

- `orgs`, `users`, `memberships`, `sessions` — identity plane, not tenant-scoped.
- `profiles` — public identity per org (username, display name, avatar hue).
- `catalog_items` — shared catalog: kind, title, subtitle, year, genres, cover.
- `catalog_credits` — people attached to items (cast/crew/author).
- `item_ratings` — per org and item: Elo, counters, review text, tags, spoiler,
  attachments, reactions summary fields.
- `item_matchups` — append-only comparison log with outcome, Elo before/after.
- `ranking_models` — cached statistical fit per org and kind (rebuildable).
- `ranking_order` — optional manual order per org and kind.
- `rating_events`, `watchlist`, `search_history`, `feed_dismissals`.
- `follows`, `pods`, `pod_items`, `rating_reactions`, `rating_comments`,
  `social_notifications`, `profile_interests`, `reports`.

Every tenant row carries `org_id`. Migrations live in `packages/db/sql` (hand-
written, forward-only) and `packages/db/drizzle` (generated metadata).

## 4. Request flow

1. `apps/web/app/app/layout.tsx` calls `requireSession()`. `getSession` is
   wrapped in React `cache`, so one request performs one session lookup.
2. Pages call service functions in `apps/web/lib/services/*`; services use
   `getDb()` (admin pool) for shared reads and `withOrg(orgId, tx => …)` for
   tenant writes. `withOrg` sets `app.org_id`, which RLS policies enforce.
3. Route handlers validate with Zod, check authorization, then call the same
   services; interactive endpoints are rate-limited in Postgres.
4. Reads that are global and expensive (`popularThisWeek`) are wrapped in
   `unstable_cache` with a 60 s TTL and a `community-popular` tag.

## 5. Ranking lifecycle

- Votes append to `item_matchups` inside a transaction that locks both
  `item_ratings` rows (`FOR UPDATE`, ordered by item id) so concurrent votes
  serialize without deadlock.
- A model rebuild is scheduled after a vote and coalesced; a burst costs one
  fit. `getRankingModel` repairs a missed rebuild by comparing the snapshot's
  comparison count with the append-only log.
- `ranking_models` is a cache: the log can always rebuild it.
- Community scores shrink toward a prior and down-weight votes flagged by
  `detectCoordinatedVoting` (reviewer pairs with sustained near-identical
  ratings across at least five shared titles).

## 6. Security boundaries

- Session lookups require an active membership.
- RLS on tenant tables; `withOrg` sets the tenant key per transaction.
- Zod validation at every mutation; `ILIKE` inputs escape `%` and `_`.
- Auth endpoints: 20 attempts per email per 15 minutes (hashed key); sign-up 20
  per IP per hour. Interactive endpoints have separate fixed-window limits.
- Account deletion requires a password and cascades from the user row.
- Secrets come from environment variables; none are committed.

## 7. Verification

`pnpm verify` = preflight (health + `select 1`) → typecheck → e2e (27 HTTP
checks) → visual (8 screens, pixel baselines). `pnpm test` runs 44 core unit
tests. `pnpm a11y` runs axe on 8 screens. See `docs/TESTING.md`.

## 8. Deployment constraints

- One stateless web process + Postgres. No queue dependency is required today;
  `REDIS_URL` enables the worker but nothing depends on it yet.
- Covers are static files in the repo, served by Next; no external image CDN is
  required at runtime.
- The catalog seed is idempotent and safe to re-run; it never deletes ratings.
