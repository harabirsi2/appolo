# Testing

What runs, how to run it, and what is not covered.

## Prerequisites

- PostgreSQL reachable through `DATABASE_URL` (see `docker-compose.yml` or a
  local instance; `pnpm db:migrate && pnpm db:seed` for a fresh database).
- The app running at `http://localhost:3000` for the browser suites:
  `pnpm dev:web` or `pnpm build && pnpm --filter @appolo/web start`.
- Chromium for Playwright once per machine:
  `pnpm exec playwright install chromium`.

## Suites

| Command | What it covers | Current result |
|---|---|---|
| `pnpm test` | Core logic: ranking model, Elo, taste similarity, feed ranking, community shrinkage, coordinated-vote detection | **44/44** |
| `pnpm preflight` | App reachable and database answering (`select 1`) | pass |
| `pnpm typecheck` | All workspaces | pass |
| `pnpm e2e` | 27 HTTP checks: health, auth guards, signup, rating, tie, undo, model rebuild, follow, feed explanations, taste comparison, moderation, export, deletion | **27/27** |
| `pnpm visual` | 8 screens, pixel comparison against committed baselines, 0.1% tolerance | **8/8** |
| `pnpm a11y` | axe-core on 8 screens; fails on serious/critical violations | **0 violations** |
| `pnpm verify` | preflight → typecheck → e2e → visual (the gate used before commits) | pass |

`VISUAL_UPDATE=1 pnpm visual` accepts intentional rendering changes and rewrites
the baselines in `scripts/visual-baselines/`. Review the generated
`scripts/visual-output/*.diff.png` before committing.

`pnpm a11y` downloads the pinned axe build from a CDN, so it needs network
access and is deliberately not part of `verify`.

## Test data

`pnpm e2e` creates two throwaway accounts (`alpha`, `beta`) with unique emails
and deletes both at the end. It uses a unique `x-forwarded-for` per run so the
auth rate limiter does not treat repeated runs as one client. The seed never
fabricates ratings for catalog entries.

## Visual suite scope

Screens: landing, login, home, rankings, browse, search, profile, taste.
It checks an `h1` with visible text, page and console errors, and pixel diffs.
It runs in the Chromium headless shell, so text extraction uses `textContent`
rather than `innerText`.

## Not covered

- Load and soak testing.
- API contract tests beyond the e2e script.
- Multi-browser rendering (only Chromium is exercised).
- Ranking quality against a ground-truth dataset; fits are checked for
  mathematical properties, not predictive accuracy.
- Accessibility beyond axe's automated rules (no manual screen-reader pass).
