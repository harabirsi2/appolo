# Changelog

Notable, user-visible or architectural changes. Dates are ISO. Entries describe
why the change was made, not every commit.

## Code cleanup and shared-read caching

- Removed dead code: 15 unused imports/locals, two orphaned components
  (`nav-link`, `phase-notice`), and duplicate catalog rows in the expansion
  modules.
- Replaced two hand-rolled catalog mappers in `social.ts` with the canonical
  `mapCatalogItem`, so a new item field is mapped in one place.
- Cached the community leaderboard for 30 s and invalidated both community
  tags on rating changes. Measured Browse: **267 ms → 199 ms** median server
  response and 13.8 → 13.0 DB transactions per request.
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
