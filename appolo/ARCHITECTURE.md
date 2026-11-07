# Appolo — Architecture

Companion to `FEATURE_MAP.md`. This document specifies the stack, data model,
API surface, background processing, AI subsystem, and operational constraints
for the clean-room implementation.

---

## 1. Design principles

1. **Consent first.** No message leaves the system without a checked consent
   record for that channel. Consent is data, not a boolean on the contact.
2. **Platform truth is external.** Reviews live on Google/Meta/etc. Appolo
   stores a synced projection plus an immutable local audit of what we saw and
   what we posted.
3. **Everything is org-scoped.** Every table carries `org_id`; row-level
   security enforces it at the database, not only in application code.
4. **Async by default.** Sends, syncs, AI calls, and imports are queued jobs
   with retries and idempotency keys.
5. **Provider-swappable.** SMS, email, LLM, and calendar providers sit behind
   internal interfaces so a vendor can be replaced without touching domain code.
6. **Boring tech.** Postgres, Redis, TypeScript, React. No exotic infrastructure
   required to run the MVP.

---

## 2. Recommended stack

| Layer | Choice | Why | Alternative |
|---|---|---|---|
| Web app | Next.js 15 (App Router) + React 19 + TypeScript | One deployable for dashboard, public pages, widget host, and API | Remix, SvelteKit |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, accessible primitives | MUI, Chakra |
| API | Next.js route handlers + Zod validation; optional tRPC internally | Simple, typed, no separate service to run | NestJS, Fastify |
| DB | PostgreSQL 16 | JSONB, full-text, `pg_trgm`, `pgcrypto`, strong RLS | — |
| ORM | Drizzle ORM | Typed SQL, migrations as files, good RLS support | Prisma |
| Cache / queue | Redis 7 + BullMQ | Mature job model, delayed jobs, repeatables | pg-boss (no Redis) |
| Auth | Auth.js (NextAuth) or better-auth; email magic link + password + TOTP | Sessions, org membership, invites | Clerk (hosted) |
| SMS/MMS/voice | Twilio (or Telnyx) | 10DLC handling, webhooks, MMS, voice | Bandwidth |
| Email | Resend or Postmark (inbound + outbound) | Reliable delivery, inbound parsing | SendGrid |
| AI | Provider-agnostic gateway (OpenAI, Anthropic, local) behind one interface | Avoid lock-in, route by cost/capability | LangChain (heavy) |
| Vectors | `pgvector` in Postgres | One database for MVP | Qdrant, Pinecone |
| Files | S3-compatible (Cloudflare R2 / MinIO) | Media, imports, exports | — |
| Realtime | SSE for webchat + in-app notifications | Simple, proxy-friendly | WebSocket |
| Observability | OpenTelemetry + Sentry + structured JSON logs | Trace a message end-to-end | — |
| Deploy | Docker Compose locally; Fly.io / Render / Railway / VPS + managed Postgres | Low ops | Kubernetes (overkill) |

**Default recommendation:** Next.js 15 + Postgres 16 + Drizzle + Redis/BullMQ +
Twilio + Resend + pgvector. Single repo, two processes (`web`, `worker`).

---

## 3. High-level diagram

```
                    ┌──────────────────────────────────────────┐
  Browser / PWA ───▶│  Next.js app (apps/web)                  │
  Public pages  ───▶│  - dashboard, inbox, reviews, reports    │
  Widget embed  ───▶│  - public review landing pages           │
                    │  - REST /api/v1 + webhook receivers      │
                    └───────┬───────────────┬──────────────────┘
                            │               │
                    ┌───────▼──────┐  ┌─────▼─────────────┐
                    │ PostgreSQL   │  │ Redis + BullMQ    │
                    │ + pgvector   │  │ queues / cache    │
                    └───────▲──────┘  └─────┬─────────────┘
                            │               │
                    ┌───────┴───────────────▼──────────────────┐
                    │  Worker (apps/worker)                    │
                    │  send-sms · send-email · sync-reviews    │
                    │  run-automation · ai-turn · import-csv   │
                    │  schedule-reminders · webhook-delivery   │
                    └───┬──────────┬──────────┬───────────┬────┘
                        │          │          │           │
                   ┌────▼───┐ ┌────▼────┐ ┌───▼─────┐ ┌───▼────────┐
                   │ Twilio │ │ Resend  │ │ Google  │ │ LLM provider│
                   │ SMS/MMS│ │ email   │ │ BP API  │ │ + embeddings│
                   └────────┘ └─────────┘ └─────────┘ └────────────┘
```

