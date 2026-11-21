-- Security hardening: missing foreign keys and unchecked status columns.
--
-- 1. `messages.sender_id` and `review_requests.campaign_id` were bare uuid
--    columns, so a deleted user or campaign left rows pointing at nothing.
--    Dangling values are nulled before the constraint is added.
-- 2. `pods.visibility` and `pod_members.role` accepted any text. Both are
--    checked against the values the application actually writes.
-- 3. `feature_flags.org_id` was nullable while its RLS policy equates it to
--    `app.org_id`, so a NULL row matched no tenant and was invisible to
--    everyone. Global (NULL) flags are not a supported concept here, so the
--    unreachable rows go and the column becomes NOT NULL.

update public.messages m
set sender_id = null
where m.sender_id is not null
  and not exists (select 1 from public.users u where u.id = m.sender_id);

update public.review_requests r
set campaign_id = null
where r.campaign_id is not null
  and not exists (select 1 from public.campaigns c where c.id = r.campaign_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_sender_id_users_id_fk') then
    alter table public.messages
      add constraint messages_sender_id_users_id_fk
      foreign key (sender_id) references public.users(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'review_requests_campaign_id_campaigns_id_fk') then
    alter table public.review_requests
      add constraint review_requests_campaign_id_campaigns_id_fk
      foreign key (campaign_id) references public.campaigns(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pods_visibility_check') then
    alter table public.pods
      add constraint pods_visibility_check check (visibility in ('public', 'private')) not valid;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pod_members_role_check') then
    alter table public.pod_members
      add constraint pod_members_role_check check (role in ('owner', 'editor', 'viewer')) not valid;
  end if;
end $$;

alter table public.pods validate constraint pods_visibility_check;
alter table public.pod_members validate constraint pod_members_role_check;

-- NULL rows are unreachable under the tenant policy and hold no data anyone
-- can read; keeping them would leave the column nullable forever.
delete from public.feature_flags where org_id is null;

alter table public.feature_flags alter column org_id set not null;
