# Appolo roadmap

Phase 0 was an audit; this pass executed a focused slice of Phase 3 (ranking engine)
and part of Phase 5 (taste matching). Everything else stays explicitly queued.

Status legend: **Done**, **Partial**, **Open**.

## Phase 0 — Audit (Done)

- `docs/PRODUCT_AUDIT.md`, `docs/TECHNICAL_ARCHITECTURE.md`,
  `docs/RANKING_SYSTEM.md`, `docs/DESIGN_SYSTEM.md`, this file.
- Baseline: typecheck, build and new unit tests pass in this environment; DB/smoke CI
  could not run here (no Postgres/Docker/root) and is reported as a limitation.

## Phase 1 — Design foundation (Mostly Done)

Done earlier: dark editorial tokens, mint accent, kind icon set, media card, podium
display, bottom nav FAB, scrollable category pills, skeletons, empty states.

Done in this pass:
- Fraunces display face for titles/wordmark with a system-sans body and tabular numerals;
  the app no longer reads as a default system-font dashboard.
- Persistent 232px desktop sidebar (Home, Browse, Search, Rankings, Taste, You, Rate,
  Settings) from 1024px; bottom nav hides, content widens to 768px, duplicate mobile
  wordmark removed on desktop.
- 44px touch targets for nav, notifications, avatar and comparison controls; global
  `:focus-visible` ring.
- Reduced-motion guard confirmed and documented; motion remains CSS-only.
- Measured 320/390/768/1280px in a browser: no horizontal overflow at any width.
- Landing page recomposed: left-aligned serif hero, hairline media rail with kind icons,
  and an asymmetric lead/stacked layout instead of three equal cards and ✓ glyphs.

Open:
- Wider editorial poster grid on desktop; currently still two-up.
- Light theme (optional, only if it can be done without diluting the identity).
- Automated visual regression screenshots.

## Phase 2 — Media and review foundation (Mostly Done)

Existing: shared catalog, six kinds (+anime as a TV/movie genre), providers, search,
detail pages, credits/people, reviews with attachments, spoilers, reactions, comments,
pods, watchlist, history.

Done in this pass:
- Provider enrichment no longer blocks a search. Local results return immediately
  and provider hits are inserted after the response via `after()`, capped at
  three concurrent lookups.

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

Done in this pass:
- Manual order: the rankings screen has a reorder mode with drag and arrow
  controls. A move saves the whole category order to `ranking_order` and writes
  one `rating_events` row per title whose position changed; no `item_matchups`
  rows are fabricated, so comparison counts and the model stay honest. A saved
  order overrides the model order for that kind until the next reorder.

Done in this pass:
- The "All" rankings view combines each kind's fitted model, ordering by the
  comparable 0–10 expected-wins score instead of raw Elo, and shows the combined
  comparison count.

Open:
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

Done in this pass:
- Cold-start onboarding: after signup the app opens `/app/onboarding`, where the
  user picks genres per media kind. Interests are stored in `profile_interests`,
  and the page offers a starter title from those genres so the first comparison
  is seeded from real picks rather than fabricated ratings.

Done in this pass:
- Onboarding interests now act as a genre prior for the For-you feed (35% of
  the genre weight until ratings dominate) and suggested profiles are ordered by
  shared genres with those interests instead of alphabetically.

- The For-you feed reranks greedily so the same kind or primary genre does
  not cluster, without dropping any candidate.

- A strict chronological Following mode: `/app?feed=following` renders only
  followed accounts' reviews, newest edit first, without ranking or diversity.
- For-you cards can be dismissed; dismissed reviews are excluded from that
  profile's feed through `feed_dismissals`.

- Comment posting goes through the shared action limiter (20 per minute per
  profile) like votes, matchups and reactions, and comments are paginated 20 at
  a time with a total so long threads load in pages.

- Icon-only controls (navigation, notifications, dismiss, reactions and reorder
  arrows) expose `aria-label` names, and decorative icons are `aria-hidden`.
- Coordinated-vote detection for community rankings.

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

Done in this pass:
- Self-serve media export (`/api/account/export`) covering the profile, ratings,
  written reviews, matchups and ranking order.
- Password-confirmed account deletion (`/api/account/delete`, owner only) removes
  the workspace and everything cascading from it — ratings, matchups, reviews,
  ranking order, watchlist, pods and follows — plus the user, memberships and
  sessions. The shared demo account is protected.

Done in this pass:
- Interactive endpoints are throttled per org using the same Postgres fixed-window
  counters as sign-in: matchup fetches 240/min, votes 120/min and reactions
  60/min, each returning 429 with a `retry-after` header. Limits sit above human
  tapping speed and stop scripted bursts.

Open:
- Browser-driven (Playwright) visuals; the HTTP e2e suite covers flows, not pixels.

Done: `scripts/e2e.mjs` (`pnpm e2e`) drives the running app with fetch only and covers
health, auth guards, signup, ratings, tie vote, model rebuild, undo, follow, follow-ranked
feed explanations and taste comparison. It creates throwaway accounts and exits non-zero
on failure.

## Immediate next three tasks

1. Add browser-driven (Playwright) visual checks for the main screens.

## Explicit non-goals for this pass

- No rewrite of the CRM/inbox layer.
- No fabricated seed data for rankings.
- No silent changes to existing user scores: Elo values remain as-is; the new model is
  additive and rebuildable.
