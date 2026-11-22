-- Spotify OAuth provenance.
--
-- `spotify_connected` was a profile-settings checkbox, so it cannot prove that
-- OAuth ever completed. This timestamp is written only by the callback after a
-- successful top-tracks import. Existing rows are left NULL: the app treats
-- that as not connected rather than trusting the old editable boolean.
--
-- No data is deleted and no historical flag is rewritten.

alter table public.profiles
  add column if not exists spotify_connected_at timestamptz;

comment on column public.profiles.spotify_connected_at is
  'Set only by the Spotify OAuth callback after a successful import. NULL means not connected.';
