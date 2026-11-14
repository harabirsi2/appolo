# Changelog

Notable, user-visible or architectural changes. Dates are ISO. Entries describe
why the change was made, not every commit.

## Ranking interval calibration

- Fit standard errors include a capped Pearson overdispersion factor, and an
  overconfident fit extends each interval outward by its estimated attenuation
  `(1/slope − 1)·|θ|` instead of claiming precision. Under the probit scenario
  coverage rose from 0.825 to 0.950 over 20 seeds, the weakest decile improved
  from 0.910 to 0.935, and the harness gates pooled coverage at 0.95. A
  per-item diagnostic now prints the bottom-of-scale coverage and gates the
  weakest decile at 0.90 with a gap to the rest of at most 0.05.

## Service module split

- Split `services/rankings.ts` (1,384 lines) into `catalog-item.ts` (types,
  mapping, lookup), `ranking-math.ts` (Bradley–Terry/Davidson model lifecycle)
  and `leaderboard.ts` (leaderboard, popular rail, similar items, movers).
  `rankings.ts` keeps the personal rating flow and re-exports the rest.
- Split `services/social.ts` (1,875 lines) into `pods.ts` (pod CRUD and
  ordering), `social-graph.ts` (profiles, follows, suggestions, notifications,
  search history, taste comparison) and `social-validation.ts` (shared URL
  schema refinements). `social.ts` keeps reviews, comments, reactions and
  feeds, and re-exports the rest.
- Every previous export is still importable from `./rankings` and `./social`;
  no call site changed.
- Refreshed the `home` and `browse` visual snapshots. Both encode demo data, and
  the committed images came from an older, richer database (for example a rated
  `2001: A Space Odyssey`) that a fresh seed cannot reproduce. The other six
  snapshots still pass against their existing baselines.
- Seeding now reuses committed cover files before calling any provider, and
  applies them without the network pacing delay. A reseed dropped from tens of
  minutes of rate-limited art lookups to under a minute.

## Cross-tenant isolation guard

- Added `packages/db/src/rls-guard.ts` and `pnpm db:role-guard`: the app role
  must be neither a superuser nor `BYPASSRLS`, otherwise the guard fails with
  the role name and a fix. `pnpm verify` now runs it before the browser suites.
- `pnpm db:rls-test` now fails instead of skipping when the role bypasses RLS,
  and reads a second org's ratings (and written reviews), private pods,
  notifications and reviews through `withOrg()`, asserting zero rows while the
  owning org still sees its own. Public pods stay readable by design.

## Ranking quality evaluation

- Added `packages/core/src/ranking-quality.ts`, a seeded harness that simulates
  users with different activity levels and noise, samples pairwise outcomes
  (wins, losses, ties) from latent strengths, then scores a fit on ordering
  recovery (Spearman ≥ 0.85), held-out predictive accuracy (≥ 0.65), 95%
  interval coverage (mean ≥ 0.85 over four seeds, each seed ≥ 0.70),
  recovery under a different outcome process (probit link, no ties, 20% label
  noise; Spearman ≥ 0.85) plus gated interval coverage under that process
  (≥ 0.95 pooled over 20 seeds; observed 0.959 after the overdispersion and
  calibration corrections), invariance to event order and a/b side
  assignment, cold-start shrinkage, and a 5 s runtime budget for 300 items.
  The seven checks run in `pnpm test` and `pnpm verify`.

## Continuous integration

- Added `.github/workflows/verify.yml`, which runs on every push: Postgres 16
  service, a non-superuser `appolo_app` role created before migrations (with a
  hard assertion that it is neither superuser nor `BYPASSRLS`), migrate, seed,
  `db:rls-test`, Playwright `chromium-headless-shell` with system dependencies,
  a full production build, the production server, `pnpm verify` (preflight,
  media-art, typecheck, e2e, visual) and `pnpm a11y`. Failure diagnostics
  (server log, role assertion, visual diffs) upload as an artifact.

## Production build fix

