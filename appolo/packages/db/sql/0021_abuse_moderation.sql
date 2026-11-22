-- Abuse reporting and moderation for public social content.
--
-- Moderation state lives on the content itself so every public query can
-- enforce visibility with a normal predicate instead of a second lookup.
-- Reports are tenant-scoped for reporters; platform moderators read the queue
-- through the admin connection.

alter table public.users
  add column if not exists is_moderator boolean not null default false;

alter table public.item_ratings
  add column if not exists moderation_status text not null default 'visible';
alter table public.item_ratings
  add column if not exists moderated_at timestamptz;
alter table public.item_ratings
  add column if not exists moderated_by uuid references public.users(id) on delete set null;

alter table public.profiles
  add column if not exists moderation_status text not null default 'visible';
alter table public.profiles
  add column if not exists moderated_at timestamptz;
alter table public.profiles
  add column if not exists moderated_by uuid references public.users(id) on delete set null;

alter table public.rating_comments
  add column if not exists moderation_status text not null default 'visible';
alter table public.rating_comments
  add column if not exists moderated_at timestamptz;
alter table public.rating_comments
  add column if not exists moderated_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_ratings_moderation_status_check'
  ) then
    alter table public.item_ratings
      add constraint item_ratings_moderation_status_check
      check (moderation_status in ('visible', 'hidden', 'removed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_moderation_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_moderation_status_check
      check (moderation_status in ('visible', 'hidden', 'removed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'rating_comments_moderation_status_check'
  ) then
    alter table public.rating_comments
      add constraint rating_comments_moderation_status_check
      check (moderation_status in ('visible', 'hidden', 'removed'));
  end if;
end $$;

create index if not exists item_ratings_moderation_idx
  on public.item_ratings(moderation_status);
create index if not exists profiles_moderation_idx
  on public.profiles(moderation_status);
create index if not exists rating_comments_moderation_idx
  on public.rating_comments(moderation_status);

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_org_id uuid not null references public.orgs(id) on delete cascade,
  content_org_id uuid not null references public.orgs(id) on delete cascade,
  content_type text not null check (content_type in ('review', 'profile', 'comment')),
  content_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'misinformation', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  action text check (action in ('hide', 'remove', 'dismiss')),
  moderated_by uuid references public.users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists abuse_reports_reporter_content_uq
  on public.abuse_reports(reporter_org_id, content_type, content_id);
create index if not exists abuse_reports_status_created_idx
  on public.abuse_reports(status, created_at);
create index if not exists abuse_reports_content_idx
  on public.abuse_reports(content_type, content_id, status);

alter table public.abuse_reports enable row level security;
alter table public.abuse_reports force row level security;
drop policy if exists tenant_isolation on public.abuse_reports;
create policy tenant_isolation on public.abuse_reports
  using (reporter_org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (reporter_org_id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant select, insert, update, delete on public.abuse_reports to appolo_app;
  end if;
end $$;
