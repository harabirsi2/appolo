# Appolo — Feature inventory

The product is a taste-ranking platform: you rate what you have seen, heard or
read through pairwise comparisons, and Appolo turns those choices into a
personal ranking, a public profile and a shared catalog. This file describes
what the application in this repository actually ships.

Legend: **Shipped** · **Partial** · **Not built**

---

## 1. Catalog

| Area | Status | Detail |
|---|---|---|
| Shared catalog | Shipped | 1,180 titles: 357 movies, 173 TV, 204 albums, 80 podcasts, 196 books, 170 games |
| Metadata | Shipped | Title, creator/author/studio, year, genres, descriptions where curated, tags |
| Cover art | Shipped | 1,165 locally cached covers (720 px long edge, JPEG-80); the rest use distinct generated tiles |
| Credits | Shipped | Actor/director/artist pages linked from items (`catalog_credits`) |
| Search | Shipped | Trigram-indexed title/subtitle search, genre filters, kind filters |
| Provider enrichment | Shipped | Optional external providers insert new titles after the response (never block search) |
| Watchlist | Shipped | Per-profile watchlist |
| Rating history | Shipped | Timeline of rating events per profile |
| Duplicate detection | Partial | Uniqueness by `external_ref`; fuzzy matching across providers is not implemented |

## 2. Ranking engine

| Area | Status | Detail |
|---|---|---|
| Pairwise comparisons | Shipped | Append-only `item_matchups` is the source of truth |
| Elo ladder | Shipped | Fast incremental scoring; drives the 0–10 score in every screen |
| Bradley–Terry + Davidson | Shipped | MAP fit with L2 prior, ties modelled explicitly, uncertainty from Fisher information |
| Ties / undecided / skip | Shipped | Distinct outcomes; skips never change scores |
| Comparison selection | Shipped | Information gain × uncertainty × exposure balance, with repeat penalty |
| Undo | Shipped | Restores Elo/counters and removes the matching timeline event |
| Manual order | Shipped | Reorder mode writes `ranking_order` plus audit events, never fake matchups |
| Confidence labels | Shipped | Interval, comparison count and low/medium/high confidence in the UI |
| Community shrinkage | Shipped | Bayesian-style prior pulls thin samples toward neutral |
| Coordinated-vote detection | Shipped | Reviewer pairs with sustained near-identical votes are down-weighted (see `RANKING_SYSTEM.md`) |
| Per-user model parameters | Not built | `ν`/`λ` are global constants, stored in the snapshot for replay |
| Sub-category models | Not built | One model per media kind, no genre-level fits |
| Ranking history ("why A > B") | Not built | Comparison path is not surfaced |

## 3. Reviews

| Area | Status | Detail |
|---|---|---|
| Written reviews | Shipped | Long-form text, saved with the rating |
| Structured extras | Shipped | Tags, spoiler flag, favourite character, favourite tracks |
| Media attachments | Shipped | Photo and video attachment after a review threshold |
| Reactions | Shipped | Emoji reactions with per-viewer state |
| Comments | Shipped | Paginated 20 at a time, rate-limited |
| Pinned review | Shipped | One pinned review per profile |
| Pros/cons fields | Not built | |
| Helpfulness voting | Not built | |
| Edit history | Not built | Only the current revision is stored |
| Moderation queue / spam detection | Partial | User reports exist; no automated duplicate or spam detection |

## 4. Discovery

| Area | Status | Detail |
|---|---|---|
| Browse | Shipped | Community leaderboard by top/rated/new, kind and genre filters |
| Weekly movers | Shipped | Largest score swings in the last week |
| Popular this week | Shipped | Most-rated titles in seven days, cached for 60 seconds |
| For-you feed | Shipped | Freshness, follow affinity, genre relevance, engagement, exploration, per-card explanation |
| Following feed | Shipped | Strict chronological |
| Feed dismissals | Shipped | Hidden reviews stay out of that profile's feed |
| Taste DNA | Shipped | Per-genre distribution, top picks, insights |
| Taste comparison | Shipped | Kendall tau-b, rating similarity, genre cosine, per-kind match cards, confidence |
| Cold-start onboarding | Shipped | Genre picks act as a prior before ratings exist |
| Suggested profiles | Shipped | Ordered by shared genres, excludes already-followed accounts |
| Collaborative filtering | Not built | No user-item matrix factorisation |

## 5. Social

| Area | Status | Detail |
|---|---|---|
| Profiles | Shipped | Public profile page, avatar hue, bio, followers/following |
| Follow / unfollow | Shipped | Follow graph, feed integration, notifications |
| Pods (collections) | Shipped | Ranked lists with notes, public share pages, add/remove/reorder |
| Notifications | Shipped | Follow, reaction and comment notifications, unread count, mark read |
| Reports | Shipped | Report a review/profile for moderation |
| Private accounts | Not built | |
| Block / mute | Not built | Reports exist but blocking is not enforced across queries |
| Private lists | Not built | Pods are public |
| Notification preferences | Not built | |

## 6. Sharing and public surface

| Area | Status | Detail |
|---|---|---|
| Public review pages | Shipped | `/review/:id`, OG metadata |
| Public pod pages | Shipped | `/:username/:slug` |
| Embed widgets | Shipped | `/embed/:key` and review embeds |
| Share buttons | Shipped | Web share / clipboard fallback |
| Generated share cards | Not built | Image cards would need a renderer |

## 7. Account and platform

| Area | Status | Detail |
|---|---|---|
| Email + password auth | Shipped | scrypt hashes, database sessions, active-membership checks |
| Multi-tenant orgs | Shipped | Every row is org-scoped; Postgres RLS enforces isolation |
| Onboarding | Shipped | Interest picker after signup, starter title |
| Settings | Shipped | Display name, avatar hue, manual mode, connected-service flags |
| Data export | Shipped | `/api/account/export` (profile, ratings, reviews, matchups, order) |
| Account deletion | Shipped | Password-confirmed, cascades, demo account protected |
| Rate limiting | Shipped | Sign-in/sign-up and interactive endpoints, `Retry-After` |
| Audit log | Shipped | Sensitive actions recorded in `audit_log` |
| Theme switch | Not built | Single dark editorial theme by design |
| Native apps | Not built | Responsive web only |

---

## Explicit non-goals

- Payments, billing and money movement.
- A separate CRM/inbox/messaging product.
- Fabricated ratings or seeded community scores for new catalog entries.
