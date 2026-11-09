# Appolo

Clean-room, responsive web app/PWA clone of Podiums (https://podiu.ms/). Next.js 15 + Postgres + Drizzle monorepo.

## Commands (run from `appolo/`)
- `pnpm run ci` — typecheck + lint + build + tests (use `pnpm run ci`, not `pnpm ci`)
- `pnpm typecheck`, `pnpm smoke`, `pnpm dev` (port 3000), `pnpm db:migrate`, `pnpm db:seed`

## Env / DB
- `appolo/.env`: `DATABASE_URL` (admin) and `MIGRATE_DATABASE_URL`.
- App DB: `postgresql://appolo_app:appolo_dev_password@127.0.0.1:55432/appolo`; admin: `postgresql://appolo@127.0.0.1:55432/appolo`.
- Demo login: `owner@appolo.test` / `appolo-demo-1234`.

## Gotchas
- Client components must import from `@appolo/core/ranking` (not the barrel — it pulls `node:crypto`).
- PowerShell treats `[`/`]` in paths as wildcards — use `-LiteralPath` or edit tool for `app/rate/[itemId]`, `app/item/[id]`, `[username]`.
- Stop `pnpm dev` before build/CI; delete `apps/web/.next` if chunks corrupt.
- `.env` and `.pgdata` are gitignored; never commit them.
- Tenant tables scoped via `app.org_id` (set by `withOrg`); social tables world-readable only when no tenant context.

## Key files
- `packages/db/src/schema.ts`, `packages/db/sql/0007_podium_parity.sql`, `packages/db/src/seed.ts`
- `packages/core/src/ranking.ts`
- `apps/web/lib/services/rankings.ts`, `apps/web/lib/services/social.ts`
- `apps/web/components/podiums.tsx`, `profile-screen.tsx`
- `apps/web/components/media-art.tsx` — renders covers from `imageUrl`, falls back to a kind glyph.
- `apps/web/public/covers/` — 56 cached cover images. `db:seed` fills missing art from TVmaze (TV), Wikipedia (film/game/music fallback), iTunes (music/podcast) and Open Library (books), then downloads it here so the app never hotlinks external images.
- `apps/web/scripts/smoke.ps1`

## Git
- Commit only inside `appolo/` (`git add .` from `appolo/`) to avoid unrelated root files.
- Identity: `dev <dev@local>`.
