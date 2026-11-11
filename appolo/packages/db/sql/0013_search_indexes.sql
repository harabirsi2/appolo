-- Indexes for the substring searches and genre filters.
--
-- Every list search uses `ilike '%term%'`, which a btree index cannot serve
-- (the pattern is not prefix-anchored), so these are trigram GIN indexes.
-- Genre filters use `genre = any(genres)`, which needs a GIN array index.
--
-- pg_trgm is a trusted extension on PostgreSQL 13+, so the migration role can
-- create it without superuser. On a managed database that forbids extensions,
-- this migration fails inside its transaction and is not recorded as applied.
create extension if not exists pg_trgm;

create index if not exists catalog_items_title_trgm_idx
  on public.catalog_items using gin (title gin_trgm_ops);
create index if not exists catalog_items_subtitle_trgm_idx
  on public.catalog_items using gin (subtitle gin_trgm_ops);
create index if not exists catalog_items_genres_gin_idx
  on public.catalog_items using gin (genres);

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (display_name gin_trgm_ops);

create index if not exists reviews_body_trgm_idx
  on public.reviews using gin (body gin_trgm_ops);
create index if not exists reviews_author_name_trgm_idx
  on public.reviews using gin (author_name gin_trgm_ops);

create index if not exists contacts_name_trgm_idx
  on public.contacts using gin (name gin_trgm_ops);
create index if not exists contacts_company_trgm_idx
  on public.contacts using gin (company gin_trgm_ops);

create index if not exists contact_channels_value_trgm_idx
  on public.contact_channels using gin (value gin_trgm_ops);
create index if not exists contact_channels_normalized_value_trgm_idx
  on public.contact_channels using gin (normalized_value gin_trgm_ops);
