-- Curated podium order.
--
-- Elo decides the ranking; this column lets a profile pin its own order for
-- the top five of each medium. Shape: { "movie": [itemId, ...], ... }.

alter table public.profiles
  add column if not exists podium_order jsonb not null default '{}'::jsonb;
