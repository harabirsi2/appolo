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

## Wiring (10 lines, blocked on an uncommitted file)

`lib/services/moderation.ts` — the reports pipeline — is currently uncommitted
work in progress, so this module is shipped standalone and **not yet called**.
When that lands, wire it where the report row is inserted (around the
`insert(abuseReports)` call):

```ts
import { triage, autoHideEnabled } from "./moderation-signals";

// candidates: the same author's recent bodies, plus bodies on the same item.
// Own-tenant rows only — the app role must not read another tenant's text.
const decision = triage({ body: target.body, candidates, autoHideEnabled: autoHideEnabled() });

await withOrg(reporterOrgId, (tx) =>
  tx.insert(abuseReports).values({
    /* …existing columns… */
    // Persist the signal so the queue can sort by it without recomputing:
    details: [input.details, decision.action === "none" ? null : decision.reason]
      .filter(Boolean).join("\n\n") || null,
  }),
);
```

That needs one extra column (or reuse of `details`) plus a queue sort on the
signal — an hour of work, not a day. Until then `pnpm test:signals` proves the
rules, and the pipeline is unchanged.

## What is skipped, and why

| Skipped | Why |
| --- | --- |
| ML/text classifier | 15 hand-written rules catch the two shapes that fill the queue. A classifier needs labelled data this product does not have yet. |
| Image moderation | Reports on artwork are rare and a human can see them in one click. |
| Cross-tenant duplicate detection | Requires reading other tenants' review text, which RLS (rightly) forbids. It is an admin-only query, not a request-path one. |
| Auto-dismissal | Dismissing on a signal hides real abuse from the moderator. `none` still queues the report — it just does not get prioritised. |
| Appeals flow | Nothing auto-hides by default, so there is nothing to appeal yet. Revisit the day `MODERATION_AUTO_HIDE=1` goes on. |
