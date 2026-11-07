# Appolo

A clean-room, Podium-class reputation and messaging platform.
Reviews, shared inbox, AI employee, contacts, reporting — **no payments.**

> **Status:** Phase 0 scaffold is implemented and runnable. See
> `ROADMAP.md` for what comes next.

## Documents

| File | Contents |
|---|---|
| [`FEATURE_MAP.md`](./FEATURE_MAP.md) | Every feature with ID, description, build-vs-integrate call, and phase |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Stack, data model, API surface, pipelines, AI subsystem, security, risks |
| [`ROADMAP.md`](./ROADMAP.md) | Phased plan, exit criteria, MVP cut line, open decisions |

## Quick start (Windows, no Docker)

Requires Node 20+ and PostgreSQL 14+ installed (the scripts find it under
`C:\Program Files\PostgreSQL\*\bin`, or set `PG_BIN`).

```powershell
corepack enable
corepack prepare pnpm@9.15.4 --activate

cd appolo
pnpm install

# Starts a self-contained cluster in ./.pgdata on port 55432.
# It does NOT touch any existing PostgreSQL service.
pnpm db:up

pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 and sign in:

```
owner@appolo.test
appolo-demo-1234
```

Stop the local database with `pnpm db:down`.

### With Docker instead

```bash
docker compose up -d postgres redis
cp .env.example .env
pnpm db:migrate && pnpm db:seed && pnpm dev
```

## What Phase 0 ships

- **Monorepo:** `apps/web` (Next.js 15 + Tailwind 4), `apps/worker` (BullMQ),
  `packages/{db,core,config,ui}`.
- **Multi-tenancy:** org → location → membership, with every tenant table
  protected by Postgres row-level security (`FORCE RLS`).
- **Auth:** email + password (scrypt), opaque hashed session tokens, http-only
  cookies, server-side session resolution.
- **RBAC:** owner / admin / manager / agent / viewer matrix enforced in server
  actions and API routes.
- **Schema:** 45 tables covering contacts, messaging, reviews, automations,
  AI, calendar, webhooks, imports/exports, audit.
- **UI:** marketing page, sign-up/sign-in, dashboard with live KPIs and recent
  reviews, locations CRUD, settings with member list and effective permissions.
- **API:** `/api/health`, `/api/me`, `/api/auth/*`, `/api/locations`.
- **Verification:** `pnpm db:rls-test` proves cross-org reads and writes are
  blocked.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | web + worker together |
| `pnpm dev:web` | Next.js only |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm build` | production build |
| `pnpm db:up` / `db:down` | local Postgres cluster on :55432 |
| `pnpm db:migrate` | apply migrations (`drizzle/` then `sql/`) |
| `pnpm db:seed` | demo org, user, contacts, reviews |
| `pnpm db:rls-test` | cross-tenant isolation test |
| `pnpm db:reset` | drop and recreate the schema (dev only) |
| `pnpm smoke` | HTTP end-to-end test (server must be running) |
| `pnpm run ci` | install → typecheck → migrate → seed → RLS test → build |

> Use `pnpm run ci`, not `pnpm ci` — `ci` is a pnpm builtin command.

## Repo layout

```
appolo/
  apps/web/            Next.js app (UI, API, landing pages)
  apps/worker/         BullMQ worker (idles without REDIS_URL)
  packages/db/         Drizzle schema, migrations, seed, RLS test
  packages/core/       RBAC, password hashing, tokens, validation
  packages/config/     env schema and constants
  packages/ui/         design system primitives
  drizzle/             generated SQL migrations
  sql/                 hand-written RLS and grant migrations
  scripts/             local Postgres + CI scripts
  docker-compose.yml   postgres, redis, minio, mailpit
```

## Security notes

- The app connects as a **non-superuser** role (`appolo_app`) so RLS is
  enforced. Migrations use the owner role.
- Sessions store only a SHA-256 hash of the token.
- `users`, `memberships`, `sessions`, `notifications`, and `job_locks` are
  intentionally outside RLS (identity plane); all application queries filter
  by user id.
- `FORCE ROW LEVEL SECURITY` is applied to tenant tables as defence in depth.
- Password hashing uses scrypt in Phase 0; Argon2id is a documented hardening
  step before GA.

## Clean-room statement

This project is an independent implementation built from publicly available
product information and general industry practice. It does not contain, copy, or
derive from Podium's proprietary source code, private APIs, or authenticated
product surfaces. All integration work uses documented third-party APIs or
user-provided exports. Product copy, terminology, and branding are original.

## Compliance posture

- No review gating or review incentives.
- Explicit, recorded consent per channel; STOP/HELP honored immediately.
- A2P 10DLC registration handled through the SMS provider (Phase 2).
- AI discloses itself; no impersonation of named humans.
- Data export and deletion supported per org.