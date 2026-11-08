-- Collaborative public pods.
--
-- Any signed-in profile may contribute a title to a public pod. Attribution is
-- stored per row so the pod still shows who added what, and deletes are limited
-- to the pod owner (tenant_isolation) or the contributor who added the row.

alter table public.pod_items
  add column if not exists added_by_org_id uuid references public.orgs(id) on delete set null;

create index if not exists pod_items_added_by_idx on public.pod_items(added_by_org_id);

-- Public means public. Pods marked public are already served to signed-out
-- visitors, but 0006 scoped those reads to requests with no tenant context.
-- That made an insert targeting someone else's public pod impossible: the
-- policy check could not see the pod it was validating against. Allow any
-- request to read public pods and their items; tenant queries stay scoped by
-- app.org_id for everything that is not explicitly public.
drop policy if exists pods_public_read on public.pods;
create policy pods_public_read on public.pods
  for select using (visibility = 'public');

drop policy if exists pod_items_public_read on public.pod_items;
create policy pod_items_public_read on public.pod_items
  for select using (
    exists (
      select 1 from public.pods p
      where p.id = pod_id and p.visibility = 'public'
    )
  );

drop policy if exists pod_items_public_insert on public.pod_items;
create policy pod_items_public_insert on public.pod_items
  for insert
  with check (
    added_by_org_id = nullif(current_setting('app.org_id', true), '')::uuid
    and exists (
      select 1 from public.pods p
      where p.id = pod_id and p.visibility = 'public'
    )
  );

drop policy if exists pod_items_contributor_delete on public.pod_items;
create policy pod_items_contributor_delete on public.pod_items
  for delete
  using (added_by_org_id = nullif(current_setting('app.org_id', true), '')::uuid);
