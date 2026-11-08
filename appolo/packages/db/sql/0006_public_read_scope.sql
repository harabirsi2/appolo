-- Scope public reads to requests that have no tenant context.
--
-- Appolo shows profiles, reviews, pods, and follows publicly. Those reads
-- go through the un-scoped app role (no app.org_id). Inside a tenant
-- request we still want strict per-org visibility so one profile's
-- rankings never leak into another profile's top five.

drop policy if exists ratings_public_read on public.item_ratings;
create policy ratings_public_read on public.item_ratings
  for select using (nullif(current_setting('app.org_id', true), '') is null);

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select using (nullif(current_setting('app.org_id', true), '') is null);

drop policy if exists follows_public_read on public.follows;
create policy follows_public_read on public.follows
  for select using (nullif(current_setting('app.org_id', true), '') is null);

drop policy if exists pods_public_read on public.pods;
create policy pods_public_read on public.pods
  for select using (
    visibility = 'public'
    and nullif(current_setting('app.org_id', true), '') is null
  );

drop policy if exists pod_items_public_read on public.pod_items;
create policy pod_items_public_read on public.pod_items
  for select using (
    nullif(current_setting('app.org_id', true), '') is null
    and exists (select 1 from public.pods p where p.id = pod_id and p.visibility = 'public')
  );
