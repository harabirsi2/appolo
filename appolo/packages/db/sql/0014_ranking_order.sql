-- Explicit manual order per org and media kind.
--
-- Dragging a title on the rankings screen stores its position here and writes
-- one `rating_events` row per title whose position changed. It never inserts
-- `item_matchups` rows, so a manual order cannot masquerade as played
-- comparisons in the statistical model.
create table if not exists public.ranking_order (
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind public.media_kind not null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  position integer not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, kind, item_id)
);

create index if not exists ranking_order_org_kind_position_idx
  on public.ranking_order(org_id, kind, position);

alter table public.ranking_order enable row level security;
alter table public.ranking_order force row level security;
drop policy if exists tenant_isolation on public.ranking_order;
create policy tenant_isolation on public.ranking_order
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.ranking_order to appolo_app;
  end if;
end $$;
