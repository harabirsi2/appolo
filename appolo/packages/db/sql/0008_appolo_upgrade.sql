-- appolo_upgrade_v1: review videos, profile layout, search indexes.
-- Every statement is idempotent, so re-running this file is safe.

alter table public.item_ratings
  add column if not exists video_url text;

alter table public.profiles
  add column if not exists profile_layout text not null default 'list';

create index if not exists item_ratings_item_updated_idx on public.item_ratings(item_id, updated_at desc);
create index if not exists item_ratings_org_updated_idx on public.item_ratings(org_id, updated_at desc);
create index if not exists follows_followee_idx on public.follows(followee_org_id);

-- Usernames are looked up case-insensitively, so enforce it. If two existing
-- usernames differ only by case, this is skipped with a notice.
do $$
begin
  create unique index if not exists profiles_username_lower_uq on public.profiles (lower(username));
exception when unique_violation then
  raise notice 'profiles_username_lower_uq skipped: usernames that differ only by case already exist';
end $$;
