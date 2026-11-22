# Catalog scale

How the shared title catalog grows from a few hundred seeded rows to a real
library without ever making a search wait on a third party, and without losing a
single rating.

## 1. Provider-first flow

```
   ┌─────────────┐  local rows (always)      ┌──────────────┐
   │  /search    │ ────────────────────────▶ │ user sees    │
   └──────┬──────┘                           │ results now  │
          │ provider hits (deadline-bounded) └──────────────┘
          ▼
 ┌────────────────────────────────────┐
 │ catalog_items  enrichment_status=  │   rankable immediately;
 │                'pending'           │   provider cover hotlinked
 └────────────────┬───────────────────┘
                  │ one row per hit, unique (source, external_ref)
                  ▼
 ┌────────────────────────────────────┐
 │ catalog_enrichment_queue (pending) │  ← durable outbox (Postgres)
 └────────────────┬───────────────────┘
                  │
        sweeper (every 30s, and once on boot)
                  │  select … where status='pending' and next_attempt_at <= now()
                  ▼
 ┌────────────────────────────────────┐
 │ BullMQ "catalog-enrichment"        │  jobId = queue row id (dedupes)
 │ limiter max N per 60s              │  concurrency 3
 └────────────────┬───────────────────┘
                  ▼
 ┌────────────────────────────────────┐
 │ processor: claim row (atomic       │
 │ update … returning), load provider │
 │ details, cache the cover, then for │
 │ TV: episodes for ≤N seasons (one   │
 │ request each), then entity rows    │
 └────────────────┬───────────────────┘
        success   │   failure
        ┌─────────┴──────────┐
        ▼                    ▼
 status='done'        attempts+=1, next_attempt_at = now + min(3600, 30·2^n)s
 item enrichment_     status='pending' (retry) … 'failed' after 6 attempts
 status='ready'       and the item flips to enrichment_status='failed'
```

Why a table *and* a queue: BullMQ gives concurrency, a rate limiter and
visibility; the table gives durability. A dropped job, a Redis restart or a
worker crash is repaired by the next sweep, and `locked_at` older than 15
minutes is reclaimed. A worker that is offline entirely still loses nothing —
the outbox simply accumulates.

*Cover caching.* The first insert keeps the provider's HTTPS URL so the result
renders instantly. The worker downloads the bytes once, stores them under
`CATALOG_CACHE_DIR` (default `apps/web/public/cache/covers`) named by SHA-256
and rewrites `image_url`/`cover_url` to `CACHE_PUBLIC_PATH`. Same artwork, same
file, no repeated downloads, no hotlink rot.

## 2. Rate limits

| Where | Setting | Default | Why |
| --- | --- | --- | --- |
| Request path | `CATALOG_PROVIDER_REQ_PER_MIN` | 60 | shared per instance, stays under every provider plan |
| Worker | `CATALOG_WORKER_REQ_PER_MIN` | 60 | BullMQ rolling-window `limiter` |
| Attempts | `CATALOG_MAX_ATTEMPTS` | 6 | 30s → 60 → 120 → … capped at 1h |
| Episodes | `CATALOG_SEASON_FETCH_LIMIT` | 10 | per-season episode requests per TV item; `0` disables episodes |

The limiter counts *jobs*, not provider calls, and one TV job may spend
`1 + CATALOG_SEASON_FETCH_LIMIT` calls (details + one per season). Budget for
that when raising `CATALOG_WORKER_REQ_PER_MIN`, or lower the season limit.

Raising the request-path cap is a single env change; it is separate from the
worker cap on purpose, because the two run in different processes and each has
its own quota view.

## 3. Entity model

Anything rateable is a `catalog_items` row, so `item_ratings.item_id` and
`item_matchups.item_id/opponent_id` keep pointing at the same table they always
did.

```
catalog_items (entity_type: item | artist | season | episode)
   ▲ 1:1            ▲ 1:1                ▲ 1:1
   │                │                    │
 artists          seasons ── parent_item_id ──▶ catalog_items (the series)
                     │ 1:N
                  episodes
   └── item_artists(item_id, artist_id, role)  ── credits

rateable_entities  =  catalog_items LEFT JOIN artists/seasons/episodes
```

