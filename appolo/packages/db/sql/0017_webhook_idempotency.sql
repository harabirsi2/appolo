-- Webhook idempotency.
--
-- A provider message id and a status event are each recorded once, so Twilio
-- retries and replayed callbacks become no-ops instead of duplicate rows (and,
-- on the inbound path, duplicate contacts/automations/AI replies). Any rows
-- already duplicated by the previous race-prone path are collapsed onto the
-- earliest physical row before the unique indexes are built. See docs/SECURITY.md.

delete from public.messages a
using public.messages b
where a.provider_sid is not null
  and a.org_id = b.org_id
  and a.provider_sid = b.provider_sid
  and a.ctid > b.ctid;

delete from public.message_events a
using public.message_events b
where a.message_id = b.message_id
  and a.event = b.event
  and a.ctid > b.ctid;

-- Postgres treats NULL as distinct, so a message with no provider id (webchat,
-- or an outbound row still queued) never conflicts.
create unique index if not exists messages_org_provider_sid_uq
  on public.messages (org_id, provider_sid);

create unique index if not exists message_events_message_event_uq
  on public.message_events (message_id, event);
