# Appolo

Appolo is a reputation and messaging platform for local businesses: reviews,
a shared inbox, review requests, campaigns, automations, reporting and an AI
employee with human handoff. It does not handle payments.

The application is a pnpm monorepo under [`appolo/`](appolo/):

- `apps/web` — Next.js 15 web app and API
- `apps/worker` — background jobs
- `packages/{db,core,config,ui}` — database, ranking/domain logic, config and UI

## Run it

Requires Node 20+, pnpm 9.15.4 and PostgreSQL 14+.

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
cd appolo
pnpm install

# Start a local Postgres (Windows script) or use Docker:
#   docker compose up -d postgres redis
#   cp .env.example .env
pnpm db:up

pnpm db:migrate
pnpm db:seed
pnpm dev
```

The web app runs at http://localhost:3000. See
[`appolo/README.md`](appolo/README.md) for the demo login, Docker setup and
feature details.

## Test and verify

Run these from `appolo/`:

```bash
pnpm test       # core unit tests, including ranking-quality checks
pnpm typecheck  # TypeScript across the workspace
pnpm e2e        # end-to-end suite
pnpm verify     # preflight, DB guard, typecheck, unit, e2e and visual suites
```

`pnpm verify` needs the local database and Playwright browser dependencies
available.

Architecture and ranking details live in
[`appolo/ARCHITECTURE.md`](appolo/ARCHITECTURE.md) and
[`appolo/docs/RANKING_SYSTEM.md`](appolo/docs/RANKING_SYSTEM.md).
