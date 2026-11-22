# Four features that exploit Podiums' weaknesses

Design only — no implementation in this pass. Every claim about the current code
names the file it comes from, so the estimates are grounded in what exists.

Ship order: **1 → 2 → 3 (one-tap only) → 4**, then 3's digest. Reasoning at the
end.

---

## 1. Instant rating flow

**User story.** As someone rating a title, when I tap *this one is better* I want
the next pair on screen immediately, so I can rank twenty titles without ever
watching a spinner.

### Today (measured from the code, not guessed)

`apps/web/app/app/rate/[itemId]/finish-rating.tsx`

- `vote()` awaits `POST /api/rankings/:itemId/vote`, **then** awaits
  `GET /api/rankings/:itemId/matchup`, then calls `setOpponent`. Two serial
  round trips before pixels change; the compare cards are `disabled={busy}` for
  that whole window.
- The score in the header only moves when the vote response lands, and the
  opponent is picked server-side against the pre-vote Elo (`nextMatchup` in
  `lib/services/rankings.ts`).
- There is no prefetch: the first opponent comes from the server render in
  `rate/[itemId]/page.tsx`.
- `router.refresh()` runs only after undo, so a vote never does a full reload —
  good — but it also never refreshes anything else.

### UX flow (target: tap → next pair < 100 ms perceived)

1. On mount, the server render already supplies pair #1. The client fires
   `GET /api/rankings/:itemId/matchup?count=2` once, in an idle callback, to fill
   a two-deep opponent queue.
2. Tap a card. **Immediately** (synchronously, before any `fetch`):
   - swap in queue head as the visible opponent, animate the chosen card out;
   - show the pair as `pending` (dimmed "saving" pip, not a blocking spinner);
   - show a *provisional* score badge in the `saving` style — never a made-up
     Elo, just the last known score with a subtle "…".
3. `POST /vote` resolves: replace the provisional badge with the real score from
   the response, refill the queue from the tail of the last `matchup?count=2`
   response or a new one, clear `pending`.
4. Keyboard 1/2/3/4/S keeps working and must use the same optimistic path, with
   a per-press guard so a held key cannot double-vote.
5. Failure: roll the pair back to the one just answered, show the existing
   inline `error` slot, and re-enable the cards. No data loss, no silent state
   drift.

### Code surface

| Piece | File | Change |
| --- | --- | --- |
| Duel client | `apps/web/app/app/rate/[itemId]/finish-rating.tsx` | split `vote()` into `optimisticVote()` + `settleVote()`; add `queue: OpponentSide[]`, `pending: boolean`, `inFlight` ref; prefetch effect |
| Vote API | `apps/web/app/api/rankings/[itemId]/vote/route.ts` | unchanged contract; add optional `clientEventId` for idempotency |
| Matchup API | `apps/web/app/api/rankings/[itemId]/matchup/route.ts` | accept `?count=1..3`, return `{ opponents: [...] }` (keep `opponent` for compatibility) |
| Opponent choice | `lib/services/rankings.ts` (`nextMatchup`) | optional `exclude?: string[]` so a prefetched pair cannot repeat the one on screen |
| Server render | `apps/web/app/app/rate/[itemId]/page.tsx` | pass `initialOpponent` plus one prefetched opponent to skip the first fetch |

### API contract

```
GET /api/rankings/{itemId}/matchup?count=2&exclude={id1},{id2}
200 { "opponents": [ { "id", "kind", "title", "subtitle", "year", "imageUrl", "score" } ] }
409 NO_OPPONENTS  (fewer than one candidate after exclusion)

POST /api/rankings/{itemId}/vote
body { "opponentId": "uuid", "result": "win|loss|tie|undecided|skip", "clientEventId"?: "uuid" }
200  { "item": { "score": number, "elo": number }, "opponent": { ... }, "replayed"?: true }
409  MATCHUP_EXISTS (same clientEventId already applied — returns the same body)
```

### DB changes

None required. `item_matchups` already carries `event_id` (migration `0023`), so
idempotent replay can key off the event row instead of a new column:

```
alter table item_matchups add constraint item_matchups_event_uq unique (event_id);
```

Optional and additive; only needed if `clientEventId` ships.

### Effort

**M** (~1–1.5 days): one component rework, a `count`/`exclude` parameter, and
tests around double-submit. No migration, no worker.

### Riskiest implementation detail

