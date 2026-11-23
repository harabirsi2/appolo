# Rating integrity and import provenance

## Rule

A rating must come from an explicit user action or an explicit rating the user
exported from another service. Listening history is not a rating.

The old Spotify importer violated this rule: it turned the order of
`/me/top/tracks` into scores from 10 down to 6. That made a popularity/listening
signal look like a considered preference and contaminated rankings, taste
comparison and community scores. It also could not be distinguished afterwards
because `item_ratings` had no provenance.

## Current behavior

`item_ratings.source` records how a score was created:

| Value | Meaning |
| --- | --- |
| `user` | Explicit manual score, vote, review edit or other in-product rating action |
| `letterboxd` | Explicit Letterboxd rating imported from a CSV |
| `goodreads` | Explicit Goodreads rating imported from a CSV |
| `spotify_import_legacy` | Reserved for a confirmed old Spotify row; never written automatically |
| `NULL` | The row predates provenance; origin is unknown |

The Spotify import now creates or reuses catalog items and adds them to the
user's watchlist. It writes **no `item_ratings` row and no rating event**. The
track stays unrated until the user scores it, at which point normal ranking
rules apply and `source` becomes `user`.

CSV imports still create ratings because those files contain explicit ratings,
not listening history. Their rows are tagged `letterboxd` or `goodreads`.

## Existing rows: non-destructive handling

No migration backfills or deletes old ratings. This is deliberate:

- Marking every pre-provenance row as `user` would silently legitimize old
  Spotify imports.
- Marking every pre-provenance music row as Spotify would overwrite legitimate
  user ratings.
- Deleting old rows would lose user data and history.

Legacy rows keep `source = NULL` and remain usable. Any explicit action by the
owner (manual score, vote, review save) upgrades that row to `source = 'user'`.

### Candidate audit view

`legacy_spotify_import_candidates` lists rows that look like the old import:
music items whose only rating event is `Imported: ...`, with no matchup, review,
photo, favourites, sub-scores or highlights. It is a read-only view with RLS
enforced through `security_invoker`.

```sql
select rating_id, org_id, title, manual_score, elo, created_at
from legacy_spotify_import_candidates
order by created_at;
```

This view is evidence, not an automatic verdict. Inspect candidates with the
account owner before changing anything. A confirmed row can be re-rated through
the normal item page, which makes its provenance explicit and lets the user
choose the score. If a future product decision hides confirmed legacy imports
from ranking surfaces, it must still retain the rows and their history; do not
delete them.

## Verification

`pnpm test:imports` runs against a real database:

1. A mocked Spotify top-tracks response creates catalog/watchlist entries and
   asserts zero `item_ratings` and zero `rating_events`.
2. An explicit score on that imported track ranks normally, and the saved
   provenance is `user`.
3. A Goodreads CSV import keeps its rating and records `source = 'goodreads'`.

The test creates an isolated org and removes its rows and catalog fixtures
afterwards.
