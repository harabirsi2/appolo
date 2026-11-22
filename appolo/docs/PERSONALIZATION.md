# Personalization depth

The ranking already does more than "an accurate score" implies: Elo with adaptive
K, a Bradley–Terry–Davidson fit with tie parameter, Pearson-overdispersion
corrected intervals, an outward attenuation allowance, comparison selection by
information gain × uncertainty × exposure, per-card feed explanations, and
Kendall τ-b taste comparison. None of that was visible. This is how it becomes
visible, and habit-forming.

Five features, two shipped (`✅ shipped`), three designed.

---

## ✅ 1. "Why is this #1?" — drill-down from any ranked item

**Where**: an item page card (`Why it's #3 in Movies · Picked over Dune · +42 Elo ·
See why →`) and a full page at `/app/item/[id]/why`.

**Wireframe (text)**

```
[←]  Dune
WHY IT SITS HERE
#1 in Movies
Of 14 movies you have ranked, from 23 counted comparisons and 2 skipped.
Nothing here is a guess: every line is a vote you cast.

┌ Your score ─────────────────────────────┐
│ 8.4 /10 · Superb       7.8 ± 0.3 · 12   │
│                        comparisons [settled] │
│ Leads #2, Sicario (8.1), by 0.3 Elo — in a  │
│ rematch you would pick it 58% of the time.  │
└─────────────────────────────────────────┘

Comparisons that moved it most
  Picked over The Godfather           +42
  3 days ago · they were at 8.9
  Lost to Blade Runner                −18
  6 days ago · they were at 7.2
  ...

[Challenge it]  [Back to the title]  [All rankings]
```

**Data source**: `item_matchups` read from **both** sides. Each row stores
`item_elo_before/after` and `opponent_elo_before/after`, so the exact delta a
comparison applied is recoverable, not recomputed. `recentMatchups` only queried
`item_id = X`, which is the audit gap: an item that was usually the *opponent*
looked like it had no history. `lib/services/explain.ts` fixes that with an
`OR` across both columns, negating the delta when the item is the opponent
(zero-sum). Neighbour comparison uses the Elo expected score
`1 / (1 + 10^(ΔElo/400))`; the position itself comes from the same score ordering
the rankings list uses.

**Effort**: ~1 day. Done.

**Guardrails**: no comparison → says so ("only skips and calls too close to
score"); unrated item → redirects to the item page; removed opponent → "a title
since removed".

---

## ✅ 2. Confidence badges done right

**Where**: item page ("Ranking model" line) and the `/why` page header.

**Format**: `7.8 ± 0.3 · 12 comparisons` + a `settled / holding / provisional`
chip, expanding to:

> 95% range 7.5–8.1 from 12 comparisons. Early scores shrink toward the middle
> until enough votes land, so a new title starts near 5 and moves as you compare
> — the ± is how much it could still move.

A `<details>` disclosure, not a hover tooltip: on a phone a tooltip is
unreachable, and this is a phone product.

**Data source**: the fitted model's `FittedItem` (`theta`, `standardError`,
`lower`, `upper`, `comparisons`), where the interval already carries:

- a **Pearson overdispersion correction** — `se × √(X²/df)` clamped to a maximum
  (`ranking-model.ts`), so correlated votes cannot produce falsely narrow bands;
- an **outward attenuation allowance** on the side the estimate is biased toward
  (shrinkage pulls toward zero);
- centring of θ, because BT is identified only up to a shared shift.

`scoreInterval()` (new, `packages/core`) maps that θ interval onto the 0–10
score by *re-evaluating* the expected-wins statistic at θ ± 1.96·SE against the
same field rather than rescaling the error linearly — the logistic squash means a
score near 9 genuinely cannot move up 0.9. Both ends are clamped to 0–10 and the
margin takes the larger half-width.

