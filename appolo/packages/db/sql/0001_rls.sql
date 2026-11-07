-- Row-level security for every tenant-scoped table.
-- The application connects as a non-superuser role, so RLS is enforced.
-- `FORCE` also applies policies to the table owner as defence in depth.
-- Policies read the transaction-local setting `app.org_id`, set by withOrg().

alter table public.orgs enable row level security;
alter table public.orgs force row level security;
drop policy if exists tenant_isolation on public.orgs;
create policy tenant_isolation on public.orgs
  using (id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
declare
  t text;
  tenant_tables text[] := array[
    'locations',
    'api_keys',
    'audit_logs',
    'contacts',
    'contact_channels',
    'tags',
    'contact_tags',
    'custom_fields',
    'contact_custom_values',
    'consent_records',
    'contact_events',
    'channels',
    'phone_numbers',
    'conversations',
    'messages',
    'message_events',
    'internal_notes',
    'saved_replies',
    'review_platforms',
    'review_requests',
    'review_tokens',
    'reviews',
    'review_replies',
    'private_feedback',
    'review_widgets',
    'automations',
    'automation_steps',
    'automation_runs',
    'campaigns',
    'campaign_recipients',
    'ai_agents',
    'ai_playbooks',
    'ai_knowledge_docs',
    'ai_knowledge_chunks',
    'ai_conversations',
    'ai_turns',
    'ai_evals',
    'ai_eval_runs',
    'calendars',
    'appointments',
    'availability_rules',
    'webhook_endpoints',
    'webhook_deliveries',
    'imports',
    'exports',
    'feature_flags'
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

-- Identity-plane tables (users, memberships, sessions, notifications,
-- job_locks) are intentionally not under RLS: they are looked up before an
-- org context exists. Application code always filters memberships by user_id.