Two deployable processes, one database, one queue. Scale the worker horizontally.

---

## 4. Repository layout

```
appolo/
  apps/
    web/                 Next.js app (UI + API + public pages + widget)
    worker/              BullMQ consumers and schedulers
  packages/
    db/                  Drizzle schema, migrations, seeds, RLS policies
    core/                Domain services, Zod schemas, pure business rules
    integrations/        twilio/, email/, google-business/, meta/, calendar/
    ai/                  Gateway, prompts, tools, RAG, guardrails, evals
    ui/                  Shared components and design tokens
    config/              Env validation, feature flags, constants
  docs/
    FEATURE_MAP.md
    ARCHITECTURE.md
    ROADMAP.md
    API.md               (generated/extended during build)
  infra/
    docker-compose.yml
    Dockerfile.web
    Dockerfile.worker
  package.json           pnpm workspaces
  turbo.json
```

Boundaries: `core` never imports a provider SDK; `integrations` implements
interfaces declared in `core`; `web` and `worker` compose them.

---

## 5. Multi-tenancy and identity

```
orgs (tenant root)
  └── locations (1..n)
        └── users ── memberships (role, location scope)
              └── sessions
```

- Every domain row has `org_id` (and `location_id` where relevant).
- Postgres RLS policies use `current_setting('app.org_id')`, set per request/job
  inside a transaction. Application filters remain as defense in depth.
- Roles: `owner`, `admin`, `manager`, `agent`, `viewer`.
- Permission matrix is code (`packages/core/auth/permissions.ts`) and is the
  single source of truth for both API and UI gating.

| Capability | owner | admin | manager | agent | viewer |
|---|---|---|---|---|---|
| Manage org/billing state | ✓ | ✓ | – | – | – |
| Manage users/roles | ✓ | ✓ | – | – | – |
| Manage locations | ✓ | ✓ | ✓ | – | – |
| Send messages | ✓ | ✓ | ✓ | ✓ | – |
| Manage reviews/replies | ✓ | ✓ | ✓ | ✓ | – |
| Edit automations/AI playbooks | ✓ | ✓ | ✓ | – | – |
| View reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✓ | – | – |

---

## 6. Data model

All tables have `id uuid pk`, `org_id uuid`, `created_at`, `updated_at`, and
soft-delete where auditability matters.

### Identity & tenancy
- **orgs** — name, slug, plan_tier, trial_ends_at, settings jsonb
- **locations** — org_id, name, address, timezone, phone, hours jsonb, gbp_account_id
- **users** — email, name, password_hash, totp_secret, email_verified_at, last_seen_at
- **memberships** — user_id, org_id, role, location_ids uuid[], status
- **sessions** — user_id, token_hash, expires_at, ip, user_agent
- **api_keys** — org_id, name, key_hash, scopes, last_used_at, revoked_at
- **audit_logs** — org_id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip

### Contacts
- **contacts** — org_id, name, company, notes, owner_id, source, merged_into_id
- **contact_channels** — contact_id, kind (phone|email|social), value, normalized_value, verified_at, is_primary
- **contact_tags** / **tags**
- **custom_fields** (org-scoped definition) / **contact_custom_values**
- **consent_records** — contact_id, channel, status (granted|revoked), source, captured_at, ip, evidence jsonb
- **contact_events** — timeline projection (message, review, appointment, note, consent)