Under 3 comparisons the badge refuses to print an interval ("2 comparisons — too
early to call").

**Effort**: ~1 day (plus tests). Done. Three unit tests cover bracketing,
shrinkage, and the 0–10 clamp.

---

## 3. "Challenge the ranking" — community-wide high-uncertainty pairs

**Where**: a tab on the duel screen (`/app/rate?mode=challenge`) and a home card
("3 pairs the community can't agree on").

**Wireframe**

```
CHALLENGE                        12 left today
Two titles the crowd is split on. Your vote is
worth more here than on a fresh pair.

[cover]        VS        [cover]
Dune                    Arrival
8.1 ± 0.9 · 41          7.9 ± 0.8 · 38
  ← tough      Skip      tough →

Why this pair: 52% split across 41 community
comparisons; your vote has the highest information
gain of any pair you haven't seen.
```

**Data source**: the existing selection engine (`selectInformativeOpponent` /
`selectOpponent` in `@appolo/core`) run over the **community** aggregate rather
than one account's list: cross-account pairing counts from `item_matchups`
(pseudo-anonymous, already aggregated for the community averages), filtered to
pairs with high posterior variance and near-50% split. Writes land in the user's
own log as a normal comparison, so nothing about the append-only design changes;
a community-aggregate counter can be a materialised view refreshed by the
existing ranking refresh path.

**Effort**: 3–4 days. Needs a cross-account aggregate (privacy review: publish
pair-level counts, never per-user rows), a mode flag on the rate route, and a
selection query that is index-friendly at catalog scale.

**Why it matters**: cold start is the biggest drop-off in the funnel; a
"challenge" mode makes a brand-new account useful on vote one, because the pair
is chosen from the crowd's uncertainty, not the user's empty list.

---

## 4. Taste-match percentile

**Where**: profile and `/app/taste`.

**Wireframe**

```
Your taste in Movies
Top 3% of sci-fi fans  (n = 812 · your 14 sci-fi titles)
You rate slow sci-fi above the crowd. Median crowd
score 6.9 · yours 8.2 on 6 titles.

Top 11% in Drama  (n = 1,240)
  ...
```

**Data source**: the genre vectors already built for taste comparison
(`taste-match.ts` cosine similarity over genre-weighted ratings). Percentile =
share of accounts whose genre-vector cosine to the reference genre centroid is
lower than yours; the sample size is the number of accounts with ≥5 ratings in
that genre, and the user's own `n` (titles in that genre) is shown too.

**Effort**: ~2 days. The risk is not the maths, it is the claim.

**Honesty guardrails (non-negotiable)**

- Never show a percentile without `n` (both the cohort and the user's titles).
- Suppress below 5 user titles or a cohort under 200: say "not enough data yet",
  not a made-up rank.
- Percentiles are computed on the genre vector, not on raw score; label them
  "taste match", never "you are better than 97%".
- No percentile for genres the catalog barely covers (n of titles in catalog < 20).

---

## 5. Weekly personal recap

**Where**: a card on home on Mondays, and a push (the weekly-digest job already
exists in the worker — this gives it better content).

**Wireframe**

```
YOUR WEEK · Nov 16–22
23 comparisons · 6 titles ranked for the first time
Biggest mover: Dune rose 3 places
Your taste drifted toward indie: 4 of 6 new
titles were indie, vs 21% of your history.
You and @noah agreed on 8 of 11 shared titles.
[See the week]   [Not interested]
```

**Data source**: `rating_events` (append-only, one row per counted comparison,
carrying the item and detail) plus `item_matchups` for movers, and
`profile_interests`/genre vectors for the drift line. Everything is a per-week
aggregate over the current account's own rows; no new writes.

**Effort**: ~1–2 days for the page and the aggregate query, half a day to wire
the notification. The tuning work is deciding what counts as "drift" — recommend
a share comparison against the user's prior 90 days, with a minimum of 5 new
titles before claiming drift at all.

**Guardrail**: below 5 comparisons the recap says "quiet week" and shows nothing
to be proud or ashamed of.

---

## Shared principles

1. **Every claim shows its sample.** Any number that compares the user to
   anything carries `n` and a date range.
2. **Uncertainty is visible, not hidden.** A ranking with 2 comparisons is not a
   ranking; the UI says so.
3. **Read, don't reconstruct.** Explanations come from the log
   (`item_matchups`, `rating_events`), never from a second calculation that could
   disagree with the stored result.
4. **No engagement-only copy.** "Your taste drifted toward indie" is only shown
   when the data says it, with the comparison baseline attached.
