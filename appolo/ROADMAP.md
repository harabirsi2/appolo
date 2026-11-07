# Appolo — Roadmap

Phased build plan from foundations to Podium-class parity. Each phase ships
something usable and independently testable. Sizing is relative effort
(`S` ≈ days, `M` ≈ 1–2 weeks, `L` ≈ 3–5 weeks for one focused developer),
not calendar promises.

Reference IDs match `FEATURE_MAP.md`.

---

## Phase 0 — Foundations (M)

**Goal:** a secure, multi-tenant shell with auth and roles.

- Repo scaffold (pnpm workspaces, `apps/web`, `apps/worker`, `packages/*`).
- Postgres + Drizzle, migration tooling, seed script, RLS policies.
- Auth (magic link + password + TOTP), sessions, org/location creation.
- RBAC permission matrix in `core`, enforced in API and UI. (PL-01, PL-02)
- App shell: navigation, empty states, design system, error boundaries.
- CI: typecheck, lint, unit tests, migration check.
- Observability baseline: structured logs, health endpoint, Sentry.

**Exit:** two orgs cannot see each other's data (automated cross-org test);
a user can sign up and land on an empty dashboard.

---

## Phase 1 — Contacts + Inbox (L)

**Status:** shipped — see the Phase 1 section of `README.md`.

**Goal:** the core loop — receive a message, see the contact, reply.

- Contacts CRUD, channels, normalization, CSV import/export, tags. (CT-01, CT-03, CT-04)
- Consent records + enforcement middleware. (CT-07, MS-09)
- Channels: SMS (Twilio sandbox), webchat widget (SSE). (MS-01, MS-12)
- Conversations: states, assignment, internal notes, unread. (MS-02, MS-03)
- Message send pipeline with queue, idempotency, delivery receipts.
- Saved replies. (MS-04)
- Inbox UI with filters and realtime updates.

**Exit:** inbound SMS/webchat creates a contact + conversation; a reply is
delivered; STOP blocks all sends and is recorded.

---

## Phase 2 — Review requests + landing pages (L)

**Status:** shipped — see the Phase 2 section of `README.md`.

**Goal:** the review acquisition engine.

- Templates with variables + template editor. (RV-05)
- Review requests: single + bulk, send timing, quiet hours, caps. (RV-01, RV-06)
- Short links/tokens; public review landing page. (RV-17, RV-02)
- Multi-platform routing + optional private feedback. (RV-03, RV-04)
- Follow-up cadence + stop-on-abort logic. (RV-07)
- Contact review status tracking. (RV-09)
- Business hours / away messages. (MS-08)
- Phone number provisioning + A2P 10DLC status UI. (MS-10)
- Email channel (2-way). (MS-13)

**Exit:** request → click → private feedback or public link, with status visible;
opt-outs and quiet hours honored.

---

## Phase 3 — Review management + automations + reporting (L)

**Status:** shipped — see the Phase 3 section of `README.md`.

**Goal:** manage reviews and automate the funnel.

- Unified review inbox (filters, status, assignment). (RV-10)
- Google Business Profile sync + reply publishing. (RV-13, RV-12)
- Facebook Page reviews (if app review approved). (RV-14)
- AI reply drafting (human-approved) with policy limits. (RV-11, AI-13)
- Review widget (embeddable, schema.org). (RV-16, WB-01)
- Keyword automations + automation builder (trigger/step/branch). (MS-07)
- Campaigns/broadcasts with segments. (MS-06)
- Analytics: review + dashboard rollups, CSV export. (RV-18, RP-01, RP-02)
- Contact timeline. (CT-02)
- Audit log UI. (PL-03)

**Exit:** reviews sync every ≤15 min; a reply can be drafted by AI and published;
automations and broadcasts run with consent and caps.

---

## Phase 4 — AI Employee (L)

**Goal:** answer, qualify, book, hand off.

- AI gateway with provider adapters, budgets, caching.
- Orchestrator + tools + guardrails. (AI-01, AI-02, AI-12)
- Knowledge base ingestion + RAG with citations. (AI-06)
- Playbooks per location. (AI-07)
- Calendar connect + availability + booking/reschedule/cancel. (AI-03)
- Confirmations + reminders. (AI-04)
- Human handoff with summary; summaries + next best action. (AI-08, AI-09)
- Model evaluation harness + golden set in CI. (AI-16)
- Multi-platform connectors (BBB/DealerRater import, social DMs). (RV-15, MS-14)
- Team metrics; location comparison. (MS-17, RP-06)
- API keys + outbound webhooks + public API. (PL-05)
- Calls: click-to-call, voicemail, transcription. (MS-11)
- Contact merge; export/delete. (CT-06, CT-09)

**Exit:** an unanswered inbound text is answered by AI, books an appointment on a
real calendar, and escalates to a human when required — all audited.

---

## Phase 5 — AI Studio, branding, integrations (M–L)

- AI Studio: performance view, sandbox, transcript review, escalation rules. (AI-10)
- Brand voice, languages, cost/usage controls. (AI-11, AI-17)
- Database reactivation campaigns. (AI-05)
- Branding + custom domains. (PL-07)
- Plan gating / feature flags (billing **state** only). (PL-08)
- Integrations: Google/Outlook calendar, HubSpot, Salesforce, Mailchimp,
  QuickBooks, Shopify, Mindbody, Nextech. (PL-06)
- Google Business Profile management: hours, posts, photos, Q&A. (LS-01)
- Scheduled reports. (RP-05)
- Mobile PWA polish. (MS-18)
- Onboarding checklist. (PL-09)

**Exit:** org can white-label, connect a CRM, and see AI performance; trial
gating works without any payment processing.

---

## Phase 6 — Optional parity / differentiators (D)

Deferred by design; build only if demand is proven.

- Voice AI answering. (AI-14)
- Simple website builder. (WB-03)
- Directory sync (NAP). (LS-02)
- Competitor/local benchmark. (RV-24)
- Free public reputation audit lead magnet. (RP-07)
- Dispute/flag workflow polish. (RV-23)

---

## Explicitly excluded (never in scope)

Payments, financing, wallet, lending, card processing, money movement.

---

## Cross-cutting workstreams (every phase)

- **Tests:** unit (domain), integration (API + DB), e2e (critical flows), AI evals.
- **Security:** RLS tests, dependency scanning, secret scanning, pen-test before GA.
- **Docs:** API reference, admin guide, help center.
- **Observability:** traces on message/AI paths, dashboards, alerts.
- **Data:** retention jobs, exports, deletion.

---

## MVP cut line

Phases 0–3 are the MVP: a working reputation + messaging product.
Phase 4 is the differentiator. Phases 5–6 are expansion.

---

## Open decisions (need sign-off before Phase 0)

1. **Stack** — confirm Next.js 15 + Postgres 16 + Drizzle + Redis/BullMQ
   (recommended) or a different preference.
2. **Hosting** — Fly.io / Render / Railway / own VPS + managed Postgres.
3. **SMS provider** — Twilio (recommended) vs Telnyx (cheaper, less tooling).
4. **Email provider** — Resend vs Postmark.
5. **AI provider(s)** — which models for turns vs drafting; budget ceiling.
6. **Google Business Profile API** — start the project/approval process now
   (long lead time); confirm willingness to complete it.
7. **Repo location** — build under `appolo/` in this repo, or a separate repo?
8. **Brand/assets** — logo, colors, name lock ("Appolo" confirmed?).
9. **Launch region** — US-first (10DLC) or other, affects SMS compliance work.