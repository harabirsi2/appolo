-- PWA milestone 1: durable vote receipts + web push subscriptions.
--
-- Why a receipt table instead of a key on rating_events: `item_matchups` is an
-- append-only log and `rating_events` only has rows for counted votes (a skip
-- or an undecided writes no event, but still moves `matches`/`skips`). Keying
-- the replay on the event row would therefore leave the exact case the queue is
-- built for — a vote taken on a train, replayed twice — unprotected for two of
-- the five outcomes.
--
-- A receipt is the transaction's commit marker: one row per accepted vote,
-- primary-keyed by (org_id, idempotency_key). The second delivery of the same
-- key hits the primary key, the insert fails inside the transaction that would
-- have written the matchup, and the rolled-back attempt leaves the append-only
-- tables untouched. The stored response is replayed verbatim, so the client
-- sees the same Elo delta it originally saw.

create table if not exists public.vote_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  idempotency_key text not null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  opponent_id uuid references public.catalog_items(id) on delete set null,
  result text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  constraint vote_receipts_pk primary key (org_id, idempotency_key)
);

create index if not exists vote_receipts_org_created_idx
  on public.vote_receipts(org_id, created_at desc);

alter table public.vote_receipts enable row level security;
alter table public.vote_receipts force row level security;

drop policy if exists tenant_isolation on public.vote_receipts;
create policy tenant_isolation on public.vote_receipts
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Web push

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  -- Cleared when the push service answers 404/410: the browser rotated or
  -- revoked the subscription and it must not be retried.
  enabled boolean not null default true,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_uq unique (endpoint)
);

create index if not exists push_subscriptions_org_idx
  on public.push_subscriptions(org_id)
  where enabled;

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists tenant_isolation on public.push_subscriptions;
create policy tenant_isolation on public.push_subscriptions
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
