# Testing

What runs, how to run it, and what is not covered.

## Prerequisites

- PostgreSQL reachable through `DATABASE_URL` (see `docker-compose.yml` or a
  local instance; `pnpm db:migrate && pnpm db:seed` for a fresh database).
- The app running at `http://localhost:3000` for the browser suites:
  `pnpm dev:web` or `pnpm build && pnpm --filter @appolo/web start`.
- Chromium for Playwright once per machine:
  `pnpm exec playwright install chromium`.

## Suites

| Command | What it covers | Current result |
|---|---|---|
| `pnpm test` | Core logic: ranking model, ranking quality, Elo, taste similarity, feed ranking, community shrinkage, coordinated-vote detection | **51/51** |
| `pnpm preflight` | App reachable and database answering (`select 1`) | pass |
| `pnpm typecheck` | All workspaces | pass |
| `pnpm e2e` | 27 HTTP checks: health, auth guards, signup, rating, tie, undo, model rebuild, follow, feed explanations, taste comparison, moderation, export, deletion | **27/27** |
| `pnpm visual` | 8 screens, pixel comparison against committed baselines, 0.1% tolerance | **8/8** |
| `pnpm a11y` | axe-core on 8 screens; fails on serious/critical violations | **0 violations** |
| `pnpm db:role-guard` | Fails if the app's database role is a superuser or has `BYPASSRLS` | pass |
| `pnpm db:rls-test` | Cross-tenant isolation through `withOrg()` on orgs, locations, contacts, ratings, reviews, notifications and pods; refuses to run under a role that bypasses RLS | **16/16** |
| `pnpm verify` | preflight → role guard → media-art → typecheck → unit tests → e2e → visual (the gate used before commits and in CI) | pass |

`VISUAL_UPDATE=1 pnpm visual` accepts intentional rendering changes and rewrites
the baselines in `scripts/visual-baselines/`. Review the generated
`scripts/visual-output/*.diff.png` before committing.

`pnpm a11y` downloads the pinned axe build from a CDN, so it needs network
access and is deliberately not part of `verify`.

## Ranking quality harness

`packages/core/src/ranking-quality.ts` generates seeded synthetic preferences:
latent item strengths, per-user scaling and bias, noisy outcomes sampled from
the Davidson model (so ties are real), and a configurable share of users who
cast only a handful of comparisons. `ranking-quality.test.ts` asserts, with
explicit thresholds:

- recovered ordering: Spearman correlation with the latent strengths **≥ 0.85**
  on two seeds (observed 0.90–0.96);
- predictive accuracy on held-out comparisons **≥ 0.65** (observed 0.68–0.73);
- 95% interval coverage of the true strengths **≥ 0.75** (observed 0.79–0.96),
  with a median interval width under 2 to catch uselessly wide intervals;
- identical estimates (within 1e-6) after reversing, shuffling or flipping the
  sides of every comparison;
- cold-start behaviour: an item with two comparisons has a standard error more
  than 2× a warm item's, a wider interval, and an estimate that stays inside
  the prior instead of running away; skipped-only items are not fabricated;
- runtime: 300 items and ~10,000 comparisons fit in **under 5 s** (observed
  ~280 ms here) while still recovering the order.

All stages are seeded, so failures are actionable rather than flaky.

## Cross-tenant isolation

Two layers keep one organisation's data out of another's requests.

`pnpm db:role-guard` (and the same check at the start of `db:rls-test`) reads
`current_user`, `rolsuper` and `rolbypassrls` from `pg_roles`. A superuser or a
role with `BYPASSRLS` turns every policy into a no-op, so it is a hard failure,
never a skip: point `DATABASE_URL` at the non-superuser `appolo_app` role.
`verify` runs this guard before the browser suites, and CI asserts the same
attributes before migrating.

`pnpm db:rls-test` creates two throwaway orgs, then reads through `withOrg()` —
the wrapper every service uses — and asserts:

- org A gets zero rows for org B's `item_ratings` (including written review
  text), `social_notifications`, and `reviews`, both unfiltered and by id;
- org A gets zero rows for B's private `pods`; public pods remain readable by
  design so signed-in users can contribute to someone else's public pod;
- B still sees its own rows, so a deny-everything policy cannot pass silently;
- cross-org inserts, org-table visibility, and reads with no org context behave
  as before.

Fixtures are deleted by cascade at the end, including the shared catalog item.

## Test data

`pnpm e2e` creates two throwaway accounts (`alpha`, `beta`) with unique emails
and deletes both at the end. It uses a unique `x-forwarded-for` per run so the
auth rate limiter does not treat repeated runs as one client. The seed never
fabricates ratings for catalog entries.

## Visual suite scope

Screens: landing, login, home, rankings, browse, search, profile, taste.
It checks an `h1` with visible text, page and console errors, and pixel diffs.
It runs in the Chromium headless shell, so text extraction uses `textContent`
rather than `innerText`.

## Not covered

- Load and soak testing.
- API contract tests beyond the e2e script.
- Multi-browser rendering (only Chromium is exercised).
- Accessibility beyond axe's automated rules (no manual screen-reader pass).
