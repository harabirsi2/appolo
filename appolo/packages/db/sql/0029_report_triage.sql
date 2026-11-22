-- Triage decision stored on the report itself.
--
-- Reports arrive from users, so the queue only knows what the reporter typed.
-- The signals in apps/web/lib/services/moderation-signals.ts are computed once,
-- when the report is filed, and the result is persisted here: computing it at
-- read time would mean re-scanning the author's history every time a moderator
-- opens the queue, and it would let a threshold change silently rewrite history.
--
-- `triage_action` is advisory. Nothing is hidden by it — a moderator still makes
-- the decision. It exists to sort the queue (hide > flag > none) and to show the
-- moderator why a report was prioritised.
--
-- Backfill: existing rows default to 'none', which is honest — they were filed
-- before there was a signal, and pretending otherwise would be a lie in the log.

alter table public.abuse_reports
  add column if not exists triage_action text not null default 'none',
  add column if not exists triage_score integer not null default 0,
  add column if not exists triage_reason text;

alter table public.abuse_reports
  add constraint abuse_reports_triage_action_check
  check (triage_action in ('none', 'flag', 'hide')) not valid;

alter table public.abuse_reports
  validate constraint abuse_reports_triage_action_check;

create index if not exists abuse_reports_triage_queue_idx
  on public.abuse_reports (status, triage_action, created_at desc);
