-- Recovery migration: columns that schema.ts defines but no earlier
-- migration creates. The upgrade branch lost its own migration when it was
-- merged, so a fresh `migrate && seed` crashed on the first inserts.
-- Idempotent guards keep it safe to re-run everywhere.

alter table profiles
  add column if not exists spotify_connected_at timestamptz;

alter table item_ratings
  add column if not exists source text,
  add column if not exists sub_scores jsonb not null default '{}'::jsonb,
  add column if not exists highlights jsonb not null default '{}'::jsonb;
