# Appolo roadmap

Phase 0 was an audit; this pass executed a focused slice of Phase 3 (ranking engine)
and part of Phase 5 (taste matching). Everything else stays explicitly queued.

Status legend: **Done**, **Partial**, **Open**.

## Phase 0 — Audit (Done)

- `docs/PRODUCT_AUDIT.md`, `docs/TECHNICAL_ARCHITECTURE.md`,
  `docs/RANKING_SYSTEM.md`, `docs/DESIGN_SYSTEM.md`, this file.
- Baseline: typecheck, build and new unit tests pass in this environment; DB/smoke CI
  could not run here (no Postgres/Docker/root) and is reported as a limitation.

## Phase 1 — Design foundation (Partial)

Done earlier: dark editorial tokens, mint accent, kind icon set, media card, podium
display, bottom nav FAB, scrollable category pills, skeletons, empty states.

Open:
- Display typeface + separate numeric treatment.
- Reduced-motion support and a documented breakpoint/touch-target audit at
  320/375/390/430/tablet/desktop.
- Desktop navigation shell (the app is mobile-first with no desktop-specific chrome).
- Light theme (optional, only if it can be done without diluting the identity).

## Phase 2 — Media and review foundation (Mostly Done)

Existing: shared catalog, six kinds (+anime as a TV/movie genre), providers, search,
detail pages, credits/people, reviews with attachments, spoilers, reactions, comments,
pods, watchlist, history.

Open:
- Duplicate detection across providers beyond `external_ref` uniqueness.
- Episode/season/artist entities (currently folded into titles/subtitles).
- Trailer licensing/attribution review before enabling more sources.

## Phase 3 — Ranking engine (Major slice Done)

Done in this pass:
- Bradley–Terry + Davidson fit, MAP regularisation, uncertainty, centred estimates.
- Durable outcomes (`a`/`b`/`tie`/`undecided`/`skip`) and a migration.
- `ranking_models` snapshot + rebuild-on-demand API.
- Information-gain comparison selection (entropy × uncertainty × exposure).
- Tie/undecided UI in the rating flow.
- 11 engine tests (plus 7 taste tests).

Also done:
- Rankings screen orders by fitted θ for a selected kind and shows model score,
  95% interval, comparison count and confidence.
- Undo endpoint + "Undo last" control; restores stored Elo/counters and refits.
- Community scores use Bayesian-style shrinkage with a confidence label.

Open:
- "All" rankings view spanning kinds still uses Elo.
- Manual drag mode that creates explicit manual events rather than fake comparisons.
- Estimate `ν`/`λ` per user; add sub-category (genre) models.
- Ranking history view ("why is A above B"): expose the comparison path.
- Coordinated-vote detection for community rankings.

## Phase 4 — Social system (Partial)

Existing: profiles, follow/unfollow, feed, comments, reactions, notifications, pods,
pinned review, privacy-ish profile layout.

Open:
- Private accounts and follow requests; block/mute UI enforcement across every query.
- Comment pagination and spam rate limits beyond auth-level limits.
- Collection collaboration permissions and invitations.
- Notification preferences, grouping and dedupe guarantees under retries.

## Phase 5 — Discovery and recommendations (Partial)

Done in this pass:
- Taste match uses Kendall tau-b, rating similarity, genre cosine and evidence
  coverage; confidence label and plain-language basis shown on the compare page.
- Category-specific match cards ("Movies", "Music", …) on the compare page, each with
  its own shared-count and confidence.
- Hybrid "For you" feed scoring (`packages/core/src/feed-rank.ts`): freshness decay,
  follow affinity, genre relevance and engagement, plus deterministic exploration and
  a per-card explanation ("From someone you follow", "Matches your taste", …).
- Community ranking shrinkage and confidence labels.

Open:
- Diversity reranking and a strict chronological Following mode.
- Coordinated-vote detection for community rankings.
- Recommendation dismiss controls and cold-start onboarding interests.

## Phase 6 — Integrations and sharing (Partial)

Existing: Spotify/Apple flags on profiles, catalog providers, public review/pod pages,
share buttons, OG metadata on public routes, embed widgets.

Open:
- Real OAuth connection/disconnect/import flows and token refresh.
- Generated share cards (image rendering rather than screenshots).
- Deep-link coverage for every shareable object.

## Phase 7 — Polish, security, QA (Partial)

Existing: server-side session checks, RLS, scrypt passwords, Zod validation, audit
logs/route, reports, export for contacts.

Open:
- Rate limiting on auth and comparison endpoints.
- Account deletion/data export covering the media layer.
- Accessibility pass (focus states exist; screen-reader labelling for icon-only
  controls needs work).
- Browser-driven (Playwright) visuals; the HTTP e2e suite covers flows, not pixels.

Done: `scripts/e2e.mjs` (`pnpm e2e`) drives the running app with fetch only and covers
health, auth guards, signup, ratings, tie vote, model rebuild, undo, follow, follow-ranked
feed explanations and taste comparison. It creates throwaway accounts and exits non-zero
on failure.

## Immediate next three tasks

1. Implement manual drag reordering without fabricating comparison events.
2. Add auth/comparison rate limiting and media-layer account deletion/export.
3. Cold-start onboarding: pick interests and seed the first comparisons from them.

## Explicit non-goals for this pass

- No rewrite of the CRM/inbox layer.
- No fabricated seed data for rankings.
- No silent changes to existing user scores: Elo values remain as-is; the new model is
  additive and rebuildable.