**Prefetched opponents are chosen against a stale Elo.** `nextMatchup` picks by
current rating, so a queue filled before the vote can hand back an opponent that
the just-applied Elo change makes a poor comparison — or worse, the same pair
twice. Mitigation: refill the queue *after* each settle (not before), keep only
one prefetched opponent, and pass `exclude` with the currently visible ids. The
second risk is double-vote from a held key or an impatient double-tap: the
`busy` guard must become an in-flight ref keyed by `clientEventId`, or a replay
silently writes two matchup rows and moves Elo twice.

---

## 2. Re-rate and edit reviews

**User story.** As someone whose opinion changed, I can rewrite a review or
re-score one title with a single comparison — without redoing a duel and without
my edit history vanishing.

### Today

- `saveReview()` in `lib/services/social.ts` upserts the review columns straight
  onto `item_ratings` and writes one `rating_events` row (`kind: "review"`) with
  a ≤120-character detail. **The audit is right: only the current revision
  exists.** There is no `review_revisions` table and no previous text anywhere.
- Editing text is already score-free: `POST /api/rankings/:itemId/review` only
  touches review columns. What's missing is a *dedicated* edit path, history,
  and any UI entry point outside the rate screen.
- Re-scoring has two existing paths: the full duel (`/app/rate/[itemId]`), and
  `POST /api/rankings/:itemId/manual` (drag a slider to a number). Neither is
  "one new comparison": `manual` writes no matchup, so the model never sees it.

### UX flow — edit

1. Item page (`/app/item/[id]`) or review page gains **Edit review** for the
   author. Opens a sheet with text, tags, spoiler, photo, tracks, micro-picks —
   same fields as the rate screen, no score controls at all.
2. Save → `PATCH /api/rankings/{itemId}/review` → toast "Updated", page shows the
   new text, `updatedAt` moves, feed/profile cards pick it up on next read.
3. A small **History** link (author-only) lists revisions newest-first with the
   date and a diff-ish preview; **Restore** copies that revision forward as a new
   revision (never deletes history).
4. Moderation: if the rating is hidden/removed, the edit is refused with the same
   shape as a removed review — an edit must never un-remove content.

### UX flow — re-score with one comparison

1. Item page score block gains **"Re-check this score"**.
2. Server proposes one anchor: the nearest-ranked neighbour in the same kind
   (`{ anchor: { id, title, score, position } }`) with a "pick another" search.
3. One tap on *this one is better* / *the other one* / *too close* →
   `POST /api/rankings/{itemId}/recheck`. This **writes one matchup + one event**
   exactly like a duel vote, so the model, snapshots and undo all stay coherent.
4. Response returns the new score, the previous score, and both neighbours, so
   the UI can say "6.4 → 6.7, now above X".

### Code surface

| Piece | File | Change |
| --- | --- | --- |
| Edit route | `app/api/rankings/[itemId]/review/route.ts` (new `PATCH`) | review-only schema, no score/genre fields |
| History routes | `app/api/rankings/[itemId]/review/revisions/route.ts` (GET), `.../revisions/[revision]/restore/route.ts` (POST) | list + restore |
| Re-check route | `app/api/rankings/[itemId]/recheck/route.ts` (POST) | one matchup + event, returns score delta + neighbours |
| Service | `lib/services/reviews.ts` (new) or `social.ts` | `appendRevision()`, `listRevisions()`, `restoreRevision()`, `recheckScore()` |
| Score-only core | `lib/services/rankings.ts` (`submitVote`, line ~398) | expose the single-comparison primitive `recheckScore` reuses instead of duplicating Elo code |
| UI | `app/app/item/[id]/page.tsx` + new `components/review-editor.tsx`, `components/recheck-score.tsx` | entry points, sheet, history list |
| Public cache | `lib/revalidate-public.ts` | call on edit/restore (already exists, must be wired) |

### API contract

```
PATCH /api/rankings/{itemId}/review
body { text?, tags?, spoiler?, photoUrl?, videoUrl?, favoriteCharacter?,
       favoriteTracks?, subScores?, highlights? }   // no score, no elo, no matchups
200  { rating: { ..., revision: 3, updatedAt } }
403  PHOTO_LOCKED | REVIEW_REMOVED
404  ITEM_NOT_FOUND | RATING_NOT_FOUND

GET /api/rankings/{itemId}/review/revisions
200 { revisions: [ { revision, text, tags, spoiler, createdAt, current: boolean } ] }

POST /api/rankings/{itemId}/review/revisions/{revision}/restore
200 { rating: { ..., revision: 4 } }

GET  /api/rankings/{itemId}/recheck
200 { anchor: { id, title, year, score, position }, score: number }

POST /api/rankings/{itemId}/recheck
body { anchorId: "uuid", result: "win|loss|tie|undecided" }
200  { score: number, previousScore: number, elo: number, eventId: "uuid",
       neighbours: { above: {...}|null, below: {...}|null } }
409  ANCHOR_IS_SELF | NO_ANCHOR
```

