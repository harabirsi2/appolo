# Appolo — master prompt compliance checklist

Mapping of the *Master Product Excellence & Engineering* mandate to what is
actually in this repository. Status is evidence-based, not aspirational.

Legend: **Done** · **Partial** · **Open**

Latest recorded verification (2026-11-16): typecheck and `pnpm --filter @appolo/web build`
clean; core unit tests **70/70**; imports **5/5**; moderation **4/4**; RLS **16/16**;
e2e **46/46** in CI (2 skipped without provider settings); visual **8/8**; `pnpm a11y` **0 serious/critical
violations** on 9 screens (including settings); `pnpm audit --prod --audit-level=low`
**0 vulnerabilities**. Image measurement: Browse 1,646 KB → 332 KB, Home 264 KB → 72 KB.

---

## 1. Core directive — inspect before changing

| Check | Status | Evidence |
|---|---|---|
| Repository audited (architecture, schema, services, components) | Done | `docs/PRODUCT_AUDIT.md`, `docs/TECHNICAL_ARCHITECTURE.md`, `docs/CODE_REVIEW.md` |
| Existing behaviour run before edits | Done | `scripts/preflight.mjs`, `scripts/e2e.mjs`, `scripts/visual.mjs` |
| Baseline established (perf, reliability, tests) | Done | page timings and `EXPLAIN ANALYZE` in `docs/PERFORMANCE.md`; 46 e2e + 8 visual checks |
| No wholesale rewrite; stack preserved | Done | Next 15 App Router, Postgres + Drizzle, `packages/core` kept |

## 2. Product and competitive analysis

| Check | Status | Evidence |
|---|---|---|
| Product feature inventory | Done | `FEATURE_MAP.md` — rewritten to the shipped rating product (catalog, ranking, reviews, discovery, social, account) |
| Gap analysis against the mandate | Done | `docs/PRODUCT_AUDIT.md` §5 |
| Competitive analysis and positioning | Done | `docs/COMPETITIVE_ANALYSIS.md` — Podiums, Letterboxd, Goodreads, Backloggd and Serializd comparison |
| Onboarding, profile, review, discovery, retention analysis | Done | `docs/COMPETITIVE_ANALYSIS.md` and the phase evidence in `docs/PRODUCT_ROADMAP.md` |
| Own identity, no competitor branding copied | Done | `docs/DESIGN_SYSTEM.md` (editorial dark theme, Fraunces + mint accent) |

## 3. Ranking engine

| Check | Status | Evidence |
|---|---|---|
| Pairwise comparisons as source of truth | Done | append-only `item_matchups`; `docs/RANKING_SYSTEM.md` §1 |
| Bradley–Terry + Davidson fit | Done | `packages/core/src/ranking-model.ts` |
| Elo-style incremental updates | Done | `packages/core/src/ranking.ts` |
| Confidence-aware ranking (standard errors, 95% intervals) | Done | identified-subspace variance in `ranking-model.ts`; UI shows `±interval · comparisons · confidence` |
| Ties, undecided, skip handling | Done | `outcome` column, migration `sql/0012_ranking_model.sql` |
| Cold start / sparse data handled honestly | Done | L2 prior, `converged` flag, confidence labels; no fabricated ratings in seed |
| Explainable comparison selection | Done | entropy × uncertainty × exposure; `scoreInformativeOpponents` |
| Manipulation resistance | Done | Bayesian shrinkage plus coordinated-vote detection and half-weight down-weighting (`packages/core/src/coordination.ts`) |
| Personalized / sub-category ranking | Open | per-user `ν`/`λ`, genre-level models, ranking-history ("why A > B") |
| Engine tests | Done | 11 ranking tests + 7 taste tests; `packages/core` total 70 |

## 4. Review system

| Check | Status | Evidence |
|---|---|---|
| Written reviews with attachments, spoilers, photos, video | Done | `review-screen.tsx`, schema `reviews` |
| Structured extras (pros/cons, favourite character/tracks) | Partial | favourite character/tracks shipped; pros/cons not implemented |
| Reactions and threaded comments | Done | `review-engagement.tsx`, paginated comments (20/page) |
| Review sorting and helpfulness | Partial | newest-edit ordering in feeds; no helpfulness score |
| Editing history, moderation queue, duplicate/spam detection | Partial | review/profile/comment reporting and the moderator queue are shipped; edit history and automated duplicate/spam detection remain open |
| Contextual rating explanation | Done | score bands and review prompts in the rating flow |

## 5. Discovery and recommendations

