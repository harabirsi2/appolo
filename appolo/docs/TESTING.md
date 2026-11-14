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
| `pnpm test` | Core logic: ranking model, ranking quality, Elo, taste similarity, feed ranking, community shrinkage, coordinated-vote detection, CSV-injection escaping, delivery-status ordering | **62/62** |
| `pnpm preflight` | App reachable and database answering (`select 1`) | pass |
| `pnpm typecheck` | All workspaces | pass |
| `pnpm e2e` | 29 HTTP checks: health, auth guards, signup, rating, tie, undo, model rebuild, follow, feed explanations, taste comparison, moderation, media export, contact export (formula neutralization + rate limit), deletion | **29/29** |
| `pnpm visual` | 8 screens, pixel comparison against committed baselines, 0.1% tolerance locally (5% in CI) | **8/8** |
| `pnpm a11y` | axe-core on 8 screens; fails on serious/critical violations | **0 violations** |
| `pnpm db:role-guard` | Fails if the app's database role is a superuser or has `BYPASSRLS` | pass |
| `pnpm db:rls-test` | Cross-tenant isolation through `withOrg()` on orgs, locations, contacts, ratings, reviews, notifications and pods; refuses to run under a role that bypasses RLS | **16/16** |
| `pnpm db:idempotency-test` | Webhook idempotency: `(org_id, provider_sid)` and `(message_id, event)` are unique, so a replayed provider callback is a no-op | **5/5** |
| `pnpm verify` | preflight → role guard → media-art → typecheck → unit tests → e2e → visual (the gate used before commits and in CI) | pass |

`VISUAL_UPDATE=1 pnpm visual` accepts intentional rendering changes and rewrites
the baselines in `scripts/visual-baselines/`. Review the generated
`scripts/visual-output/*.diff.png` before committing.

The pixel tolerance is configurable through `VISUAL_MAX_DIFF_RATIO` and defaults
to `0.001` (0.1%). The committed baselines were captured on Windows, so the CI
workflow sets `VISUAL_MAX_DIFF_RATIO=0.05` to absorb cross-platform font and
anti-aliasing differences; the structural checks still run at full strength
there. Keep the strict default locally so real layout regressions are caught.

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
- robustness to misspecification: when outcomes come from a probit process with
  no ties and 20% of decided outcomes flipped, Spearman with the latent ordering
  stays **≥ 0.85** on four seeds (observed 0.93–0.94);
- interval coverage under that same probit process is gated at **≥ 0.95
  pooled over 20 seeds** (observed 0.950 against nominal 0.95, up from 0.825
  before correction): standard errors carry a capped Pearson overdispersion
  factor, and an overconfident fit extends each interval outward by the
  estimated attenuation. A per-item diagnostic over repeated events at fixed
  strengths prints the lowest items and gates the weakest decile at **≥ 0.90**
  with a gap to the rest of **≤ 0.05** (observed 0.935 vs 0.955, gap 0.020);
- predictive accuracy on held-out comparisons **≥ 0.65** (observed 0.68–0.73);
- 95% interval coverage of the true strengths: **mean ≥ 0.85 across four
  seeds** (observed mean 0.958) with a per-seed sanity floor of **≥ 0.70**
  (observed minimum 0.875), and a median interval width under 2 to catch
  uselessly wide intervals;
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

## Webhook and messaging idempotency

`pnpm db:idempotency-test` (run by CI after the RLS suite) builds one org with a
message and asserts the database, not just the service, enforces replay safety:

- a second message with the same `(org_id, provider_sid)` is rejected, and the
  `onConflictDoNothing` path the inbound webhook uses is a clean no-op;
- the same provider id is still accepted in a different org;
- a second `message_events` row for the same `(message_id, event)` is rejected.

The monotonic delivery-status rule and the CSV formula guard are covered as pure
functions in `packages/core/src/messaging-safety.test.ts`, and the contact export
(formula neutralization, phone preservation, rate limit) is exercised end to end
in `scripts/e2e.mjs`.

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