### DB changes (migration `0027_review_revisions.sql`)

```sql
create table review_revisions (
  id            uuid primary key default gen_random_uuid(),
  rating_id     uuid not null references item_ratings(id) on delete cascade,
  org_id        uuid not null references orgs(id) on delete cascade,
  revision      int  not null,
  text          text,
  tags          jsonb not null default '[]',
  spoiler       boolean not null default false,
  photo_url     text,
  video_url     text,
  favorite_character text,
  favorite_tracks jsonb not null default '[]',
  sub_scores    jsonb not null default '{}',
  highlights    jsonb not null default '[]',
  editor_org_id uuid references orgs(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (rating_id, revision)          -- revision numbers cannot collide
);
create index review_revisions_rating_idx on review_revisions (rating_id, revision desc);
alter table review_revisions enable row level security;
create policy review_revisions_author on review_revisions
  using (org_id = current_setting('app.org_id', true)::uuid);
```

Backfill: one row per existing review at `revision = 1` where
`item_ratings.review_text is not null or review_tags <> '[]'`. Additive only.

### Effort

**M** (~2 days): migration + backfill is small; the real work is the editor UI,
the revision list, and making `recheckScore` reuse the vote primitive without
forking Elo logic. History-only (no restore) is an easy **S** slice to ship first.

### Riskiest implementation detail

**Revision numbering races.** A naive `select coalesce(max(revision),0)+1` in a
separate statement gives two concurrent edits the same number and the unique
constraint turns a save into a 500. Do it inside the same transaction as the
`item_ratings` update with `insert … select coalesce(max(revision),0)+1 … from
review_revisions where rating_id = $1` so the row lock on `item_ratings`
serialises it; on `23505`, retry once. Second risk: `saveReview` currently runs
`withOrg`, and RLS on the new table must be set the same way or the history reads
empty for everyone but the owner — the policy above depends on `app.org_id`,
which `withOrg` sets.

---

## 3. Social density

**User story.** As a reader, I can react with one tap to the emoji people
actually use, and once a week I get a screen telling me what my taste circle
loved — with the same "why" labels the feed already shows.

### Today

- `POST /api/ratings/:ratingId/react` (`toggleReaction` in `social.ts`) toggles a
  single emoji row in `rating_reactions` and returns the full summary. The DB is
  already right: `unique (rating_id, org_id, emoji)`.
- The UI has no fixed palette; there is no "top 5" query, no digest screen, and
  notifications are written on *add* only (`kind: "reaction"`).
- `feedForYou` already attaches `reason` labels from `rankFeed`
  (`followed | taste | popular | fresh`) — the digest should reuse exactly that.

### UX flow — one-tap reactions

1. On any review card, five emoji chips (🔥 ❤️ 😂 🤯 👏 as the default set, then
   personalised by the viewer's own history and the title's top reactions).
2. Tap → chip fills immediately (optimistic), request in flight; tap again →
   unfills. Counts are shown only when > 0 and update on the response.
3. Palette source: `GET /api/reactions/palette?kind=movie` → top 5 by count over
   the last 30 days for that kind, falling back to the default set. Cache 10
   minutes.

### UX flow — weekly digest

1. New `/app/digest` screen, linked from the home header, titled "What your taste
   circle loved".
2. Server builds it from followed accounts' reviews in the last 7 days, ranked
   with the existing `rankFeed` + `diversifyRankedFeed`, and renders the same
   `reason` label the feed uses (`From someone you follow`, `Matches your taste`).
3. Sections: top three with reason chips, "most argued-about" (highest
   comments/reactions per review), "one you missed" (high score in your top
   genre, no rating from you).
4. Empty state: "Follow a few people to see this" with a link to the feed.

### Code surface

