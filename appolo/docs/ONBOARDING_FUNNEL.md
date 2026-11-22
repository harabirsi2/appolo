# Signup → first comparison: drop-off audit

Every step from the landing page to a saved first rating, the way a real visitor
can fall out of it, and what was changed (or deliberately not changed).

Status legend: **fixed** (changed in this pass), **open** (known, not yet
changed), **deferred** (decided against for now, with the reason).

---

## The funnel, step by step

| # | Step | What can go wrong | Fix | Status |
| --- | --- | --- | --- | --- |
| 1 | Landing hero | Visitor cannot tell what the product does; "rate anything" reads like a five-star app. | Hero now states the mechanic: **Which is better?** with "compare, don't score", a duel visual and one-tap copy. | fixed |
| 2 | "Browse a profile" CTA | The button linked to `/demo`, which did not exist → 404. | `/demo` is a real public tour of the seeded profile + pod, with a graceful "not seeded" state. | fixed |
| 3 | "Try the demo" expectations | The page published a working email + password, so the first thing a stranger learned was a login they did not need (and anyone could use). | Credentials removed from the landing page, the login page and the client bundle (`DEMO_HINT` deleted). The demo account is opt-in via `SEED_DEMO=1`. | fixed |
| 4 | Signup form | Four required fields with no indication which one matters; password rule lives in a hint that disappears while typing. | Inline rule text stays visible; fields are ordered name → email → password. | open (low priority) |
| 5 | Email verification | Could add a "check your inbox" wall between signup and any value. There is **no verification flow today**: `users.emailVerifiedAt` is written at signup, so no mail is sent and no wall exists. | **Deferred.** No transactional email provider is configured (`RESEND_API_KEY` is unset and the mock adapter sends nowhere), so a verification step would be a dead end for every real user. Revisit when email is live *and* abuse appears: then verify before the first public review, not before the first comparison. | deferred |
| 6 | Signup → onboarding | Server action redirects straight to `/app/onboarding`; no intermediate email gate. | No change needed; documented here so the absence is deliberate. | ok |
| 7 | Genre picker | Zero options when the catalog is empty → a dead page with "The catalog is empty right now". | Onboarding already shows the empty state; the seed and provider-first catalog make it rare. Add a "browse everything" fallback link — already present. | ok |
| 8 | Saving interests | Picker allows saving with nothing selected; the starter card then disappears and the page just ends. | Keep "Skip to the app", but the starter should fall back to the newest catalog item when no genres are chosen. | open |
| 9 | Starter title → duel | `/app/rate/[itemId]` can render **No opponents available** when the kind has fewer than two titles — a hard stop after the user was promised a first matchup. | Suggest `nextUnratedItem()` (same helper the new first-rating screen uses) so the flow can always continue. | open |
| 10 | First vote | Vote blocks the whole board until two round trips finish (`POST /vote` then `GET /matchup`), so the first tap feels slow exactly when patience is lowest. | Spec'd in `docs/FEATURES_PODIUMS_GAPS.md` §1 (optimistic swap + prefetch). Not built yet. | open |
| 11 | Save rating | The flow ended on the item page with no next step — the "ends abruptly" complaint. | Saving the first ratings now routes to `/app/first-rating`: "You ranked 1 title · 3 more comparisons and your ranking is solid", a progress bar, and a one-tap next duel. | fixed |
| 12 | Return visit | No email, no prompt, and the home screen shows whatever the algorithm picked. | First-rating screen doubles as the re-entry point via "See my ranking"; a reminder needs email or push (PROMPT 11). | open |

## What the new pieces cost

- `/demo` reads the tour profile and pod on every request (`force-dynamic`), two
  indexed queries, no auth, no writes.
- `/app/first-rating` reads `tasteStats` (one aggregate) and one unrated item,
  and redirects away once the account has four ratings, so it can never become a
  permanent interstitial.
- The review API gained one additive field, `ratedCount`, which the rate screen
  uses only to choose the post-save destination.

## Measurement

The steps that matter are 1 → 5 (landing to signup) and 9 → 11 (first duel to
saved rating). Until `feed_events` exists (`docs/FEATURES_PODIUMS_GAPS.md` §4)
the only signals are server logs and the `rating_events` rows the first save
writes; both are enough to count "signed up" vs "rated once", not where they
stopped.

## Known gaps this pass did not touch

- No opponent fallback on the rate screen (step 9) — the dead end is real, it
  just needs a product decision about cross-kind matchups.
- Onboarding still allows saving zero interests (step 8).
- Password rules are validated server-side only; the client shows a hint, not a
  live check.
