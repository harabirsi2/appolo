# Appolo — language and performance review

Date: 2026-11-10. Environment: 8 vCPU Linux container, Node 26.13 (project
requires ≥20), local PostgreSQL 18 dev cluster on port 55432, production
`next start` build. All numbers below were measured on this machine; they are
local baselines, not production capacity claims.

## 1. Language distribution

GitHub's language endpoint for `harabirsi2/appolo` (bytes of recognised code):

| Language   | Bytes   | Share  | What it is |
| ---------- | ------: | -----: | ---------- |
| TypeScript | 992,867 | 70.89% | `appolo/apps/web`, `packages/{core,db,ui,config}`, `apps/worker` |
| C++        | 328,982 | 23.49% | `auto_attack/` only (see §2) |
| PowerShell |  50,930 |  3.64% | `appolo/scripts/{ci,smoke,dev-db}.ps1` |
| PLpgSQL    |  13,117 |  0.94% | 18 migrations in `packages/db/sql/` |
| JavaScript |   8,201 |  0.59% | `scripts/e2e.mjs`, config files |
| CSS        |   3,919 |  0.28% | Tailwind entry stylesheet |
| Batchfile  |   2,517 |  0.18% | `auto_attack/build.bat` |

Source file counts from `git ls-files`: 136 `.ts`, 70 `.tsx`, 18 `.sql`,
3 `.ps1`, 2 `.mjs`. TypeScript is the application language at every layer:
React Server Components and route handlers in `apps/web`, domain logic and Zod
schemas in `packages/core`, Drizzle schema and migrations in `packages/db`,
React primitives in `packages/ui`, and the BullMQ worker in `apps/worker`.

## 2. Every C++ file

There are exactly two tracked C/C++ files, both under `auto_attack/`:

| File | Bytes | Lines | Role |
| ---- | ----: | ----: | ---- |
| `auto_attack/src/auto_attack.cpp` | 213,246 | 5,099 | Windows engine: Npcap capture, ARP, DNS/SNI inspection, CLI command loop |
| `auto_attack/src/gui_main.cpp` | 115,736 | 2,782 | Win32 GUI that launches the engine and drives it over pipes |

Their sizes sum to 328,982 bytes — exactly GitHub's C++ total, so no other
C/C++ file contributes.

**Classification: first-party standalone utility, unrelated to Appolo.**

- It is hand-written C++ (Windows headers, Winsock, Npcap, Win32 common
  controls), not generated output and not a vendored library.
- It has its own build (`auto_attack/build.bat`, MinGW ucrt64), resources and
  manifests, and its own `README.txt`, which describes a LAN ARP-MITM toolkit:
  ARP interception, DNS rules, app blocking and captive-portal pages.
- Nothing under `appolo/` references `auto_attack`; it is not imported, built,
  tested or deployed by the app, CI or the worker.
- Its git history is separate from Appolo's and predates Appolo's first commit
  by the same day.

It does not belong to the product architecture. Recommendations, in order of
preference, for the repository owner to decide:

1. Move it to its own repository (preserves history, keeps the Appolo repo
   focused). This also matters because an ARP-MITM toolkit has security and
   policy implications unrelated to a review/ranking product.
2. If it must stay, mark it `linguist-vendored`/`linguist-documentation` via
   `.gitattributes` so tooling does not mistake it for application code.

It should not be ported to TypeScript or counted as a reason for any runtime
language decision. This review makes no change to it.

## 3. Core benchmarks

Reproduce with `pnpm --filter @appolo/core bench`
(`packages/core/bench/core.ts`). Median wall time per operation:

| Workload | Before | After | Change |
| -------- | -----: | ----: | -----: |
| `fitBradleyTerry` 100 items / 2,000 events | 121.4 ms | 24.4 ms | 4.9× faster |
| `fitBradleyTerry` 300 items / 6,000 events | 7,605 ms | 189 ms | ~40× faster |
| `fitBradleyTerry` 500 items / 10,000 events | 53,309 ms | 672 ms | ~79× faster |
| `rankFeed` 2,000 items | 2.0 ms | 1.6 ms | unchanged algorithm |
| `rankFeed` 20,000 items | 15.5 ms | 15.3 ms | unchanged algorithm |
| `tasteMatch` 200 shared + genre profiles | 0.10 ms | 0.11 ms | unchanged |
| `tasteMatch` 1,000 shared | 4.1 ms | 4.1 ms | unchanged |

