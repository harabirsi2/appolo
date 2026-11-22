# CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
A superseded run on the same ref is cancelled (`concurrency`), so a force-push
never leaves two pipelines racing the same database.

`appolo/scripts/ci.ps1` is the local equivalent for Windows. It runs the same
checks in one process and is the thing to run before committing; it does not
need a browser, so it stops short of `visual`/`a11y`.

## Jobs

| Job | What it proves | Needs |
| --- | --- | --- |
| **static** | every package typechecks, ESLint passes, no known vulnerable prod dependency | nothing |
| **unit** | Elo, adaptive K, opponent selection, the Bradley–Terry–Davidson fit, confidence intervals, taste match, coordination detection, messaging safety, metadata | nothing |
| **database** | RLS (including `item_matchups` and `ranking_models`), webhook idempotency, two-connection vote races, vote-vs-undo, undo restores both Elo sides, the ranking model, importers, moderation | Postgres service |
| **e2e** | HTTP contract of the whole app against a built, seeded server (44 checks) | Postgres, build, server |
| **visual** | every main screen renders without console errors or 5xx and matches its committed Ubuntu baseline (pixel diff ≤ 0.1%) | Postgres, build, server, browser |
| **a11y** | axe-core finds no serious or critical violation on nine screens | Postgres, build, server, browser |
| **visual-baselines** | regenerates the baselines — dispatched by hand only | same as visual |

`e2e`, `visual` and `a11y` each seed with `SEED_DEMO=1`, because the browser
suites sign in as `owner@appolo.test`. A plain `pnpm db:seed` deliberately
creates no account.

Every database job first creates the `appolo_app` role with
`nosuperuser nobypassrls`. The `database` job then asserts it from Postgres
itself: a connection that can bypass RLS would make every isolation test pass
trivially while leaking across tenants.

## Visual baselines

Pixel baselines are committed under `appolo/scripts/visual-baselines/` and were
rendered **on the Ubuntu runner**, not on a developer machine: the rasterizer,
font hinting and GPU fallbacks differ enough between platforms that a locally
generated baseline would fail CI forever.

`pnpm visual` compares against them only when `CI=true` (or in local mode with
`--local`, which keeps its own `visual-baselines-local/` set). A plain local run
performs the structural checks and skips pixels.

To accept a deliberate UI change:

1. Actions → **CI** → **Run workflow** on the branch you want, with
   `update_visual_baselines` checked.
2. Download the `visual-baselines-ubuntu` artifact.
3. Copy its PNGs over `appolo/scripts/visual-baselines/`.
4. Commit them with the change that caused them, and say why in the message.

Never edit a baseline by hand and never approve a diff without looking at the
image: the whole point is that the pixels are reviewed.

## Test inventory

| File | Purpose |
| --- | --- |
| `packages/core/src/ranking-model.test.ts` | Bradley–Terry–Davidson fit: convergence, tie parameter, personal score, sparse/dense covariance agreement |
| `packages/core/src/ranking-behavior.test.ts` | `nextElo`, `nextEloAdaptive`, `kFactorFor`, `selectOpponent`: zero-sum, bands, no-op results, closest-Elo choice, recent-pair avoidance, no position-based fallback |
| `packages/core/src/score-interval.test.ts` | the 0–10 score interval brackets its point estimate, widens with the standard error, and stays inside the scale |
| `packages/core/src/ranking-quality.test.ts` | synthetic calibration: rank correlation, held-out accuracy, interval coverage, Pearson overdispersion correction |
| `packages/core/src/taste-match.test.ts` | Kendall τ-b taste comparison and its low-confidence guardrail |
| `packages/core/src/community.test.ts` | community shrinkage toward the prior as ratings accumulate |
| `packages/core/src/coordination.test.ts` | coordinated-vote detection |
| `packages/core/src/feed-rank.test.ts` | feed ordering explanations |
| `packages/core/src/coalesce.test.ts` | the coalescing runner (one refresh per burst) |
| `packages/core/src/messaging-safety.test.ts` | message sanitising and rate limits |
| `packages/core/src/metadata.test.ts` | provider metadata normalisation |
| `packages/core/src/password.test.ts` | password hashing and verification |
| `packages/core/src/catalog/normalize.test.ts` | catalog title/season/episode normalisation |
| `apps/web/lib/services/rankings-concurrency.test.ts` | two connections, one pair: simultaneous votes both land, a vote storm loses no update, one idempotency key applies once |
| `apps/web/lib/services/rankings-undo.test.ts` | undo restores initiator **and opponent** Elo exactly, removes its own event, and survives a concurrent vote |
| `apps/web/lib/services/ranking-math.test.ts` | the stored model snapshot heals from the durable comparison log |
| `apps/web/lib/services/importers.test.ts` | import mapping into catalog rows |
| `apps/web/lib/services/moderation.test.ts` | report queue transitions |
| `apps/web/lib/services/catalog-entities.test.ts` | entity materialisation from catalog rows |
| `packages/db/src/rls-test.ts` | cross-tenant probes: locations, contacts, ratings, pods, notifications, reviews, **item_matchups**, **ranking_models**, plus a cross-tenant write rejection |
| `packages/db/src/idempotency-test.ts` | inbound webhook events are applied exactly once |
| `packages/db/src/catalog-merge-test.ts` | catalog merges preserve ratings and guards |
| `scripts/e2e.mjs` | 44 HTTP checks: auth, catalog, rankings, vote, undo, review, pods, exports, rate limits, deletion, CSP/404s, and that a fresh account is not offered the smallest-UUID opponent |
| `scripts/visual.mjs` | screen structure + pixel baselines |
| `scripts/a11y.mjs` | axe-core serious/critical violations |

## Lint policy

`appolo/eslint.config.mjs` extends `typescript-eslint` **strict** (above
recommended), plus `react-hooks` and `jsx-a11y` for the web app. Rules are
disabled only with a written reason: `no-non-null-assertion` (the `rows[0]!`
after an explicit emptiness check is the codebase's row idiom),
`no-explicit-any` (provider/JSON boundaries), `no-empty-object-type` (open jsonb
columns), `no-dynamic-delete` (cache eviction), `react-hooks/exhaustive-deps`
(dependency lists that were deliberately narrowed; obeying the rule caused
re-subscription loops), and two `jsx-a11y` label rules that only understand DOM
labels. Everything else is an error, and the run is clean.

Two genuine accessibility bugs were fixed while turning this on: the trailer and
quick-action backdrops were `div onClick` elements, and are now real
`<button aria-label>` elements, so they are focusable and announced.
