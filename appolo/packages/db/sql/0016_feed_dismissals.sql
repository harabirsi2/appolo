-- Reviews a profile has hidden from its For-you feed. Kept apart from
-- feedback tables so dismissing is cheap and reversible by deleting a row.
create table if not exists public.feed_dismissals (
  org_id uuid not null references public.orgs(id) on delete cascade,
  rating_id uuid not null references public.item_ratings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, rating_id)
);

create index if not exists feed_dismissals_org_idx
  on public.feed_dismissals(org_id);

alter table public.feed_dismissals enable row level security;
alter table public.feed_dismissals force row level security;
drop policy if exists tenant_isolation on public.feed_dismissals;
create policy tenant_isolation on public.feed_dismissals
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.feed_dismissals to appolo_app;
  end if;
end $$;
