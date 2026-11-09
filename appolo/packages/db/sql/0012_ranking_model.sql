-- Tie-aware personal ranking model.
--
-- item_matchups stays the durable comparison log; `outcome` records the
-- three-way result ("a" | "b" | "tie" | "undecided" | "skip"). Rows written
-- before this migration have a null outcome and are interpreted from `result`.
--
-- ranking_models stores a reproducible snapshot of the Bradley–Terry +
-- Davidson fit per org and media kind. It can always be rebuilt from
-- item_matchups, so the table is a cache, not the source of truth.

alter table public.item_matchups
  add column if not exists outcome text;

alter table public.item_ratings
  add column if not exists ties integer not null default 0;

create table if not exists public.ranking_models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind public.media_kind not null,
  state jsonb not null default '{}'::jsonb,
  comparisons integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ranking_models_org_kind_uq
  on public.ranking_models(org_id, kind);

alter table public.ranking_models enable row level security;
alter table public.ranking_models force row level security;
drop policy if exists tenant_isolation on public.ranking_models;
create policy tenant_isolation on public.ranking_models
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.ranking_models to appolo_app;
  end if;
end $$;
