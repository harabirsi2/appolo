-- Catalog scale: provider-first enrichment, rateable entities, duplicate merges.
--
-- Everything here is additive. Existing catalog_items rows stay valid
-- "entity rows" of type 'item', so item_ratings/item_matchups keep their
-- foreign keys and no rating is rewritten or re-pointed by this migration.

/* ------------------------------------------------------------------ */
/* 1. Enrichment queue (durable outbox behind BullMQ)                  */
/* ------------------------------------------------------------------ */

create table if not exists public.catalog_enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  /** Provider identity of the row to upgrade, e.g. `rawg:3498`. */
  external_ref text not null,
  source text not null,
  kind public.media_kind not null,
  /** Candidate as the provider returned it, so the worker needs no re-search. */
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  /** Exponential backoff target; a row is only claimable once this passes. */
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One queue row per provider object: a second search for the same title
-- enqueues nothing new.
create unique index if not exists catalog_enrichment_external_uq
  on public.catalog_enrichment_queue(source, external_ref);

-- The sweeper's query: due work, oldest first.
create index if not exists catalog_enrichment_due_idx
  on public.catalog_enrichment_queue(status, next_attempt_at);

/* ------------------------------------------------------------------ */
/* 2. Entity model: artists, seasons, episodes are rateable rows       */
/* ------------------------------------------------------------------ */

/**
 * A rateable entity always has a `catalog_items` row, which is what
 * item_ratings.item_id and item_matchups.item_id/opponent_id point at. The
 * subtype tables below attach the extra structure to that row 1:1, so ranking
 * code (Elo, the Bradley-Terry fit, the JSON snapshots) needs no change at all.
 */
alter table public.catalog_items
  add column if not exists entity_type text not null default 'item'
    check (entity_type in ('item', 'artist', 'season', 'episode'));
/** pending | ready | failed — pending rows render immediately, then upgrade. */
alter table public.catalog_items
  add column if not exists enrichment_status text not null default 'ready'
    check (enrichment_status in ('pending', 'ready', 'failed'));
/** Set on a row that was merged into another one (audit trail; null otherwise). */
alter table public.catalog_items
  add column if not exists canonical_item_id uuid references public.catalog_items(id) on delete set null;
/** Lowercased, punctuation-free title used for duplicate clustering. */
alter table public.catalog_items
  add column if not exists normalized_title text;

update public.catalog_items
   set normalized_title = lower(regexp_replace(title, '[^[:alnum:]]+', '', 'g'))
 where normalized_title is null;

create index if not exists catalog_items_normalized_title_idx
  on public.catalog_items(kind, normalized_title, year);
create index if not exists catalog_items_enrichment_idx
  on public.catalog_items(enrichment_status) where enrichment_status <> 'ready';

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  /** The rateable row this artist is ranked through. */
  catalog_item_id uuid not null unique references public.catalog_items(id) on delete cascade,
  name text not null,
  external_ref text unique,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists artists_name_idx on public.artists(lower(name));

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null unique references public.catalog_items(id) on delete cascade,
  /** The series this season belongs to. */
  parent_item_id uuid not null references public.catalog_items(id) on delete cascade,
  season_number integer not null check (season_number >= 0),
  title text,
  year integer,
  image_url text,
  created_at timestamptz not null default now(),
  unique (parent_item_id, season_number)
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null unique references public.catalog_items(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  episode_number integer not null check (episode_number >= 0),
  title text,
  air_date date,
  runtime integer,
  created_at timestamptz not null default now(),
  unique (season_id, episode_number)
);

/** Credit links: an item can name its artists/developers. */
create table if not exists public.item_artists (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary', 'featured', 'author', 'developer')),
  position integer not null default 0,
  primary key (item_id, artist_id, role)
);

/**
 * One reading surface for "anything you can rate". Elo and the rankings keep
 * reading catalog_items directly; this view exists for discovery, season
 * listings and the merge tooling.
 */
create or replace view public.rateable_entities as
select
  ci.id,
  ci.entity_type,
  ci.kind,
  ci.title,
  ci.subtitle,
  ci.year,
  ci.image_url,
  ci.enrichment_status,
  a.id as artist_id,
  a.name as artist_name,
  s.id as season_id,
  s.season_number,
  s.parent_item_id,
  e.id as episode_id,
  e.season_id as episode_season_id,
  e.episode_number
from public.catalog_items ci
left join public.artists a on a.catalog_item_id = ci.id
left join public.seasons s on s.catalog_item_id = ci.id
left join public.episodes e on e.catalog_item_id = ci.id;

/* ------------------------------------------------------------------ */
/* 3. Duplicate merges                                                 */
/* ------------------------------------------------------------------ */