| Piece | File | Change |
| --- | --- | --- |
| Palette API | `app/api/reactions/palette/route.ts` (new) | top-5 query, cached |
| Reaction UI | `components/review-engagement.tsx` | optimistic chips, palette fetch |
| Digest screen | `app/app/digest/page.tsx` (new), `components/digest-screen.tsx` | server component, reuses feed reasons |
| Digest service | `lib/services/social.ts` (new `weeklyDigest()`) | same query shape as `feedForYou`, `createdAt >= now() - 7d` |
| Notifications | `lib/services/social.ts` `toggleReaction` | de-duplicate: one unread `reaction` notification per (owner, actor, item) per 24h |

Push when offline is **PROMPT 11**, explicitly out of scope here; it needs a
web-push subscription table and a sender, neither of which exists yet. The
notification row this feature writes is the input to that.

### API contract

```
GET /api/reactions/palette?kind=movie
200 { emojis: ["🔥","❤️","😂","🤯","👏"], source: "popular" | "default" }

POST /api/ratings/{ratingId}/react
body { emoji: "🔥" }
200  { reacted: true, reactions: [ { emoji, count, mine } ] }
429  RATE_LIMITED (existing 60/minute window)

GET /app/digest            (server component; no JSON contract)
```

### DB changes

None for v1. Palettes are computed. If reaction volume makes the palette query
hot, add a materialised rollup later:

```sql
-- only if measured as slow
create materialized view reaction_daily as
  select date_trunc('day', created_at) as day, rating_id, emoji, count(*) as n
  from rating_reactions group by 1,2,3;
```

The digest needs no table: it is a read model over `item_ratings` + `follows`,
computed per request with the same limit as the feed (≤ 48 rows read).

### Effort

**S** for one-tap reactions with the top-5 palette (~half a day: one route, one
component, one cached query). **M** for the digest screen (~1.5 days). **L** for
the push notification (PROMPT 11; needs subscriptions, a sender, and a worker
queue).

### Riskiest implementation detail

**Notification fan-out on a popular title.** `toggleReaction` inserts a
notification per reaction; a title with 2k raters turns one tap into a write per
tap, and toggling off leaves the old notification behind. Fix: insert with
`on conflict do nothing` against a partial unique index on
`(org_id, actor_org_id, kind, item_id)` for unread reaction rows created in the
last day, and delete the notification when the reaction is removed. Without that,
the digest and any future push both amplify noise instead of signal.

---

## 4. Recommendations v1 (co-occurrence)

**User story.** As someone with ratings, I see a feed slot that says *Because you
rated Parasite* and shows something I have not rated — and we can measure whether
anyone taps it.

### Today

- `feedForYou` (`social.ts`) ranks by followed/taste/popular/fresh via
  `rankFeed` in `packages/core/src/feed-rank.ts`; reasons are the four labels
  above. There is no item-to-item similarity anywhere.
- `item_matchups` already stores `(org_id, item_id, opponent_id, result)`, which
  is exactly the co-occurrence signal: two titles that people compare in a duel
  are, by construction, alternatives.
- Nothing records impressions or clicks. `feed_dismissals` is the only feed
  interaction row.

### Signal design (no matrix factorisation)

```
co-occurrence(item A, item B) =
    log(1 + duels(A,B))                 -- from item_matchups, either direction
  + 0.5 * log(1 + shared_raters(A,B))   -- orgs with a rating on both
  + 0.25 * same_kind(A,B)               -- tie-breaker, not a filter

candidate score(A) = Σ over B in my_rating_anchors(co_occurrence(A,B)
                    * normalised_score(B) * recency_decay(B))
```

Anchors are the viewer's own ratings with score ≥ 7 (max 20, newest first).
Candidates exclude anything the viewer rated, watched, dismissed, or that is
`enrichment_status = 'failed'`. Return the top anchor per candidate so the UI can
say "Because you rated X".

### UX flow

1. The For-you feed gains a **"Because you rated …"** card between ranked reviews
   (every ~5th slot) with the anchor's artwork as a small badge.
2. Tapping the card opens the item page with a `?from=feed&anchor=<id>` marker.
3. Every rendered feed slot records an impression (`feed_events.kind =
   'impression'`), the card records `click`, dismiss maps to the existing
   dismissal plus a `dismiss` event.
4. CTR per surface/reason is queryable the same day: `clicks / impressions` by
   `surface` and `reason_code`.

### Code surface

