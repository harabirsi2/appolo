-- Genres a new profile picks during onboarding. Kept per org so the starter
-- comparison and later discovery can weight the chosen kinds and genres.
create table if not exists public.profile_interests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind public.media_kind not null,
  genre text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, kind, genre)
);

create index if not exists profile_interests_org_kind_idx
  on public.profile_interests(org_id, kind);

alter table public.profile_interests enable row level security;
alter table public.profile_interests force row level security;
drop policy if exists tenant_isolation on public.profile_interests;
create policy tenant_isolation on public.profile_interests
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.profile_interests to appolo_app;
  end if;
end $$;