create table if not exists public.catalog_item_merges (
  id uuid primary key default gen_random_uuid(),
  /** No FK: the source row is deleted by the merge. */
  source_item_id uuid not null,
  target_item_id uuid not null references public.catalog_items(id) on delete cascade,
  moved_ratings integer not null default 0,
  merged_ratings integer not null default 0,
  moved_matchups integer not null default 0,
  dropped_matchups integer not null default 0,
  merged_at timestamptz not null default now()
);
create index if not exists catalog_item_merges_target_idx
  on public.catalog_item_merges(target_item_id, merged_at desc);

/**
 * Fold `source_id` into `target_id`, keeping every rating.
 *
 * - A rating the target does not have is re-pointed unchanged: Elo, match
 *   counters, review text and moderation state all survive as they were.
 * - When both rows have a rating for the same org, the target's row wins and
 *   the duplicate is deleted (the two cannot be averaged meaningfully).
 * - Matchups move; comparisons that would become self-comparisons are dropped
 *   (they carry no signal once both sides are the same title).
 * - Rows that are unique per (org, item) — ranking order, watchlist, pod items —
 *   move only where the target has no row, then the leftovers are deleted.
 */
-- SECURITY DEFINER on purpose: a merge must re-point every org's ratings, and
-- the web connection runs under tenant RLS. The owner bypasses RLS, the
-- function is narrowly scoped, and execute is granted to appolo_app below.
create or replace function public.merge_catalog_items(source_id uuid, target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_ratings integer := 0;
  merged_ratings integer := 0;
  moved_matchups integer := 0;
  dropped_matchups integer := 0;
begin
  if source_id = target_id then
    raise exception 'merge_catalog_items: source and target are the same row';
  end if;

  -- Lock in id order so two concurrent merges cannot deadlock.
  perform 1 from public.catalog_items where id = least(source_id, target_id) for update;
  perform 1 from public.catalog_items where id = greatest(source_id, target_id) for update;

  update public.item_ratings r
     set item_id = target_id
   where r.item_id = source_id
     and not exists (
       select 1 from public.item_ratings t
        where t.org_id = r.org_id and t.item_id = target_id
     );
  get diagnostics moved_ratings = row_count;

  delete from public.item_ratings r where r.item_id = source_id;
  get diagnostics merged_ratings = row_count;

  delete from public.item_matchups
   where (item_id = source_id and opponent_id = target_id)
      or (item_id = target_id and opponent_id = source_id);
  get diagnostics dropped_matchups = row_count;

  update public.item_matchups
     set item_id = case when item_id = source_id then target_id else item_id end,
         opponent_id = case when opponent_id = source_id then target_id else opponent_id end
   where item_id = source_id or opponent_id = source_id;
  get diagnostics moved_matchups = row_count;

  update public.ranking_order o
     set item_id = target_id
   where o.item_id = source_id
     and not exists (
       select 1 from public.ranking_order t
        where t.org_id = o.org_id and t.kind = o.kind and t.item_id = target_id
     );
  delete from public.ranking_order where item_id = source_id;

  update public.watchlist w
     set item_id = target_id
   where w.item_id = source_id
     and not exists (
       select 1 from public.watchlist t where t.org_id = w.org_id and t.item_id = target_id
     );
  delete from public.watchlist where item_id = source_id;

  update public.pod_items p
     set item_id = target_id
   where p.item_id = source_id
     and not exists (
       select 1 from public.pod_items t where t.pod_id = p.pod_id and t.item_id = target_id
     );
  delete from public.pod_items where item_id = source_id;

  update public.rating_events set item_id = target_id where item_id = source_id;
  update public.catalog_credits set item_id = target_id where item_id = source_id;

  insert into public.catalog_item_merges
    (source_item_id, target_item_id, moved_ratings, merged_ratings, moved_matchups, dropped_matchups)
  values (source_id, target_id, moved_ratings, merged_ratings, moved_matchups, dropped_matchups);

  delete from public.catalog_items where id = source_id;

  return jsonb_build_object(
    'sourceId', source_id,
    'targetId', target_id,
    'movedRatings', moved_ratings,
    'mergedRatings', merged_ratings,
    'movedMatchups', moved_matchups,
    'droppedMatchups', dropped_matchups
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. Grants (catalog tables are shared, not tenant-scoped)            */
/* ------------------------------------------------------------------ */

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on
      public.artists, public.seasons, public.episodes, public.item_artists,
      public.catalog_enrichment_queue, public.catalog_item_merges
      to appolo_app;
    grant select on public.rateable_entities to appolo_app;
    grant execute on function public.merge_catalog_items(uuid, uuid) to appolo_app;
  end if;
end $$;
