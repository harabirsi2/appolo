-- Podiums-parity feature layer: games, genres, credits, reactions,
-- comments, watchlists, history, notifications, and richer profiles.

alter type public.media_kind add value if not exists 'game';

alter table public.catalog_items
  add column if not exists genres text[] not null default '{}',
  add column if not exists trailer_url text;

alter table public.profiles
  add column if not exists pinned_rating_id uuid,
  add column if not exists manual_mode boolean not null default false,
  add column if not exists spotify_connected boolean not null default false,
  add column if not exists apple_music_connected boolean not null default false,
  add column if not exists language text not null default 'en';

alter table public.item_ratings
  add column if not exists spoiler boolean not null default false,
  add column if not exists photo_url text,
  add column if not exists favorite_character text,
  add column if not exists favorite_tracks text[] not null default '{}';

create table if not exists public.catalog_credits (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  person_name text not null,
  person_slug text not null,
  role text not null default 'actor',
  character text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists catalog_credits_item_idx on public.catalog_credits(item_id, position);
create index if not exists catalog_credits_person_idx on public.catalog_credits(person_slug);

create table if not exists public.rating_reactions (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null references public.item_ratings(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists rating_reactions_uq on public.rating_reactions(rating_id, org_id, emoji);

create table if not exists public.rating_comments (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null references public.item_ratings(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists rating_comments_rating_idx on public.rating_comments(rating_id, created_at);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists watchlist_org_item_uq on public.watchlist(org_id, item_id);

create table if not exists public.rating_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  kind text not null default 'rated',
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists rating_events_org_idx on public.rating_events(org_id, created_at desc);

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists search_history_org_query_uq on public.search_history(org_id, query);

create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_org_id uuid references public.orgs(id) on delete cascade,
  kind text not null,
  item_id uuid references public.catalog_items(id) on delete cascade,
  rating_id uuid references public.item_ratings(id) on delete cascade,
  body text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists social_notifications_org_idx on public.social_notifications(org_id, created_at desc);

-- Tenant isolation for private tables.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'watchlist',
    'rating_events',
    'search_history',
    'social_notifications'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I
         using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)
         with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;

-- Reactions and comments follow the public-review model: readable by
-- everyone outside a tenant request, writable by the acting org.
alter table public.rating_reactions enable row level security;
alter table public.rating_reactions force row level security;
drop policy if exists tenant_isolation on public.rating_reactions;
create policy tenant_isolation on public.rating_reactions
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists rating_reactions_public_read on public.rating_reactions;
create policy rating_reactions_public_read on public.rating_reactions
  for select using (nullif(current_setting('app.org_id', true), '') is null);

alter table public.rating_comments enable row level security;
alter table public.rating_comments force row level security;
drop policy if exists tenant_isolation on public.rating_comments;
create policy tenant_isolation on public.rating_comments
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists rating_comments_public_read on public.rating_comments;
create policy rating_comments_public_read on public.rating_comments
  for select using (nullif(current_setting('app.org_id', true), '') is null);