The "before" column is the same code with the old covariance routine. Fit
scales cubically with catalog size after the change (100 → 500 items is 24.6 →
672.1 ms in a single pass), which is the expected cost of an O(k³) inversion.

**Root cause.** `fitCovariance` solved the information system `H·x = e_i` once
per column. Each solve is O(k³), making covariance O(k⁴). The fit itself
converged in 3 iterations in every measured case; the time was almost entirely
this inversion. The fix (`packages/core/src/ranking-model.ts`) performs one
Gauss–Jordan inversion of `[H | I]` with partial pivoting, O(k³). A CPU profile
of five 300-item fits after the change (1.3 s of samples) attributes 48.3% to
`fitCovariance`, 17.8% to `accumulate`, 12.0% to the standard-error reduction
and 4.5% to GC — the remaining cost is the inversion itself, not interpreter
overhead.

This is an algorithmic fix in TypeScript; it required no native code.

## 4. Production endpoint benchmarks

Built with `pnpm --filter @appolo/web build` and served with `next start -p 3100`,
one Node process, signed in as the demo account, 16 concurrent keep-alive
clients for 5 s per endpoint (warm-up excluded):

| Endpoint | Requests | RPS | p50 | p95 | p99 | Payload |
| -------- | -------: | --: | --: | --: | --: | ------: |
| `GET /api/profile` | 2,603 | 519.4 | 29.8 ms | 37.4 ms | 57.6 ms | 0.4 KB |
| `GET /api/catalog?kind=movie&limit=20` | 1,817 | 361.8 | 41.2 ms | 59.2 ms | 89.4 ms | 4.5 KB |
| `GET /api/rankings?kind=movie` | 1,585 | 315.3 | 49.4 ms | 63.1 ms | 76.1 ms | 2.8 KB |
| `GET /app` (server-rendered home) | 189 | 36.8 | 417.1 ms | 615.6 ms | 619.9 ms | 104.5 KB |

At 32 concurrent clients the catalog endpoint reached 378 RPS with p95 100.1 ms
instead of ~2× the 16-client figure, i.e. the single Node process saturates
before the database does. During the 5 s ranking load the Node process consumed
~5.2–5.5 CPU-seconds and all Postgres backends together ~4.7 CPU-seconds, so
both are near one core; latency is dominated by per-request React/RSC
rendering, Drizzle query building and RLS-scoped round trips, not by the
ranking math.

The full page render is the CPU-heavy path (104.5 KB of HTML/RSC per request,
~36 RPS single-process). It would benefit from caching, streaming/pagination or
multiple instances long before any native rewrite.

## 5. Rust decision

**No Rust module is justified by the measurements.**

- The only CPU hotspot found (the fitter) was an O(k⁴) algorithm bug; fixing it
  in TypeScript produced 40–79× improvements. At realistic catalog sizes the
  fit is now 25–190 ms, and the feed/taste functions are 0.1–16 ms.
- The remaining production ceiling is Node rendering and database round trips,
  which a Rust ranking module cannot change. Adding `napi-rs` would add a
  toolchain, platform binaries, FFI boundary and duplicate validation for no
  measured end-to-end gain.
- TypeScript keeps shared Zod schemas, strict types (`strict`,
  `noUncheckedIndexedAccess`, zero `any`/`@ts-ignore` in application source),
  and a single test setup.

Revisit only if all of the following hold:

1. After algorithmic and scheduling fixes, a real catalog fit still exceeds
   ~250 ms p95 (or the ranking core exceeds ~30% of request CPU in a production
   profile).
2. A native prototype shows a measured end-to-end improvement (≥2× on that p95,
   not just a microbenchmark) under the same load test.