### Messaging
- **channels** — org_id, location_id, kind (sms|email|webchat|fb|ig|gbm), provider, provider_ref, config jsonb, status
- **phone_numbers** — org_id, e164, provider_sid, capabilities, a2p_status, country
- **conversations** — org_id, location_id, contact_id, channel_id, status, assignee_id, priority, snoozed_until, last_message_at, unread_count
- **messages** — conversation_id, direction, sender_type (contact|user|ai|system), sender_id, body, media jsonb[], provider_sid, status (queued|sent|delivered|failed|received), error_code, sent_at
- **message_events** — message_id, event, payload jsonb, occurred_at (delivery receipts, reads)
- **internal_notes** — conversation_id, author_id, body, mentions uuid[]
- **saved_replies** — org_id, scope, title, body, variables, owner_id
- **schedules** — business hours, holidays, per-location timezone

### Reviews
- **review_platforms** — org_id, kind (google|facebook|bbb|dealerrater|yelp|custom), display_name, external_ref, credentials_ref
- **review_requests** — org_id, contact_id, location_id, employee_id, channel, template_id, status, sent_at, clicked_at, reviewed_at, platform_kind, campaign_id
- **review_tokens** — token_hash, request_id, expires_at, clicked_at, user_agent, ip (short public links)
- **reviews** — org_id, location_id, platform_id, external_id, author_name, rating, body, language, reviewed_at, url, reply_status, sentiment, raw jsonb
- **review_replies** — review_id, body, status (draft|approved|posted|failed), posted_at, external_id, author_id, ai_generated
- **private_feedback** — org_id, contact_id, request_id, rating, body, status, assigned_to
- **review_widgets** — org_id, location_id, config jsonb, public_key

### Automations & campaigns
- **automations** — org_id, name, trigger (event|keyword|schedule), conditions jsonb, enabled, version
- **automation_steps** — automation_id, order, kind (send|wait|branch|tag|assign|ai), config jsonb
- **automation_runs** — automation_id, contact_id, state, current_step, next_run_at, last_error
- **campaigns** — org_id, name, channel, segment jsonb, template_id, status, scheduled_at
- **campaign_recipients** — campaign_id, contact_id, status, message_id, error

### AI
- **ai_agents** — org_id, location_id, name, enabled, model, voice_profile, goals jsonb, guardrails jsonb
- **ai_playbooks** — agent_id, name, version, instructions, allowed_tools text[], escalation_rules jsonb, status
- **ai_knowledge_docs** — org_id, location_id, title, source_type, source_ref, status, checksum
- **ai_knowledge_chunks** — doc_id, content, embedding vector(1536), token_count, metadata jsonb
- **ai_conversations** — conversation_id, agent_id, state, handoff_at, handoff_reason, csat
- **ai_turns** — ai_conversation_id, role, content, tool_calls jsonb, tokens_in, tokens_out, cost_usd, latency_ms, model
- **ai_evals** / **ai_eval_runs** — golden cases and results

### Calendar
- **calendars** — org_id, location_id, provider, external_id, timezone
- **appointments** — org_id, contact_id, calendar_id, starts_at, ends_at, status, service, source, external_id
- **availability_rules** — calendar_id, weekday, start_time, end_time, slot_minutes, buffer_minutes

### Platform/ops
- **webhook_endpoints** — org_id, url, secret, events text[], enabled
- **webhook_deliveries** — endpoint_id, event, payload, attempts, status, response_code
- **imports** / **exports** — org_id, kind, status, file_key, stats jsonb, errors jsonb
- **notifications** — user_id, kind, payload, read_at
- **feature_flags** — org_id nullable, key, value jsonb
- **job_locks** — key, owner, expires_at (idempotency for syncs)

