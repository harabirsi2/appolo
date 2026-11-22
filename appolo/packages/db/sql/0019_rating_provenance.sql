-- Rating provenance.
--
-- New ratings say where the score came from. Existing rows are deliberately
-- left NULL: before this migration a Spotify top-track import and a user's
-- manual score were stored identically. Backfilling every old row as 'user'
-- would repeat that lie, and backfilling every old music row as Spotify would
-- discard legitimate ratings. NULL therefore means "legacy, unknown origin".
--
-- No rows are deleted or rewritten here. The view below is a read-only list of
-- likely legacy Spotify imports for a human or operator to review. A confirmed
-- row can be re-rated by its owner, which sets source = 'user'.

alter table public.item_ratings
  add column if not exists source text;

comment on column public.item_ratings.source is
  'How the score was created: user, letterboxd, goodreads, or spotify_import_legacy. NULL means the row predates provenance.';

alter table public.item_ratings
  drop constraint if exists item_ratings_source_check;

alter table public.item_ratings
  add constraint item_ratings_source_check
  check (
    source is null
    or source in ('user', 'letterboxd', 'goodreads', 'spotify_import_legacy')
  );

create index if not exists item_ratings_source_idx
  on public.item_ratings(source)
  where source is not null;

-- Likely old Spotify rows: a music item whose only history is an "Imported:"
-- event, with no matchup, review, photo, favourite, sub-score or highlight of
-- its own. This is evidence, not an automatic verdict: the list is read-only
-- and may contain a manual rating that happened to share the same footprint.
create or replace view public.legacy_spotify_import_candidates
with (security_invoker = true)
as
select
  ir.id as rating_id,
  ir.org_id,
  ir.item_id,
  ci.title,
  ci.subtitle,
  ir.manual_score,
  ir.elo,
  ir.created_at
from public.item_ratings ir
join public.catalog_items ci on ci.id = ir.item_id
where ir.source is null
  and ci.kind = 'music'
  and ir.matches = 0
  and ir.review_text is null
  and ir.review_tags = '{}'::text[]
  and ir.photo_url is null
  and ir.video_url is null
  and ir.favorite_character is null
  and ir.favorite_tracks = '{}'::text[]
  and ir.sub_scores = '{}'::jsonb
  and ir.highlights = '{}'::jsonb
  and exists (
    select 1
    from public.rating_events re
    where re.org_id = ir.org_id
      and re.item_id = ir.item_id
      and re.kind = 'manual'
      and re.detail like 'Imported:%'
  )
  and not exists (
    select 1
    from public.rating_events re
    where re.org_id = ir.org_id
      and re.item_id = ir.item_id
      and not (re.kind = 'manual' and re.detail like 'Imported:%')
  )
  and not exists (
    select 1
    from public.item_matchups im
    where im.org_id = ir.org_id
      and (im.item_id = ir.item_id or im.opponent_id = ir.item_id)
  );

comment on view public.legacy_spotify_import_candidates is
  'Read-only audit list of ratings likely created by the old Spotify top-track import. No row is changed or deleted.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select on public.legacy_spotify_import_candidates to appolo_app;
  end if;
end $$;
