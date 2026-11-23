# Appolo product audit

Audited 2026-11-09 against the repository at branch `freebuff/11d050abed6c50feae713aa9`.
Test and moderation sections refreshed 2026-11-16 against the current working tree.

This document describes what exists. It is not a wish list; unimplemented items are
marked as gaps.

## 1. Repository shape

| Part | Technology | Purpose |
|---|---|---|
| `apps/web` | Next.js 15 (App Router), React 19, Tailwind 4 | App/PWA, API routes, server actions |
| `apps/worker` | Node worker | Background jobs (BullMQ in Docker setup) |
| `packages/db` | Drizzle ORM + `postgres` | Schema, SQL migrations, seed, RLS test |
| `packages/core` | Pure TypeScript + Zod | Password hashing, tokens, permissions, review limits, ranking math, taste math |
| `packages/config` | TypeScript | Environment parsing |
| `packages/ui` | React | Button/Input/Select/Textarea, `cn` helper |
| `scripts` | PowerShell | `ci.ps1`, `smoke.ps1`, `dev-db.ps1` |

The app started as a customer-reputation platform (contacts, inbox, campaigns, AI
employee) and later added a Podiums-style media layer. Both layers share the same
`orgs` tenancy model: a media "profile" is an org, and a person's ranking is owned by
that org.

## 2. What is implemented and working

Verified by reading the code, typechecking and building (see §6):

- **Auth:** email/password with scrypt (`packages/core/src/password.ts`), opaque hashed
  session tokens, http-only cookies, server-side `requireSession`, login/logout/signup
  routes, middleware redirect for anonymous `/app`.
- **Tenancy and RLS:** `orgs`, `memberships`, `sessions`, and `withOrg()` setting
  `app.org_id`. `FORCE ROW LEVEL SECURITY` policies exist for tenant tables
  (`packages/db/sql/0004_media_rls.sql`, `0005_social_rls.sql`).
- **Catalog:** shared `catalog_items` (movie, tv, music, podcast, book, game), genres,
  trailer links, external refs, credits (`catalog_credits`), provider enrichment
  (`apps/web/lib/services/catalog-providers.ts`).
- **Ratings and rankings:** `item_ratings` (Elo, wins/losses/skips, review fields),
  `item_matchups` (durable comparison log), Elo-based `nextEloAdaptive`, adaptive
  K-factor, opponent selection by Elo distance.
- **Reviews:** text, tags, spoilers, photo/video URLs, favorite character/tracks,
  reactions, comments, pinning, public review pages and tokens.
- **Moderation:** authenticated reports for reviews, profiles and comments, a
  moderator-only queue at `/app/moderation`, dismiss/hide/remove actions, and
  public-query filtering of non-visible content. Automated duplicate/spam
  detection remains open.
- **Social:** profiles with username/display name/bio/avatar hue, follows, followers
  and following, feed, notifications, taste comparison screen, taste DNA page.
- **Collections ("pods"):** create/edit, add items, ordering, visibility, public pod
  pages and embeds.
- **Discovery:** search with catalog providers, browse by kind/genre, popular this
  week, weekly movers, similar items, leaderboards, person (cast/crew) pages,
  watchlist, rating history, search history.
- **Onboarding/UX:** signup, profile creation/edit, and a post-signup genre
  interest picker (`/app/onboarding`, `profile_interests`) that acts as a feed prior.
- **Custom UI:** black/mint editorial design with a bottom navigation FAB, kind SVG
  icons (`apps/web/components/kind-icon.tsx`), podium display, scrollable category
  pills, Elo win-rate badge on `MediaArt`.

## 3. Ranking system before this change

`packages/core/src/ranking.ts` implemented:

- zero-sum Elo with `expectedWinProbability`, `nextElo` and `nextEloAdaptive`;
- K-factor that decreases with decided matches;
- a linear Elo→0–10 display score (`(elo − 1200) / 60`);
- opponent selection by Elo distance with jitter and a recent-opponent penalty;
- `rankByElo`/`withPositions`.

What it did **not** have:

- no Bradley–Terry or any likelihood model;
- no tie outcome (only win/loss/skip), so "equally good" was impossible;
- no uncertainty or confidence interval;
- no information-gain opponent selection;
- no persisted model snapshot or reproducibility challenge;
- no unit tests at all (`find` for `*.test.ts` returned nothing).

## 4. Taste matching before this change

`apps/web/lib/services/social.ts`:

- `matchPercent` = `100 − avg|Δscore| × 10`, ignoring rank order and evidence size;
- `compareTaste` used the same formula and listed shared items by gap.