### Key indexes
```
messages(conversation_id, created_at desc)
conversations(org_id, status, last_message_at desc)
contacts(org_id, lower(name)); contact_channels(normalized_value)
reviews(org_id, platform_id, reviewed_at desc); unique(platform_id, external_id)
review_requests(org_id, status, sent_at); review_tokens(token_hash) unique
consent_records(contact_id, channel, captured_at desc)
ai_knowledge_chunks using ivfflat (embedding vector_cosine_ops)
audit_logs(org_id, created_at desc)
```

---

## 7. API surface

Base: `https://app.appolo.example/api/v1`
Auth: session cookie (dashboard) or `Authorization: Bearer <api_key>` (integrations).
All mutations accept `Idempotency-Key`; all lists accept `cursor`, `limit` (≤100).

```
POST   /auth/login | /auth/logout | /auth/magic-link | /auth/verify
GET    /me
GET    /orgs/:orgId
GET    /orgs/:orgId/locations            POST/PATCH/DELETE ...
GET    /orgs/:orgId/members              POST/PATCH/DELETE ...

# Contacts
GET    /contacts?query=&tag=&location=
POST   /contacts
GET    /contacts/:id
PATCH  /contacts/:id
POST   /contacts/import                  (multipart csv)
GET    /contacts/export
POST   /contacts/:id/merge
GET    /contacts/:id/timeline
POST   /contacts/:id/consent | DELETE /contacts/:id/consent

# Messaging
GET    /conversations?status=&assignee=&channel=
POST   /conversations
GET    /conversations/:id
PATCH  /conversations/:id                (status, assignee, priority)
GET    /conversations/:id/messages
POST   /conversations/:id/messages       (send)
POST   /conversations/:id/notes
GET    /saved-replies                    POST/PATCH/DELETE ...
POST   /campaigns                        GET /campaigns/:id
POST   /campaigns/:id/send | /schedule | /cancel

# Reviews
POST   /review-requests                  (single or bulk)
GET    /review-requests?status=
POST   /review-requests/:id/resend
GET    /reviews?platform=&rating=&status=&location=
GET    /reviews/:id
POST   /reviews/:id/replies              (draft)
POST   /reviews/:id/replies/:rid/publish
POST   /reviews/:id/replies/:rid/approve
GET    /review-widgets/:publicKey/config
POST   /review-platforms/:id/sync

# Automations
GET    /automations                      POST/PATCH/DELETE ...
POST   /automations/:id/enable | /disable | /test

# AI
GET    /ai/agents                        POST/PATCH ...
GET    /ai/agents/:id/playbooks          POST/PATCH ...
POST   /ai/agents/:id/knowledge          (upload/URL)
POST   /ai/agents/:id/sandbox            (test a turn)
GET    /ai/reports/usage

# Calendar
GET    /calendars | /appointments        POST /appointments
GET    /availability?calendar=&from=&to=

# Reporting
GET    /reports/dashboard?from=&to=
GET    /reports/reviews?...              (csv via Accept)
GET    /reports/messaging
GET    /reports/ai

# Platform
GET    /webhooks                         POST/PATCH/DELETE ...
GET    /api-keys                         POST/DELETE ...
GET    /audit-logs
```

### Inbound webhooks (public, signature-verified)
```
POST /webhooks/twilio/sms        (X-Twilio-Signature)
POST /webhooks/twilio/status
POST /webhooks/twilio/voice
POST /webhooks/email/inbound     (provider signature)
POST /webhooks/google/reviews    (pub/sub or poll fallback)
POST /webhooks/meta/messages
POST /webhooks/webchat/:publicKey
```

Rules: verify signature → persist raw event with unique provider id (idempotent)
→ enqueue processing → return `200` fast. Never do heavy work inline.

### Outbound webhooks
Events: `contact.created`, `message.received`, `message.sent`,
`review.created`, `review.reply_posted`, `review_request.clicked`,
`appointment.booked`, `automation.completed`, `ai.handoff`.
Signed with `X-Appolo-Signature: t=<ts>,v1=<hmac>`; retries with exponential
backoff for 24h; dead-letter after 10 attempts.

---

## 8. Core pipelines

