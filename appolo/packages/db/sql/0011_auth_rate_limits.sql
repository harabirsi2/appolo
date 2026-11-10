-- Fixed-window counters for credential endpoints (sign-in and sign-up).
-- Identity-plane table: written before an org context exists, so no RLS.
create table if not exists auth_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create index if not exists auth_rate_limits_window_idx
  on auth_rate_limits (window_start);