3. The module can be a pure function with a stable, versioned interface
   (JSON/JSONB in, JSON/JSONB or a typed N-API buffer out), golden-test parity
   with the TypeScript implementation, and no business logic duplicated.

The first candidate for isolation would be `fitCovariance`/`accumulate`, since
they are pure numeric functions already separated from I/O.

## 6. Architecture and maintainability findings

Strengths:

- Clean package split: pure domain logic in `packages/core`, tenant-scoped
  persistence in `packages/db` (69 tables, 71 RLS policies), UI primitives in
  `packages/ui`, HTTP/RSC in `apps/web`.
- Strict TypeScript everywhere; Zod schemas are shared from `packages/core`
  into route handlers and services; no `any`/`@ts-ignore` in application code.
- 56 unit tests plus a 27-check end-to-end script that exercises auth, RLS
  tenant isolation, ratings, ties, undo, follows, feed ranking and taste match.
- Migrations are append-only SQL files with an applied-migrations table.

Prioritised gaps:

1. ~~**Model refresh is synchronous in the request path.**~~ Fixed: votes and
   undos now call `scheduleRankingRefresh`, which coalesces rebuilds for 750 ms
   per org and kind and runs them off the request (`createCoalescingRunner` in
   `packages/core/src/coalesce.ts`). A vote therefore no longer pays the
   24/189/672 ms fit at 100/300/500 items. `getRankingModel` flushes pending
   work before reading and compares the snapshot's `comparisons` with the
   durable log, so the rankings page is still fresh and heals after a restart.
   The explicit `GET /api/rankings/model` route cancels queued work and refits
   once. Verified: a vote returned in 94 ms and a snapshot with one comparison
   appeared within 3 s without calling that route.
2. **No linter.** `CLAUDE.md` claims CI runs lint, but there is no ESLint
   config, dependency or script. `noUnusedLocals` / `noUnusedParameters` are on,
   so dead imports fail typecheck, but hook violations and floating promises
   are still unchecked. Add one flat config and wire it into CI.
3. **Remaining large service modules.** `reviews.ts` (1,516 lines) and
   `actions.ts` (1,089) still mix validation, queries and presentation
   shaping. `rankings.ts` and `social.ts` were split by use case — ranking
   model math in `ranking-math.ts`, discovery in `leaderboard.ts`, pods in
   `pods.ts`, profiles/follows/notifications in `social-graph.ts` — with the
   original modules re-exporting everything, so call sites did not change.
   Splitting `reviews.ts` the same way is the next low-risk win.
4. **Catalog search will not scale on ILIKE.** `listCatalog` uses
   `%term% ILIKE` plus `genre = any(genres)` without a trigram/GIN index. At 56
   rows the planner correctly seq-scans (61,750 seq scans during load are cheap),
   but plan a `pg_trgm` index and a GIN index on `genres` before the catalog
   grows.
5. **No response caching** for catalog/popular reads, which are shared across
   tenants and repeated on every navigation.
6. **E2E cleanup (resolved).** The suite now deletes every test account it
   creates, so community rankings and local data stay predictable.
7. **Documentation drift**: test count (18 vs 31), lint claim, and
   `ARCHITECTURE.md` describing a broader CRM stack than is currently wired.
8. **Cover delivery (resolved).** `<img>` loaded the full 720 px file into
   44–355 px tiles, so Browse transferred 1.65 MB of cover art. Covers now use
   `next/image` with a `sizes` value at every call site and 96–360 px device
   widths: Browse fell to 0.33 MB (−80%), Home to 0.07 MB (−73%), and 44–72 px
   rows request 96 px art instead of 360 px, with no layout change.
9. **Shared reads (partial).** `popularThisWeek` now runs through
   `unstable_cache` with a 60 s TTL, so one global aggregation serves every
   home-page request in that window. Measured `/app` TTFB before and after:
   213–251 ms vs 207–252 ms — inside noise at this data size. The saving is one
   aggregation per request, which matters as ratings grow, not a visible
   latency win today. These figures are dev-server numbers, where framework
   overhead dominates; a production server answers `/app` in ~10 ms, so treat
   the absolute values as dev-only.