| Check | Status | Evidence |
|---|---|---|
| Taste similarity (Kendall tau-b, rating similarity, genre cosine) | Done | compare page with confidence and plain-language basis |
| Hybrid For-you feed with explanations | Done | `packages/core/src/feed-rank.ts`; reasons on cards |
| Cold-start onboarding as a genre prior | Done | `/app/onboarding`, `profile_interests` |
| Diversity and dismissals | Done | greedy kind/genre rerank; `feed_dismissals` |
| Chronological Following mode | Done | `/app?feed=following` |
| Trending / emerging items | Partial | `popularThisWeek`, `weeklyMovers`; popularity is labelled, not conflated with relevance |
| Collaborative filtering | Open | not implemented |
| Recommendation coverage for inactive users | Partial | genre prior only; no seeded-preference fallback |

## 6. Social features

| Check | Status | Evidence |
|---|---|---|
| Profiles, follow/followers, activity feed | Done | `profile-screen.tsx`, `social.ts` |
| Comments, reactions, notifications | Done | `review-engagement.tsx`, notification counts |
| Shared collections (pods), pinned review | Done | `pod-screen.tsx`, `pods` tables |
| Public/private lists | Partial | pods are public; no private lists |
| Blocking, reporting, privacy controls | Partial | reports + moderator queue shipped for reviews/profiles/comments; block/mute and private accounts are not enforced across every query |
| Notification preferences / grouping / dedupe | Open | queued in roadmap Phase 4 |

## 7. UI/UX excellence

| Check | Status | Evidence |
|---|---|---|
| Design tokens, typography, spacing, elevation | Done | `docs/DESIGN_SYSTEM.md`, Tailwind 4 `@theme` |
| Consistent components, empty/error/loading states | Done | `packages/ui`, skeletons, empty states |
| Responsive behaviour verified | Done | 320/390/768/1280 px checked, no horizontal overflow |
| Touch targets, focus ring, reduced motion | Done | 44 px targets, `:focus-visible`, reduced-motion guard |
| Icon labelling and keyboard controls | Partial | `aria-label` on icon buttons, keys for tie/undecided; no full keyboard-navigation audit |
| Visual regression | Done | 8-screen pixel baselines, 0.1% tolerance in CI; `pnpm visual:local` adds the same diff against this machine's accepted baselines |
| Accessibility audit | Done | axe-core on 9 screens: 0 serious/critical violations; `pnpm a11y`; skip link added; settings fields labelled and the embed snippet is keyboard-scrollable |
| Desktop editorial grid, light theme | Open | explicitly deferred in roadmap Phase 1 |

## 8. Architecture and engineering

| Check | Status | Evidence |
|---|---|---|
| Frontend/backend architecture documented | Done | `docs/TECHNICAL_ARCHITECTURE.md` |
| Auth, authorization, validation | Done | sessions, `withOrg` RLS, Zod schemas |
| Query efficiency, N+1, duplicate work | Done | `docs/CODE_REVIEW.md` (session cache, follow counts, batched sync) |
| Caching of shared reads | Partial | popular rail cached 60 s; the leaderboard and catalog reads stay uncached because their A/Bs showed no latency gain |
| Background jobs | Partial | `apps/worker` runs BullMQ but only processes a heartbeat job; model rebuilds are process-local and self-healing |
| Logging and observability | Partial | structured server logs; no metrics/tracing |
| Lint | Open | no ESLint; typecheck only |
| Language choice justified (no Rust rewrite) | Done | `docs/PERFORMANCE.md` §5 — benchmarks did not justify it |

## 9. Database and data integrity

| Check | Status | Evidence |
|---|---|---|
| Schema, relationships, FKs, constraints | Done | `packages/db/src/schema.ts` |
| Safe, forward-only migrations | Done | `packages/db/sql/0011`–`0013`, drizzle migrations `0002`–`0005` |
| Indexing for real query shapes | Done | trigram + GIN indexes (`0013_search_indexes.sql`), rating indexes |
| RLS / tenant isolation | Done | `withOrg`, RLS policies, `db:rls-test` |
| Pagination | Done | comments paginated; catalog/feed limits |
| Seed integrity (no fabricated ratings) | Done | `packages/db/src/seed.ts` — 1,181 titles, covers only |

## 10. Security and reliability

| Check | Status | Evidence |
|---|---|---|
| Session auth + authorization boundaries | Done | active-membership checks, `requireSession` |
| Rate limiting (auth + interactive endpoints) | Done | `auth_rate_limits`, matchup/vote/reaction limiter with `Retry-After` |
| Input validation, SQL injection, XSS | Done | Zod, parameterised Drizzle queries, escaped `ILIKE` wildcards |
| CSRF / same-origin enforcement | Done | `apps/web/middleware.ts` rejects cross-origin mutating requests and unmatched `Sec-Fetch-Site` |
| Secrets management | Done | env-based, no secrets committed |
| Dependency vulnerability audit | Done | `pnpm audit --prod --audit-level=low` in CI; latest **0 vulnerabilities** |
| Remaining risks register | Done | `docs/CODE_REVIEW.md` “Remaining risks” |