- A plain `next build` failed prerendering `/404` and `/500` with
  `<Html> should not be imported outside of pages/_document`. Next 15.5 was not
  at fault: the monorepo root `.env` exported `NODE_ENV=development`, and
  `next.config.ts` loaded it into the build, so a production prerender used the
  development error page. The loader now ignores `NODE_ENV` from env files
  (Next sets it per command), and the variable is gone from `.env.example`.
  `next build`, `next start` and `next dev` all succeed without overrides;
  `pnpm verify` is green against a full production build.

## Code cleanup and shared-read caching

- Removed dead code: 15 unused imports/locals, two orphaned components
  (`nav-link`, `phase-notice`), and duplicate catalog rows in the expansion
  modules.
- Replaced two hand-rolled catalog mappers in `social.ts` with the canonical
  `mapCatalogItem`, so a new item field is mapped in one place.
- Tried caching the search/discovery catalog read (`listCatalog`) with the
  same `unstable_cache` + tag pattern as the leaderboard, then removed it: a
  production A/B on `/app/search` showed identical TTFB with and without it
  (9.1–9.9 ms vs 8.6–10.2 ms, depending on the query) and only ~0.6 fewer DB
  transactions per request. The query costs ~2 ms, so the cache bought no
  visible latency while adding a user-keyed disk cache. The numbers are in
  `docs/PERFORMANCE.md`; the search route stays uncached.
- Removed the 30 s community leaderboard cache. Its production A/B was a tie
  (9.4 ms median either way), so it only carried up to 30 s of staleness and
  invalidation plumbing. Browse now reads the leaderboard directly; the home
  popular rail keeps its 60 s cache and invalidation.
- Cached the community leaderboard for 30 s and invalidated both community
  tags on every write that moves rankings: votes, manual scores, undo, review
  saves and account deletion. A production A/B over 60 warm requests per arm found
  **no measurable latency change**: 9.4 ms median with the cache and 9.4 ms
  bypassed (300 rated titles). It saves one aggregation and one vote scan per
  request, but those are not where Browse spends its time. The earlier
  dev-server figure of 267 → 199 ms is retracted.
- Enabled `noUnusedLocals` / `noUnusedParameters` in `tsconfig.base.json` so
  dead imports fail typecheck from now on.
- Added `Doom (1993)` as its own catalog entry; the 1993 and 2016 games no
  longer collide on one slug.

## 2026-11-13

### Catalog
- Grew the shared catalog from 338 to **1,181 titles**: 357 movies, 173 TV, 204
  albums, 80 podcasts, 196 books, 170 games, all with real metadata and no
  fabricated ratings. Seed de-duplicates by kind and slug so re-runs are safe.
- Fetched and committed **1,174 covers**. Provider originals were normalized to
  720 px / JPEG-80: the directory is 41 MB instead of 145 MB.
- Cover downloads now normalize at write time, so future seeding cannot add
  multi-megabyte originals.

### Performance
- Cover art goes through `next/image` with per-slot `sizes` and 96–360 px device
  widths: Browse dropped from 1,646 KB to 332 KB of images, Home from 264 KB
  to 72 KB.
- Added smaller optimizer widths so 44–72 px rows no longer request 360 px art.
- `popularThisWeek` is cached for 60 seconds (one shared aggregation instead of
  one per home-page request).

### Ranking integrity
- Added coordinated-voting detection: reviewer pairs with sustained
  near-identical scores across at least five shared titles are flagged, and
  flagged votes carry half weight in community shrinkage.
- Added regression tests for detection, down-weighting and confidence changes
  (core suite is now 44 tests).

### UI and accessibility
- Every item list (rate grid, rankings, rating card, pod rows, review chip) now
  renders the item's own cover instead of generic generated art.
- Added a skip-to-content link and accessible names for avatar profile links.
- Axe reports **zero** violations across the eight audited screens (new
  `pnpm a11y` script).

### Documentation
- Replaced the CRM-oriented `FEATURE_MAP.md` and `ARCHITECTURE.md` with the
  shipped rating product and its real architecture.
- Added `docs/TESTING.md`, `docs/SECURITY.md`, `docs/EXCELLENCE_CHECKLIST.md`
  and this changelog.