### 8.1 Review request → posted review

```
trigger (appointment.completed | manual | tag | campaign)
  → resolve contact + location + consent(sms|email)
  → pick template, render variables, generate short token
  → queue send (quiet hours, rate limit, dedupe window)
  → outbound message with https://r.appolo.example/<token>
  → customer opens landing page
      → records click, shows rating choice
      → optional private feedback form
      → deep link to chosen platform (Google/Facebook/...)
  → attribution window (14 days) correlates a new synced review
      → review_requests.status = reviewed
  → review sync job imports review
      → inbox, analytics, AI draft reply, notification
```

Attribution is **probabilistic and labeled as such** (same contact + platform +
time window). Never claim certainty.

### 8.2 Inbound message

```
provider webhook
  → verify + persist raw (idempotent on provider id)
  → normalize (E.164, email lower, social id)
  → find/create contact + conversation
  → consent check (STOP/HELP keyword handling first)
  → store message, emit contact event
  → run keyword automations
  → if AI enabled and no human active → queue ai-turn
  → realtime push to open inbox via SSE
```

### 8.3 Outbound message

```
API/automation/AI
  → validate consent + quiet hours + rate limits + template
  → create message(status=queued) + enqueue job
  → worker calls provider with idempotency key
  → status webhook updates message + emits event
  → failures retried with backoff; permanent failures surfaced in UI
```

### 8.4 Review sync

```
scheduler (every 15 min, per connected platform)
  → distributed lock (job_locks)
  → fetch since cursor (GBP API / Graph API)
  → upsert reviews by (platform_id, external_id)
  → detect new/changed/deleted
  → enqueue: notification, analytics refresh, AI draft
```

---

## 9. AI subsystem

### 9.1 Components

- **Gateway** — one `generate()` / `embed()` interface; provider adapters;
  retries, timeouts, token accounting, prompt caching.
- **Orchestrator** — builds context: contact, location, playbook, last N turns,
  retrieved knowledge, tool list. Enforces max turns and budget.
- **Tools** (allowlisted per playbook): `check_availability`, `book_appointment`,
  `reschedule`, `lookup_contact`, `send_template`, `tag_contact`,
  `handoff_to_human`, `create_note`. Each tool validates args with Zod and
  re-checks permissions server-side.
- **RAG** — chunk docs (400–800 tokens, 10–15% overlap), embed, store in
  pgvector, retrieve top-k with metadata filters (location, doc type), inject
  with citations. Re-index on doc change (checksum).
- **Guardrails** — input: prompt-injection patterns, PII detection/redaction;
  output: banned-topic classifier, policy checks, length limits, no fabricated
  prices/hours (must come from tools/knowledge).
- **Human handoff** — trigger on explicit request, low confidence, sensitive
  topic, repeated failure, or playbook rule. Produces summary + suggested reply.
- **Evals** — golden set per industry: booking flow, hours question, price
  question, complaint, injection attempt, escalation. CI gate on regressions.

### 9.2 Model routing

| Task | Default class | Notes |
|---|---|---|
| Reply drafting | mid-tier chat model | Cheap, high volume |
| Conversation turn | mid/high-tier | Tool use + reasoning |
| Summaries | small model | Batchable |
| Embeddings | small embedding model | Cached by content hash |
| Eval judge | high-tier | Offline only |

Per-org token budget, per-conversation cap, and hard stop with handoff when
exceeded.

### 9.3 Safety

- AI never claims to be a specific human; disclosure configurable and default on.
- No medical, legal, or financial advice; escalate instead.
- No outbound sends to contacts without consent, even if the model asks.
- All tool calls are audit-logged with the triggering turn.
- Prompt-injection defense: treat retrieved docs and inbound messages as
  untrusted data; never let them alter tool permissions or system rules.

---

## 10. Background jobs