## 11. Testing and QA

| Check | Status | Evidence |
|---|---|---|
| Unit tests (ranking, taste, community) | Done | 70 tests, `pnpm test` |
| Database-backed integrity tests | Done | imports **5/5**, moderation **4/4**, RLS **16/16** |
| End-to-end workflows over HTTP | Done | `scripts/e2e.mjs`, 46 checks (2 skipped without provider settings), cleans up its accounts |
| Visual regression | Done | `scripts/visual.mjs`, 8 screens |
| Accessibility tests | Done | `scripts/a11y.mjs`, axe-core on 9 screens: 0 serious/critical violations |
| Readiness / health check | Done | `scripts/preflight.mjs` (queries the DB) |
| Aggregated gate | Done | `pnpm verify`, including unit, import and moderation tests |
| API contract tests, load tests | Open | no dedicated API-contract or load suite |
| Accessibility tests | Done | `pnpm a11y` runs axe-core on 9 screens and fails on serious/critical violations |

## 12. Performance

| Check | Status | Evidence |
|---|---|---|
| Measured before optimising | Done | page timings, `EXPLAIN ANALYZE`, network transfer |
| Image optimisation | Done | `next/image` + per-slot `sizes` + 96–360 px device widths; Browse −80%, Home −73% |
| Bundle size checked | Done | 102 kB shared First Load JS in production build |
| DB latency addressed | Done | indexes, batched follow counts, session cache |
| Caching | Done | popular rail 60 s, tag-invalidated on vote/manual/undo/review/account deletion; the leaderboard cache was removed after its A/B showed no latency gain; search and catalog reads uncached |
| Large-list rendering | Partial | rails/grids are bounded; no virtualisation |

## 13. Implementation strategy

| Phase | Status | Evidence |
|---|---|---|
| 1 Audit and architecture docs | Done | `PRODUCT_AUDIT`, `TECHNICAL_ARCHITECTURE`, `RANKING_SYSTEM`, `DESIGN_SYSTEM`, `ROADMAP` |
| 2 Product/competitor analysis | Done | see §2 and `docs/COMPETITIVE_ANALYSIS.md` |
| 3 Technical debt and foundations | Done | `CODE_REVIEW.md` |
| 4 Ranking and review engine | Partial | ranking done as a slice; review depth partial |
| 5 Discovery and recommendations | Partial | taste + feed done; CF open |
| 6 Social functionality | Partial | core social done; privacy/blocking open |
| 7 UI/UX refinement | Mostly done | design system, responsive checks, visual baselines |
| 8 Performance and security optimisation | Partial | images/db/indexes, CSRF/CSP and dependency audit done; worker/caching depth remains |
| 9 Comprehensive testing | Partial | unit, import, moderation, RLS, e2e, visual and a11y green; load/API-contract remain |
| 10 Production-readiness assessment | Partial | build + verify green; worker stub, no cache, no lint |

## 14. Execution rules — self-audit

Followed: inspected before modifying; preserved existing scores and features;
no fabricated seed ratings; no unnecessary dependencies (only `sharp`, required
by the image optimisation); migrations are forward-only; every claim above is
backed by a command that was run.

Resolved since the last pass: `FEATURE_MAP.md` and `ARCHITECTURE.md` now describe
the rating product actually in this repository, and `CHANGELOG.md` records
what changed.

## 15. Required deliverables

| Deliverable | Status | Location |
|---|---|---|
| Architecture documentation | Done | `docs/TECHNICAL_ARCHITECTURE.md`, `ARCHITECTURE.md` |
| Product feature inventory | Done | `FEATURE_MAP.md` |
| Competitive analysis | Done | `docs/COMPETITIVE_ANALYSIS.md` |
| Technical debt register | Done | `docs/CODE_REVIEW.md` risks, `docs/PERFORMANCE.md` §6, `docs/SECURITY.md` known risks |
| Implementation roadmap | Done | `docs/PRODUCT_ROADMAP.md` |
| Database documentation | Done | `docs/DATABASE.md` — 74-table map, moderation schema, RLS and migration reference |
| Ranking algorithm documentation | Done | `docs/RANKING_SYSTEM.md` |
| Testing report | Done | `docs/TESTING.md` |
| Performance report | Done | `docs/PERFORMANCE.md` |
| Security audit | Done | `docs/SECURITY.md` + `docs/CODE_REVIEW.md` |
| Change log | Done | `CHANGELOG.md` |

---

## Highest-impact remaining tasks

1. Enforce block/mute and private accounts at the query layer.
2. Add private lists and stronger notification/privacy controls.
3. Manual keyboard and screen-reader pass on the comparison flow.
4. Add load testing and API contract tests; add automated duplicate/spam detection for reports.
