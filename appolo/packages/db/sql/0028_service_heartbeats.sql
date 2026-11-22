-- Liveness heartbeats for background services.
--
-- The worker is not an HTTP service, so nothing can ask it "are you alive?".
-- It writes a row here every 30 seconds and /api/health reports how fresh that
-- row is. A restart shows up as a gap, and a wedged process shows up as a stale
-- row — which is the difference between "the deploy worked" and "the deploy
-- worked but enrichment has been dead for an hour".
--
-- Deliberately NOT tenant-scoped and NOT under RLS: the row carries a service
-- name, a timestamp and free-form detail (pid, queue name), never user data.
-- The app role needs to read it, and a tenant policy would hide every row from
-- the health check that is supposed to see them.

create table if not exists public.service_heartbeats (
  name text primary key,
  last_seen_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