Artists, seasons and episodes are created by writing their `catalog_items` row
first (title, image, year, kind = music/tv) and then the subtype row that
points back at it, in one transaction. Nothing in the ranking model, the Elo
maths or the snapshots needed to change.

Source of each entity, per provider:

| Entity | Comes from | Cost |
| --- | --- | --- |
| Artist | `details().credits` (cast, director, author, developer) | free, embedded |
| Season | `details().metadata.seasonList`, falling back to `number_of_seasons` shells | free, embedded |
| Episode | `seasonEpisodes(candidate, seasonNumber)` (`/tv/{id}/season/{n}`) | one request per season, capped |

Episodes are the only entity that needs its own call, so the worker asks for at
most `CATALOG_SEASON_FETCH_LIMIT` seasons per item and a failed season is
skipped rather than failing the item. `materializeEntities` is idempotent, so a
later run fills in seasons the cap skipped once the limit is raised.

## 4. Games provider: RAWG

Chosen over IGDB for a solo dev:

| | RAWG | IGDB |
| --- | --- | --- |
| Key | email signup, instant | Twitch developer app + client-credentials token exchange |
| Free tier | 20 000 req/month | 4 req/s, no published monthly cap |
| Search payload | cover, release date, genres, platforms | similar, but needs a second call for artwork |
| Auth complexity | `?key=` query param | OAuth token refresh, `Client-ID` + `Authorization` headers |
| ToS | "Powered by RAWG" credit | data-source credit requirements |

`RAWG_API_KEY` + `CATALOG_PROVIDERS=…,rawg` enables it in both the web search
and the worker; the core adapter (`packages/core/src/metadata/rawg.ts`) already
provides search *and* details, so the worker upgrades a game exactly like a
film.

## 5. Duplicates

Detection (`apps/web/lib/services/catalog-merge.ts` → `findDuplicates`) buckets
rows by `kind + titleKey(title)` and scores each pair:

1. same `external_ref` → duplicate (score 1)
2. same normalized title **and** year → duplicate
3. token Jaccard ≥ 0.86 after a year adjustment → duplicate; a year gap of 2+
   halves the score, so remakes never merge

Note `catalog_items_kind_title_uq` is `(kind, title, subtitle)`: duplicates
exist precisely because providers disagree on the subtitle, which is why
detection cannot rely on that constraint.

Merging is `merge_catalog_items(source, target)` in SQL (SECURITY DEFINER, so
it can re-point every org's rows while the web connection runs under tenant
RLS):

- a rating the target lacks is re-pointed **unchanged** (Elo, matches, review
  text, moderation state);
- a rating both rows have collapses onto the target's row, the duplicate is
  deleted;
- matchups move, self-comparisons are dropped;
- `ranking_order`, `watchlist`, `pod_items` move only where the target has no
  row, then leftovers are deleted;
- `rating_events` and `catalog_credits` are re-pointed;
- an audit row lands in `catalog_item_merges`.

Run a dry pass first (`findDuplicates`), then merge by id. Every merge is
reversible in the sense that the audit row records what moved and how many
ratings, but the source row itself is gone.

## 6. What breaks for existing ratings

Nothing. Proof: `packages/db/src/catalog-merge-test.ts` (13 assertions, all
passing — run `pnpm --filter @appolo/db merge-test`).

The migration is additive (`0025`):

- no existing column is dropped or retyped; `catalog_items` gains `entity_type`,
  `enrichment_status`, `canonical_item_id`, `normalized_title`, all with
  defaults and a backfill for `normalized_title`;
- `item_ratings.item_id` and `item_matchups.item_id/opponent_id` are untouched,
  so every existing row keeps its FK and its meaning;
- new tables are new; `rateable_entities` is a view;
- the only executable change is the merge function, which is not called by any
  read path.

The test merges two real duplicate rows with three ratings across two orgs and
proves: Elo 1712 preserved, duplicate-only rating re-pointed, untouched org
untouched, review text intact, no rating left pointing at a deleted row, the
self-matchup dropped, the merge audited, and a second merge of the same pair
raising instead of silently doing nothing.