| Queue | Job | Retry | Notes |
|---|---|---|---|
| `send` | send-sms, send-email | 5, exp backoff | Idempotency key = message id |
| `sync` | sync-reviews, sync-calendar, sync-contacts | 3 | Distributed lock per platform |
| `automation` | run-automation-step | 3 | `next_run_at` drives waits |
| `ai` | ai-turn, ai-summary, ai-draft-reply, ai-embed | 2 | Budget check first |
| `import` | import-contacts, import-reviews | 1 | Chunked, resumable |
| `report` | refresh-daily-rollups, send-scheduled-report | 2 | Pre-aggregated tables |
| `webhook` | deliver-webhook | 10 | Signed, dead-letter |
| `maintenance` | prune-tokens, expire-sessions, retention | 1 | Nightly |

Schedulers use BullMQ repeatable jobs; all jobs are idempotent and safe to
re-run. Every job logs `org_id`, `job_id`, and correlation id.

---

## 11. Security & privacy

- TLS everywhere; HSTS; secure, http-only, same-site cookies.
- Passwords: Argon2id. Sessions: rotating opaque tokens, 30-day idle expiry.
- API keys: hashed at rest, shown once, scoped, revocable.
- Secrets in env/secret manager; never in the repo. Provider credentials
  encrypted at rest (`pgcrypto`) with a KMS-held key.
- RLS on all tenant tables; integration tests attempt cross-org access.
- Rate limits: per IP (auth), per org (send), per conversation (AI).
- PII: minimize in logs, redact in AI prompts where not needed, retention
  windows per org, export/delete endpoints.
- File uploads: type sniffing, size caps, virus scan hook, private buckets with
  signed URLs.
- Audit log for auth, permissions, exports, deletions, reply publishing,
  playbook changes, and impersonation.

---

## 12. Performance targets

| Metric | Target |
|---|---|
| Dashboard API p95 | < 300 ms |
| Inbox list p95 | < 250 ms |
| Message send → provider accept p95 | < 2 s |
| Inbound webhook accept p95 | < 150 ms |
| Review sync lag | < 15 min |
| AI first token | < 1.5 s (streamed) |
| Throughput (MVP) | 50k messages/day/org, 5k contacts/import batch |
| Availability | 99.9% web, at-least-once jobs |

---

## 13. Environments & delivery

- **Local:** `docker compose up` → Postgres, Redis, MinIO, Mailhog; `pnpm dev`
  runs web + worker.
- **Preview:** per-PR deploy with seeded demo org.
- **Prod:** web (2+ instances), worker (2+), managed Postgres with PITR,
  managed Redis, object storage, CDN for public pages/widget.
- **Migrations:** forward-only, reviewed, applied before deploy; no destructive
  change without a two-step rollout.
- **Feature flags** gate incomplete features per org.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Google Business Profile API access denied/delayed | No automatic review sync | Manual/CSV import + email parsing fallback; start the approval early |
| A2P 10DLC rejection | SMS blocked in US | Use provider-managed registration; surface status; email fallback |
| TCPA complaint | Legal exposure | Consent ledger, STOP handling, quiet hours, per-contact caps, audit |
| AI hallucination | Wrong price/hours, brand damage | RAG with citations, tool-only facts, banned-topic guard, human handoff, evals |
| Review gating temptation | Google penalties | Private feedback is optional and never blocks the public link; documented policy |
| Provider outage | Messages delayed | Queue + retry; secondary provider adapter; status page |
| Cost blowup (AI/SMS) | Margin loss | Budgets, caps, caching, model routing, usage dashboards |
| Multi-tenant data leak | Existential | RLS + cross-org test suite + least-privilege tokens |

---

## 15. Definition of done for the MVP

1. A new org can sign up, create a location, import contacts, connect a number.
2. Send a review request, click the link, leave private feedback or reach Google.
3. Receive an SMS reply, see it in the shared inbox, reply as a teammate.
4. Reviews sync from at least one platform and can be replied to.
5. Dashboard shows volume, rating, response rate, and open conversations.
6. All of the above audited, consent-enforced, and covered by automated tests.