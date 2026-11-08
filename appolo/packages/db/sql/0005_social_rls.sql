-- Row-level security for the social media tables.
--
-- Appolo is a social product: profiles, community ratings, follows, and
-- public pods are world-readable, while every write stays scoped to the
-- active org via app.org_id (set by withOrg()).

-- Community ratings and reviews are readable by everyone.
drop policy if exists ratings_public_read on public.item_ratings;
create policy ratings_public_read on public.item_ratings
  for select using (true);

-- profiles: world-readable identity, org-scoped writes.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
drop policy if exists tenant_isolation on public.profiles;
create policy tenant_isolation on public.profiles
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select using (true);

-- follows: readable by everyone; written by the follower.
alter table public.follows enable row level security;
alter table public.follows force row level security;
drop policy if exists tenant_isolation on public.follows;
create policy tenant_isolation on public.follows
  using (follower_org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (follower_org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists follows_public_read on public.follows;
create policy follows_public_read on public.follows for select using (true);

-- pods: public pods are world-readable; writes are owner-scoped.
alter table public.pods enable row level security;
alter table public.pods force row level security;
drop policy if exists tenant_isolation on public.pods;
create policy tenant_isolation on public.pods
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists pods_public_read on public.pods;
create policy pods_public_read on public.pods for select using (visibility = 'public');

-- pod_items: readable when the parent pod is public; written by the pod owner.
alter table public.pod_items enable row level security;
alter table public.pod_items force row level security;
drop policy if exists tenant_isolation on public.pod_items;
create policy tenant_isolation on public.pod_items
  using (exists (
    select 1 from public.pods p
    where p.id = pod_id
      and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ))
  with check (exists (
    select 1 from public.pods p
    where p.id = pod_id
      and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ));
drop policy if exists pod_items_public_read on public.pod_items;
create policy pod_items_public_read on public.pod_items for select using (exists (
  select 1 from public.pods p where p.id = pod_id and p.visibility = 'public'
));
