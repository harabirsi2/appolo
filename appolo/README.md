# Appolo

A clean-room, Podium-class reputation and messaging platform.
Reviews, shared inbox, AI employee, contacts, reporting — **no payments.**

> **Status:** Phase 0 (foundations), Phase 1 (contacts + inbox), Phase 2
> (review requests + landing pages), and Phase 3 (review management,
> automations, campaigns, reporting) are implemented, verified, and committed.
> See `ROADMAP.md` for what comes next.

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

## What Phase 1 ships (contacts + inbox)

- **Contacts:** CRUD, phone/email/social channels with normalization, tags,
  duplicate-aware CSV import, and CSV export.
- **Consent ledger:** append-only records per channel; the send pipeline checks
  the latest record before anything leaves the system. STOP/START/HELP keywords
  are parsed on inbound SMS.
- **Channels:** SMS via a mock adapter by default (or the Twilio REST API when
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` are set),
  plus an embeddable web chat widget at `/embed/[key]`.
- **Inbox:** conversation list with status/channel filters, assignment, internal
  notes, unread counts, and 5-second polling refresh.
- **Send pipeline:** consent-gated outbound messages, provider delivery, Twilio
  inbound + status webhooks, and idempotent inbound persistence.
- **Saved replies:** org-wide and per-user, insertable from the composer.
- **Verification:** `pnpm smoke` now includes end-to-end Phase 1 checks
  (inbound creates a contact + conversation, send is blocked without consent,
  consent unlocks a delivered reply, STOP revokes consent and closes the thread,
  web chat round-trips).

## What Phase 2 ships (review requests + landing pages)

- **Review templates:** per-org SMS/email templates with `{{first_name}}`,
  `{{business_name}}`, `{{location_name}}`, and `{{review_link}}` variables,
  seeded defaults, and a create/delete editor on the Reviews page.
- **Request engine:** single and bulk requests from contacts, with consent,
  quiet-hours, per-contact cooldown, and daily-cap checks before anything sends.
  Requests are logged as messages in the shared inbox.
- **Email channel:** outbound email through a mock adapter by default or the
  Resend REST API when `RESEND_API_KEY` / `EMAIL_FROM` are set. Review email
  templates include a subject line.
- **Follow-up cadence:** configurable reminders for requests that go quiet
  (`followUp.days` / `followUp.max`), minting a fresh short link each time.
  Consent and quiet hours are re-checked on every reminder.
- **Tokenized landing page:** `/r/[token]` shows the business name, a star
  rating, and public review buttons for Google/Facebook. Private feedback is
  optional and never gates or blocks the public link.
- **Landing branding:** org logo, accent colour, tagline, and support email,
  editable from the Reviews page and applied to every public review link.
- **Public API:** `/api/public/reviews/[token]` resolves a link and records the
  click; `/api/public/reviews/feedback` accepts private feedback.
- **Review inbox:** recent public reviews, per-review reply drafts, platform
  list, and a sync action.
- **Platform sync:** a demo adapter for every platform plus a documented Google
  Business Profile v4 adapter behind `GOOGLE_BUSINESS_ACCESS_TOKEN`. No scraping.
- **Settings:** quiet hours, timezone, daily cap, cooldown, and default platform,
  editable from the Reviews page and via `/api/reviews/settings`.
- **Verification:** `pnpm smoke` covers template creation, quiet-hours blocking,
  send, token resolution, the public landing page, private feedback, review
  stats, and platform sync.

## What Phase 3 ships (review management + automations + reporting)

- **Review inbox:** filters for platform, rating, reply state, assignee, flags,
  and free-text search, all over `/api/reviews`. Each row shows the latest
  draft or posted reply.
- **Reply workflow:** save a draft, generate an AI (or deterministic heuristic)
  draft with a tone, then publish with one click. Publishing calls the platform's
  documented reply endpoint when available (Google Business Profile `updateReply`)
  and otherwise records the reply locally. Drafts are always human-approved.
- **Assignment + flags:** assign a review to a teammate and flag/unflag it for
  follow-up. Both are audited.
- **Embeddable review widget:** one widget per org with a public key, configurable
  headline/theme/layout/minimum rating/count, served at `/embed/reviews/[key]`
  and `/api/public/widgets/[key]`, with schema.org `AggregateRating` JSON-LD.
- **Keyword automations:** create automations that auto-reply when an inbound SMS
  or webchat message contains (or exactly matches) a keyword. Replies respect
  consent, render `{{first_name}}` / `{{business_name}}`, and record runs.
- **Campaigns / broadcasts:** send one message to `all` contacts or a `tag`
  segment. Consent is enforced per recipient (blocked sends are recorded as
  skipped), quiet hours block the whole send, and the org daily cap applies.
- **Reporting:** `/app/reports` shows review volume, rating distribution, reply
  rate, request funnel, and breakdowns by platform and location for a chosen
  range. `/api/reports` returns the same rollup as JSON.
- **Contact timeline:** contact detail pages merge messages, consent changes,
  review requests, and automation events into one feed.
- **Audit log:** `/app/audit` lists review replies, assignments, automation
  changes, campaign sends, and exports, newest first.
- **CSV export:** `/api/reviews/export` streams a CSV of every review.
- **Verification:** `pnpm smoke` covers the filters, AI draft, publish,
  assignment/flag, widget + JSON-LD, reports, CSV export, keyword auto-reply,
  campaign send with consent, the audit log, and the contact timeline.

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