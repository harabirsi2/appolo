-- Give every comparison the identity of the timeline event it created.
--
-- `submit_vote` writes one `rating_events` row for the initiating item (ties
-- included) but `item_matchups` had no link back to it, so undo had to guess
-- by taking the newest `rated` event for that item. With two votes on the same
-- item (A vs B, then A vs C) undoing the B matchup deleted the C event and
-- left the B event orphaned.
--
-- The column is nullable: rows written before this migration (and votes that
-- produce no event at all, i.e. skips and undecideds) have no event id.
--
-- Backfill: both rows used to be inserted in the same transaction, so they
-- share the transaction's `now()` timestamp exactly. A matchup is only
-- resolved when that (org, item, created_at) key maps to exactly one `rated`
-- event and exactly one matchup, so the backfill can never attach an event to
-- two comparisons. Anything ambiguous stays null and undo falls back to a
-- timestamp match at delete time.

alter table public.item_matchups
  add column if not exists event_id uuid references public.rating_events(id) on delete set null;

create index if not exists item_matchups_event_idx
  on public.item_matchups(event_id);

update public.item_matchups im
set event_id = candidate.id
from (
  select distinct on (re.org_id, re.item_id, re.created_at)
    re.id,
    re.org_id,
    re.item_id,
    re.created_at
  from public.rating_events re
  where re.kind = 'rated'
  order by re.org_id, re.item_id, re.created_at, re.id
) candidate
where im.event_id is null
  and im.result in ('win', 'loss', 'tie')
  and candidate.org_id = im.org_id
  and candidate.item_id = im.item_id
  and candidate.created_at = im.created_at
  and not exists (
    select 1
    from public.item_matchups other
    where other.id <> im.id
      and other.org_id = im.org_id
      and other.item_id = im.item_id
      and other.created_at = im.created_at
  );
