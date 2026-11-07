-- Row-level security for the media ranking tables.
-- catalog_items is shared and intentionally left without RLS; the two
-- per-org tables use the same tenant-isolation policy as the rest of the app.

do $$
declare
  t text;
  tenant_tables text[] := array[
    'item_ratings',
    'item_matchups'
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