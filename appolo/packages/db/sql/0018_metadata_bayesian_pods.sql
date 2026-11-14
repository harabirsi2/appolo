-- Live metadata, exact manual scores, Bayesian community scores, collaborative pods.
--
-- `catalog_items` is the shared public catalog, so provider ids/artwork live on
-- it. Community scores are denormalised there and kept current by a trigger on
-- `item_ratings`; the rating table stays the source of truth.

alter table public.catalog_items
  add column if not exists external_id text,
  add column if not exists source text,
  add column if not exists cover_url text,
  add column if not exists backdrop_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists bayesian_score numeric(3,1),
  add column if not exists total_reviews integer not null default 0;

create unique index if not exists catalog_items_source_external_uq
  on public.catalog_items(source, external_id)
  where external_id is not null;

alter table public.item_ratings
  add column if not exists manual_score numeric(3,1),
  add column if not exists sub_scores jsonb not null default '{}'::jsonb,
  add column if not exists highlights jsonb not null default '{}'::jsonb;

alter table public.pods
  add column if not exists is_collaborative boolean not null default false;

create table if not exists public.pod_members (
  id uuid primary key default gen_random_uuid(),
  pod_id uuid not null references public.pods(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null default 'viewer',
  created_at timestamptz not null default now()
);

create unique index if not exists pod_members_pod_org_uq
  on public.pod_members(pod_id, org_id);
create index if not exists pod_members_pod_idx on public.pod_members(pod_id, role);
create index if not exists pod_members_org_idx on public.pod_members(org_id);

alter table public.pod_members enable row level security;
alter table public.pod_members force row level security;

drop policy if exists tenant_isolation on public.pod_members;
create policy tenant_isolation on public.pod_members
  using (
    org_id = nullif(current_setting('app.org_id', true), '')::uuid
    or exists (
      select 1 from public.pods p
      where p.id = pod_id
        and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
    )
  )
  with check (
    org_id = nullif(current_setting('app.org_id', true), '')::uuid
    or exists (
      select 1 from public.pods p
      where p.id = pod_id
        and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
    )
  );

drop policy if exists pod_members_public_read on public.pod_members;
create policy pod_members_public_read on public.pod_members
  for select using (
    nullif(current_setting('app.org_id', true), '') is null
    and exists (
      select 1 from public.pods p
      where p.id = pod_id and p.visibility = 'public'
    )
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.pod_members to appolo_app;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Bayesian community score
-- ---------------------------------------------------------------------------
-- Personal score is the same continuous Elo mapping used by the app:
--   score = clamp((elo - 1200) / 60, 0, 10)
-- Then, with v = number of ratings for the item, R = their mean, m = 5 and
-- C = the mean score across the item's media category:
--   bayesian = (v * R + m * C) / (v + m)
-- The function is SECURITY DEFINER so the aggregate can see every profile's
-- rating while the API role still cannot read other orgs' rows directly.
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
  select count(*), avg(greatest(0, least(10, (elo - 1200) / 60.0)))
    into v_count, v_mean
    from public.item_ratings
   where item_id = p_item;

  if v_count = 0 then
    update public.catalog_items
       set bayesian_score = null, total_reviews = 0
     where id = p_item;
    return;
  end if;

  select coalesce(avg(greatest(0, least(10, (ir.elo - 1200) / 60.0))), 5)
    into v_category
    from public.item_ratings ir
    join public.catalog_items ci on ci.id = ir.item_id
   where ci.kind = (select kind from public.catalog_items where id = p_item);

  v_bayesian := (v_count * v_mean + 5 * coalesce(v_category, 5)) / (v_count + 5);

  update public.catalog_items
     set bayesian_score = round(v_bayesian, 1), total_reviews = v_count
   where id = p_item;
end;
$$;

create or replace function public.appolo_item_rating_score_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.appolo_recompute_item_score(coalesce(new.item_id, old.item_id));
  return null;
end;
$$;

drop trigger if exists item_ratings_score_trigger on public.item_ratings;
create trigger item_ratings_score_trigger
after insert or update of elo, item_id or delete on public.item_ratings
for each row execute function public.appolo_item_rating_score_trigger();

-- Backfill existing ratings so the new columns are usable immediately.
select public.appolo_recompute_item_score(id) from public.catalog_items;