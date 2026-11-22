-- Keep catalog community aggregates in step with moderation.
--
-- The 0018 score trigger only listened for Elo/item changes, so hiding or
-- removing a review left its rating in catalog_items.bayesian_score and
-- total_reviews while the public item feed excluded it.
--
-- Public reads require both the rating and its author's profile to be
-- visible (see itemCommunity in lib/services/social.ts), so the aggregate
-- applies the same predicate. Hiding a profile also recomputes every item
-- that profile rated.

create or replace function public.appolo_recompute_item_score(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_mean numeric;
  v_category numeric;
  v_bayesian numeric;
begin
  select count(*), avg(greatest(0, least(10, (ir.elo - 1200) / 60.0)))
    into v_count, v_mean
    from public.item_ratings ir
    join public.profiles p on p.org_id = ir.org_id
   where ir.item_id = p_item
     and ir.moderation_status = 'visible'
     and p.moderation_status = 'visible';

  if v_count = 0 then
    update public.catalog_items
       set bayesian_score = null, total_reviews = 0
     where id = p_item;
    return;
  end if;

  select coalesce(avg(greatest(0, least(10, (ir.elo - 1200) / 60.0))), 5)
    into v_category
    from public.item_ratings ir
    join public.profiles p on p.org_id = ir.org_id
    join public.catalog_items ci on ci.id = ir.item_id
   where ci.kind = (select kind from public.catalog_items where id = p_item)
     and ir.moderation_status = 'visible'
     and p.moderation_status = 'visible';

  v_bayesian := (v_count * v_mean + 5 * coalesce(v_category, 5)) / (v_count + 5);

  update public.catalog_items
     set bayesian_score = round(v_bayesian, 1), total_reviews = v_count
   where id = p_item;
end;
$$;

-- Recompute every item one profile has rated (used when the profile's own
-- moderation state changes).
create or replace function public.appolo_recompute_org_item_scores(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
begin
  for v_item in
    select distinct item_id from public.item_ratings where org_id = p_org
  loop
    perform public.appolo_recompute_item_score(v_item);
  end loop;
end;
$$;

-- A rating can move between items, so an update has to refresh both sides.
create or replace function public.appolo_item_rating_score_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.item_id is distinct from old.item_id then
    perform public.appolo_recompute_item_score(old.item_id);
  end if;
  perform public.appolo_recompute_item_score(coalesce(new.item_id, old.item_id));
  return null;
end;
$$;

create or replace function public.appolo_profile_moderation_score_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.moderation_status is not distinct from old.moderation_status then
    return null;
  end if;
  perform public.appolo_recompute_org_item_scores(coalesce(new.org_id, old.org_id));
  return null;
end;
$$;

drop trigger if exists item_ratings_score_trigger on public.item_ratings;
create trigger item_ratings_score_trigger
after insert or update of elo, item_id, org_id, moderation_status or delete on public.item_ratings
for each row execute function public.appolo_item_rating_score_trigger();

drop trigger if exists profiles_moderation_score_trigger on public.profiles;
create trigger profiles_moderation_score_trigger
after update of moderation_status or delete on public.profiles
for each row execute function public.appolo_profile_moderation_score_trigger();

select public.appolo_recompute_item_score(id) from public.catalog_items;
