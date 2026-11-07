-- Grant the non-superuser application role access to the schema.
-- No-op on managed databases where the role does not exist (the app then
-- connects as the database owner, and FORCE RLS still applies).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'appolo_app') then
    grant usage on schema public to appolo_app;
    grant select, insert, update, delete on all tables in schema public to appolo_app;
    grant usage, select on all sequences in schema public to appolo_app;
    alter default privileges in schema public
      grant select, insert, update, delete on tables to appolo_app;
    alter default privileges in schema public
      grant usage, select on sequences to appolo_app;
  end if;
end $$;