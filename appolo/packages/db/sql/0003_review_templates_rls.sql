-- Row-level security for the Phase 2 review_templates table.
-- Same tenant-isolation policy as every other org-scoped table.
alter table public.review_templates enable row level security;
alter table public.review_templates force row level security;
drop policy if exists tenant_isolation on public.review_templates;
create policy tenant_isolation on public.review_templates
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
