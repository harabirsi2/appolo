# Moderation automation v1

Two signals, one decision. Pure functions in
`apps/web/lib/services/moderation-signals.ts`, tests in
`moderation-signals.test.ts` (15 cases, `pnpm test:signals`).

The queue today is human-only: a report arrives, a moderator reads it, clicks
hide or dismiss. At solo scale the bottleneck is not the *decision*, it is the
two report shapes that need no decision at all — copied text and adverts.

## Signal 1 — duplicate reviews

`findDuplicate(body, candidates)` → the most similar earlier body, if it is close
enough to be a copy.

- **Similarity**: Sørensen–Dice over character trigrams on normalised text
  (lowercase, punctuation stripped, URLs removed, whitespace collapsed). O(n) per
  pair, so it can run against every candidate in the queue.
- **Threshold**: `0.85`. `0.95` is treated as a certain copy.
- **Minimum length**: 40 normalised characters. "great album" twice is a
  coincidence; flagging it teaches moderators to ignore flags.

Why trigrams and not edit distance: "same review, one word changed" and "same
review, reordered" both need to score high, and neither should cost O(n·m) when
the queue asks on every report.

## Signal 2 — link spam

`scoreLinkSpam(body)` → `{ score: 0..100, reasons }`.

| Rule | Weight |
| --- | --- |
| each link (max 4 counted) | +12 |
| more than one distinct domain | +8 |
| known shortener (`bit.ly`, `t.co`, `linktr.ee`, …) | +20 |
| messaging-app invite (telegram/whatsapp) | +20 |
| gambling/crypto vocabulary | +20 |
| sales language (`buy now`, `discount code`, …) | +15 |
| follow-farming (`dm me`, `free followers`, …) | +15 |
| traffic redirect (`link in bio`, `visit my site`) | +15 |

Shorteners pasted **without a scheme** (`bit.ly/x`) are detected too — bots strip
`https://` precisely because naive filters only look for it. The score is capped
at 100 so one pathological body cannot dominate a sorted queue, and an empty body
scores 0.

## The decision

`triage({ body, candidates, autoHideEnabled })`:

| Condition | `MODERATION_AUTO_HIDE` unset (default) | `=1` |
| --- | --- | --- |
| duplicate ≥ 0.95 | `flag` | `hide` |
| spam score ≥ 70 | `flag` | `hide` |
| duplicate ≥ 0.85 or spam ≥ 40 | `flag` | `flag` |
| otherwise | `none` | `none` |

Hiding is destructive and visible to the author, so it is opt-in and requires an
unambiguous body. A false flag costs one click; a false hide costs a customer.
Every decision carries a `reason` sentence written for a human ("Duplicate of
review 3f2a… (97% similar)."), which is what goes on the report.

## Wiring: computed on insert, persisted, sorted

`reportContent()` in `lib/services/moderation.ts` calls `triage()` **before** the
insert and stores the result on the report row (migration `0029`):

| Column | Meaning |
| --- | --- |
| `triage_action` | `none` / `flag` / `hide` — advisory only |
| `triage_score` | the 0..100 spam score, kept for tuning |
| `triage_reason` | one sentence for the moderator, `null` when `none` |

Candidates for duplicate detection are the **author's own** recent bodies of the
same content type (last 200, via the admin client because the queue is
cross-tenant):

- `contentType = 'review'` → `item_ratings.review_text` for `content_org_id`
- `contentType = 'comment'` → `rating_comments.body` for `content_org_id`
- `contentType = 'profile'` → no body, no query, always `none`

That is the shape spam actually takes here: one account pasting the same
paragraph across items. Comparing against other tenants' text would mean reading
everyone's reviews on the report path, which the RLS model does not allow and
this does not need.

The queue (`moderationQueue`) orders by signal first, then newest:

```sql
case triage_action when 'hide' then 0 when 'flag' then 1 else 2 end,
created_at desc
```

so a flagged duplicate or advert does not sit behind a day of "this review is
mean". The admin page shows `flag · signal 67` plus the reason line on any report
that carries one.

Why compute at insert and not at read:

- The queue would otherwise re-scan the author's history every time a moderator
  opens it.
- A threshold change would silently rewrite the meaning of past reports. Stored
  decisions keep the audit trail honest, and re-running is a migration, not a
  behaviour change.

**Nothing is hidden automatically.** `hide` is only recorded (and still waits for
a moderator) when `MODERATION_AUTO_HIDE=1` *and* the signal is unambiguous.
Rejected on purpose: a background job that re-scores old reports on a schedule —
with 200 candidates and a few reports a day, insert-time is the only moment that
matters.

The database test (`moderation.test.ts`) files three real reports through
`reportContent` and asserts the persisted columns: a copy of an earlier review is
`flag` with a reason naming the original, a link-spam body is `flag` with a score
≥ 40, and a clean review is `none` with no reason — plus that the queue puts the
flagged ones first.

## What is skipped, and why

| Skipped | Why |
| --- | --- |
| ML/text classifier | 15 hand-written rules catch the two shapes that fill the queue. A classifier needs labelled data this product does not have yet. |
| Image moderation | Reports on artwork are rare and a human can see them in one click. |
| Cross-tenant duplicate detection | Requires reading other tenants' review text, which RLS (rightly) forbids. It is an admin-only query, not a request-path one. |
| Auto-dismissal | Dismissing on a signal hides real abuse from the moderator. `none` still queues the report — it just does not get prioritised. |
| Appeals flow | Nothing auto-hides by default, so there is nothing to appeal yet. Revisit the day `MODERATION_AUTO_HIDE=1` goes on. |