Consequences: two users who rate the same titles in the same order but offset by a
constant scored lower than the evidence supported; one shared title could produce a
confident-looking percentage; no confidence label or explanation.

## 5. Gaps against the mandate (prioritised)

| Priority | Gap | Status after this pass |
|---|---|---|
| P0 | No statistical ranking model, ties, confidence | **Implemented** (BT + Davidson, persisted, API) |
| P0 | No ranking tests | **Implemented** (ranking and taste tests; core suite 70/70) |
| P1 | Taste match ignores rank order/evidence | **Implemented** (Kendall tau-b + coverage) |
| P1 | Comparison selection not information-driven | **Implemented** (entropy × uncertainty × exposure) |
| P1 | No tie/undecided UI | **Implemented** in the rating flow |
| P2 | No community-ranking shrinkage | **Implemented** (fixed prior shrinkage + confidence) |
| P2 | Robust aggregation / coordinated-vote detection | **Implemented** (`coordination.ts`; half-weight for flagged pairs) |
| P2 | No manual drag reordering UI (data exists via `manualMode`/podium order) | **Implemented** (`ranking_order` + reorder mode; no fake matchups) |
| P2 | Onboarding interests/genre selection | **Implemented** (`/app/onboarding`, `profile_interests`) |
| P3 | Moderation/reporting depth, account deletion/export | **Implemented** for review/profile/comment reports, moderator queue and hide/remove enforcement; automated spam detection remains open. Account deletion/export is shipped. |
| P3 | Recommendation/feed hybrid scoring | **Implemented** (`feed-rank.ts`: freshness, affinity, relevance, engagement, exploration, explanations) |
| P3 | Share-card image generation | Existing share buttons/tokens; no generated images |

## 5a. Competitive position

Appolo is closest to Podiums: both use pairwise comparison instead of a direct
star score and organise taste across media kinds. Appolo supports six kinds
including games, exposes the ranking model and confidence, and provides
explainable feed reasons and side-by-side taste comparison. Letterboxd,
Goodreads, Backloggd and Serializd remain stronger on catalogue depth, mature
logging workflows (diary, shelves, play sessions, episodes), native mobile
distribution and existing network density. The full sourced comparison and its
strategic implications are in [`COMPETITIVE_ANALYSIS.md`](./COMPETITIVE_ANALYSIS.md).

## 6. Baseline verification performed in this environment

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm typecheck` (6 packages) | Pass |
| `pnpm test` | Pass — **70/70** core tests |
| `pnpm test:imports` | Pass — **5/5** database-backed import checks |
| `pnpm test:moderation` | Pass — **2/2** reporting/moderation checks |
| `pnpm --filter @appolo/web build` | Pass |
| `pnpm db:migrate` (23 hand-written + 6 framed migrations) | **Pass** on PostgreSQL 16.2 (portable binaries, port 55432); latest is `sql/0022_moderation_aggregates.sql` |
| `pnpm db:seed` | **Pass** |
| `pnpm db:rls-test` | **Pass** — **16/16** isolation checks |
| `pnpm audit` | **0 vulnerabilities** (`--prod --audit-level=low`) |
| `pnpm e2e` | **46/46** checks in CI (2 skipped without provider settings) |
| `pnpm visual` | **8/8** screens in the latest recorded run |
| `pnpm a11y` | **0** serious/critical violations on 9 screens in the latest recorded run |
| `pnpm run ci` / `pnpm smoke` | Scripts are PowerShell, so not executed here. Every applicable `ci` step was run individually; smoke's core flows were exercised with curl/node instead |
| End-to-end API checks | **Pass** — login, tie vote, model rebuild, undo, signup, manual ratings, taste compare (19% for opposite taste), 401 for anonymous, login redirect |
| Drizzle snapshot vs hand-written SQL | **Drift exists** (pre-existing): `drizzle-kit generate` wants to re-create media tables already created by `sql/0007_podium_parity.sql`. New migrations are therefore hand-written; the latest is `packages/db/sql/0022_moderation_aggregates.sql` |

## 7. Honest summary

Appolo is a broad, working Podiums-class app with a real catalog, reviews, pods,
follows, notifications and a functioning Elo ladder. Its weakest technical area was
the ranking/taste math: no likelihood model, no ties, no uncertainty, no tests. This
pass fixed that specific area end-to-end (engine → migration → service → API → UI →
tests) and documented the rest as roadmap work, rather than pretending the entire
mandate's 20 sections were completed.