10. **Leaderboard cache — removed after measuring no gain.** `catalogLeaderboard`
    was cached for 30 s and tag-invalidated on vote, manual score, undo, review
    save and account deletion. A production A/B ran the same route and session,
    60 warm requests per arm, with 300 rated titles:

    | arm | median | p10 | p90 | DB transactions/request |
    | --- | --- | --- | --- | --- |
    | cache on | 9.4 ms | 8.7 ms | 11.0 ms | 5.6 |
    | cache bypassed | 9.4 ms | 8.8 ms | 11.2 ms | 5.1 |

    The arms are indistinguishable, and the transaction difference is noise.
    The cache removes one leaderboard aggregation and one vote scan per
    request, but at this catalog size those cost effectively nothing next to
    the per-viewer session/profile/watchlist queries. An earlier claim of
    **267 ms → 199 ms** came from dev-server measurements, where request
    handling and compilation overhead dominate; it is retracted. Because the
    cache bought no latency and only added up to 30 s of staleness plus
    invalidation plumbing, the wrapper was removed rather than kept
    speculatively. Revisit it when the leaderboard query becomes visible in
    profiling, with a measurement that shows the gain.

    Methodology: full `next build` plus `next start`, TTFB via
    `curl -w '%{time_starttransfer}'`, samples alternated across rebuilds
    (on, off, on, off) to control drift. The only shared read still cached is
    the home "popular this week" rail (60 s).

    A full `next build` initially failed while prerendering `/404` and `/500`
    with `<Html> should not be imported outside of pages/_document`, which an
    earlier revision of this document blamed on Next 15.5.29. The actual cause
    was the repo's root `.env` exporting `NODE_ENV=development`, which
    `next.config.ts` loaded into the build, so Next compiled a development
    error page into a production prerender. The config now ignores `NODE_ENV`
    from env files and lets the command pick the mode; `next build`,
    `next start` and `next dev` all succeed without any caller-side override.
11. **Catalog read cache — tried, measured, removed.** The search/discovery
    query (`listCatalog`, used by `/app/search` and `/app/rate`) was wrapped in
    the same `unstable_cache` pattern: 60 s TTL, a `catalog-reads` tag, and
    invalidation when provider enrichment inserts rows. A production A/B on
    `/app/search` with 60 warm requests per arm, alternating cache on/off in
    both orders:

    | query | cache on (median) | cache off (median) | DB transactions/request |
    | --- | --- | --- | --- |
    | free-text `?q=the` | 9.5 / 9.9 ms | 9.8 / 9.7 ms | 10.6–10.9 vs 11.5–11.8 |
    | filtered `?kind=movie` | 9.1 / 9.5 / 9.7 / 8.6 ms | 9.4 / 10.2 / 9.2 / 9.6 ms | 9.2–9.8 vs 9.7–10.6 |

    The query itself costs about 2.0 ms server-side, but the page answers in
    ~9.5 ms and the arms are indistinguishable. Caching only removes one cheap
    lookup per request (~0.6 transactions), so there is no latency win to keep.
    The free-text keys are also user-controlled and unbounded, which makes a
    60 s disk cache the wrong trade for a query this cheap. Reverted; the route
    stays uncached beyond the already-cached leaderboard that Browse renders.
    Revisit if the catalog grows enough for the ILIKE scan to show up in
    profiling.

## 7. Reproduction

```bash
cd appolo
pnpm --filter @appolo/core test
pnpm --filter @appolo/core bench

# production load (build first; stop `pnpm dev`)
pnpm --filter @appolo/web build
pnpm --filter @appolo/web exec next start -p 3100
# sign in as owner@appolo.test / appolo-demo-1234 and drive the endpoints
# with any keep-alive load client at 16 concurrency for 5 s.
```

The C++ files can be inspected without building them:

```bash
git ls-files '*.cpp'          # auto_attack/src/{auto_attack,gui_main}.cpp
wc -c auto_attack/src/*.cpp   # 328,982 bytes total
```
