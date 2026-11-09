# Appolo ranking system

Two layers cooperate:

1. **Elo ladder** (`packages/core/src/ranking.ts`) — fast incremental feedback and
   the 0–10 score shown in the UI. Kept for compatibility with every existing screen.
2. **Bradley–Terry + Davidson model** (`packages/core/src/ranking-model.ts`) — the
   statistical fit behind positions, uncertainty and comparison selection. It is
   reproducible from the comparison history.

## 1. Comparison events

`item_matchups` is append-only and remains the source of truth. Each row records the
item, opponent, result, Elo before/after, and (new) `outcome`:

| `result` | `outcome` | Meaning |
|---|---|---|
| `win` | `a` | The rated item wins |
| `loss` | `b` | The opponent wins |
| `tie` | `tie` | Explicit "equally good" |
| `undecided` | `undecided` | "Too close to call" — weaker evidence |
| `skip` | `skip` | No opinion; never changes a score |

Skips and undecided votes add no Elo delta. Ties move Elo halfway between the two
expected outcomes. The model treats `tie` as one Davidson tie and `undecided` as a
0.5-weighted Davidson tie; both are ignored for rank ordering only when the outcome
is `skip`.

## 2. Model

For items A and B with preference strengths θ:

```
P(A > B) = e^θA / (e^θA + e^θB + ν·e^((θA+θB)/2))
P(B > A) = e^θB / (same denominator)
P(tie)   = ν·e^((θA+θB)/2) / (same denominator)
```

`ν` (the Davidson tie parameter) defaults to **0.55**. It is stored in the model
snapshot and used consistently for predictions and personal scores.

### Estimation

Weighted log-likelihood minus an L2 prior:

```
L(θ) = Σ events w·log P(outcome | θ) − (λ/2)·Σ θᵢ²
```

- `λ` defaults to **0.6**, which keeps perfect records (e.g. 12–0) from diverging.
- Optimiser: damped Newton with backtracking line search, a trust region of 3 per
  coordinate, and a diagonal fallback above 220 items.
- Fisher information is the expectation over all three outcomes:
  `I = Σ P(o)·sₒ·sₒᵀ + λI`, where `sₒ = ∂logP(o)/∂(θA,θB)`.
- Convergence requires the Newton step or the objective improvement to fall below
  `1e-6` / `1e-9`. `RankingFit.converged` reports the result honestly.

### Identifiability

Only θA − θB changes a prediction, so the model is shift-invariant. Estimates are
centred (`mean θ = 0`) and standard errors are computed on the identified difference
subspace:

```
var_centred(i) = cov(i,i) − 2·mean_j cov(i,j) + mean_jk cov(j,k)
se(i) = sqrt(var_centred(i))
```

Without this, every item inherited the prior's `1/λ` variance and looked equally
uncertain.

### Personal score

```
personalScore(i) = 10 × mean_j P(i > j)
```

This is an **expected-wins** score, not an objective quality rating. A heavy tie rate
therefore pulls a score below 5 even when two items are perfectly level. The score is
relative to the items in the fit, so it is only comparable within a category/profile.

## 3. Comparison selection

`scoreInformativeOpponents` scores every candidate:

```
utility = H(p) × (0.35 + 0.65·uncertainty) × exposureBalance × repeatPenalty
          ÷ (1 + previousPairCount)
```

- `H(p) = −p log p − (1−p) log(1−p)` — an obvious matchup scores near zero.
- `uncertainty` averages the two standard errors (capped at 10, normalised to 0–1).
- `exposureBalance = 1 / sqrt(exposure/maxExposure + 1)` — less-shown items get a
  boost.
- `repeatPenalty = 0.25` for an opponent just shown; repeats of a pair decay as `1/(1+n)`.

`nextMatchup` uses this whenever a model exists, and falls back to the old Elo-distance
heuristic otherwise. Selection reads the model before opening the transaction so no
nested transaction is required.

## 4. Persistence and lifecycle

- `ranking_models` (one row per `org_id` + `kind`) stores a JSON snapshot:
  `{ items: FittedItem[], tieParameter, logLikelihood, converged, iterations }`.
- It is a cache. `item_matchups` can always rebuild it.
- `submitVote` commits the vote first, then refreshes the snapshot; a refresh failure
  is logged and does not fail the request.
- `GET /api/rankings/model?kind=movie` forces a rebuild and returns positions,
  personal scores, standard errors and intervals.
- Migration: `packages/db/sql/0012_ranking_model.sql` (adds `item_matchups.outcome`,
  `item_ratings.ties`, `ranking_models`, RLS policy, grant).

## 5. What the UI shows

- Elo-derived 0–10 score and win-rate badge (existing).
- "Equally good" (tie) and "Too close to call" (undecided) buttons, keys 3/4.
- "Undo last" next to Skip: restores the stored pre-comparison Elo values and
  counters, deletes the durable matchup row, removes the matching timeline event
  and rebuilds the model (`POST /api/rankings/:itemId/undo`).
- `/app/rankings?kind=…` now orders by fitted θ whenever a model exists and prints
  `model score · ±95% interval · comparisons · confidence` per row. The un-filtered
  "All" view continues to use the Elo ladder because it spans categories.
- Community scores are shrunk toward a neutral prior (see `community.ts`) before
  they are shown publicly, with a confidence label.

## 6. Tests

`packages/core/src/ranking-model.test.ts` (11 tests) covers:

- preferred item gets a higher θ and a 100% win rate;
- reversing the comparison reverses preference symmetrically;
- identical inputs reproduce identical θ and scores;
- skips never change the fit or comparison counts;
- explicit ties keep items level and produce valid expected-wins scores;
- undecided is weaker evidence than a decided win;
- uncertainty shrinks as comparisons accumulate;
- personal scores stay in 0–10 and rank correctly;
- Davidson probabilities sum to 1;
- entropy peaks at an even matchup;
- selection prefers an uncertain, unshown opponent and avoids an obvious one.

Run with `pnpm test` (uses `tsx --test`, so Node 20+ works). Including
`community.test.ts`, the suite is 24 tests.

## 7. Known limitations

- `ν` and `λ` are fixed constants, not hyperparameters estimated per user. The
  snapshot stores them so they can be tuned/replayed later.
- Taste matching keeps genre similarity to a 20% prior when shared titles exist;
  with no shared titles it is the only signal and is labelled as such.
- The fit is per media kind only; sub-category (genre) models and per-collection
  models are not implemented.
- Community scores now use fixed Bayesian-style shrinkage (`packages/core/src/community.ts`),
  but coordinated-voting detection and per-item robust aggregation are not implemented.
- No undo endpoint yet; because comparisons are durable events, undo can be added by
  appending a reversing event or deleting a row and refitting — no schema change
  needed.
- The "All" rankings view still orders by Elo; only a specific media kind uses θ.