| Piece | File | Change |
| --- | --- | --- |
| Co-occurrence service | `lib/services/recommendations.ts` (new) | `becauseYouRated(orgId, limit)` + `coOccurrence(itemId, kind, limit)` |
| Feed integration | `lib/services/social.ts` `feedForYou` | optional `because` slots; attach `anchor` to `ReviewView` |
| Reason vocabulary | `packages/core/src/feed-rank.ts` | add `because` to `FeedReasonCode` + label builder taking the anchor title |
| Feed card | `components/podiums.tsx` (`ReviewCard`, already renders `reason`) | anchor badge + link marker |
| Event route | `app/api/feed/events/route.ts` (new) | batched impressions + single clicks |
| Digest reuse | `lib/services/social.ts` `weeklyDigest` | can reuse the same anchor slot |

### API contract

```
GET /api/feed?surface=for-you            (existing server render; no new contract)
POST /api/feed/events
body { events: [ { kind: "impression|click|dismiss", surface: "feed|digest|because",
                   ratingId?, itemId?, reasonCode?, anchorItemId?, sessionId } ] }   // ≤ 50
202  { accepted: number }
400  INVALID_EVENT
```

### DB changes (migration `0028_feed_events.sql`)

```sql
create table feed_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  session_id   text not null,
  surface      text not null check (surface in ('feed','digest','because')),
  kind         text not null check (kind in ('impression','click','dismiss')),
  reason_code  text,
  item_id      uuid references catalog_items(id) on delete set null,
  rating_id    uuid references item_ratings(id) on delete set null,
  anchor_item_id uuid references catalog_items(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index feed_events_ctr_idx on feed_events (surface, kind, created_at);
create index feed_events_org_idx on feed_events (org_id, created_at);
alter table feed_events enable row level security;
create policy feed_events_owner on feed_events
  using (org_id = current_setting('app.org_id', true)::uuid);

-- co-occurrence support: the pair lookup is by item, both directions
create index if not exists item_matchups_pair_idx on item_matchups (item_id, opponent_id);
create index if not exists item_matchups_opponent_idx on item_matchups (opponent_id, item_id);
```

### Effort

**M** (~2.5 days): the SQL is the easy half; the cost is (a) the co-occurrence
query not being a table scan, (b) impression batching so a feed render is one
request, not twenty, (c) wiring the reason label without forking the ranker.
Slicing: `feed_events` + impression/click first (**S**), the slot second (**S**),
co-occurrence quality tuning last (**M**).

### Riskiest implementation detail

**CTR that measures nothing.** Impressions are easy to over-count (re-render,
prefetch, bot) and clicks are easy to under-count (navigation cancels a beacon),
so a naive `clicks/impressions` produces numbers no one should trust. Send
impressions once per (sessionId, itemId) with `navigator.sendBeacon` on
visibility, dedupe server-side on `(org_id, session_id, item_id, kind,
date_trunc('hour', created_at))`, and report CTR per surface rather than as one
global number. Second risk: the co-occurrence query on a large `item_matchups`
without `(item_id, opponent_id)` indexes degrades to a full scan inside the feed
render — the migration must land before the slot is enabled.

---

## Ship order and why

| # | Feature | Effort | Why now |
| --- | --- | --- | --- |
| 1 | Instant rating | M | Highest-frequency screen; no migration; the 100 ms target is achievable with a queue + optimistic swap. |
| 2 | Re-rate + edit | M | The explicit Podiums complaint. History is additive and reversible; the editor reuses the rate screen's fields. |
| 3a | One-tap reactions | S | Cheapest social-density win: one route, one query, one component. |
| 4 | Recommendations v1 | M | Needs `feed_events` to prove itself; build events first, ship the slot behind it. |
| 3b | Weekly digest | M | Rides on feed ranking that already exists; no DB change. |
| 3c | Offline push | L | PROMPT 11 — needs subscriptions + sender, deliberately out of scope. |

Rationale: 1 and 2 change *how often people rate*, which is the input everything
else (feed, recommendations, digest) consumes. 4's measurement table is also the
foundation for judging 3b, so events ship before the co-occurrence slot is
turned on.

## Cross-cutting risks

- **RLS on every new table.** `review_revisions` and `feed_events` must follow
  the `current_setting('app.org_id')` pattern or `withOrg` reads return nothing.
- **Public cache invalidation.** Edits and restores must call
  `revalidatePublicReview` / `revalidatePublicProfile`, or the public review page
  serves stale text for up to its revalidate window.
- **Feed payload growth.** Adding anchors and impressions to a 12-item feed must
  stay one query round trip; batch both.
