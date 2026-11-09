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

Open:
- Category-specific match cards ("movie match / music match").
- Community ranking shrinkage and coordinated-vote detection.
- Hybrid feed scoring (affinity, taste, freshness, quality, novelty, conversation) with
  diversity reranking and chronological Following mode.
- Recommendation explanations and dismiss controls.
- Cold-start onboarding interests.

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
- Playwright/e2e coverage of the flows in the mandate §16.

## Immediate next three tasks

1. Run `pnpm run ci` and `pnpm smoke` on a machine with PostgreSQL, then fix any
   migration/RLS issue found by `0012_ranking_model.sql`.
2. Add an e2e test for compare → tie → rebuild → undo → rebuild (needs a DB).
3. Implement manual drag reordering without fabricating comparison events.

## Explicit non-goals for this pass

- No rewrite of the CRM/inbox layer.
- No fabricated seed data for rankings.
- No silent changes to existing user scores: Elo values remain as-is; the new model is
  additive and rebuildable.
