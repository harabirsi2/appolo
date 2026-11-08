-- Cross-profile notifications.
--
-- A comment, reaction, or follow is written by the actor's request (app.org_id
-- is the actor) into the recipient's inbox (org_id is the recipient). The
-- tenant_isolation policy only allows org_id = app.org_id, so those inserts
-- would be rejected by WITH CHECK. This policy keeps reads recipient-scoped
-- while letting the acting org create the notification row.

drop policy if exists social_notifications_actor_insert on public.social_notifications;
create policy social_notifications_actor_insert on public.social_notifications
  for insert
  with check (
    actor_org_id = nullif(current_setting('app.org_id', true), '')::uuid
    and actor_org_id is distinct from org_id
  );

-- A follow has no item or rating attached; nothing else is required.
