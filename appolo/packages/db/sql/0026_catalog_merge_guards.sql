-- Guard the merge function: merging a row that does not exist must fail loudly
-- instead of silently returning zero counts.
--
-- 0025 shipped the function without the existence checks; this migration
-- replaces it in place (same signature, same body plus the guards).

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

  if not exists (select 1 from public.catalog_items where id = source_id) then
    raise exception 'merge_catalog_items: source row % does not exist', source_id;
  end if;
  if not exists (select 1 from public.catalog_items where id = target_id) then
    raise exception 'merge_catalog_items: target row % does not exist', target_id;
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant execute on function public.merge_catalog_items(uuid, uuid) to appolo_app;
  end if;
end $$;
