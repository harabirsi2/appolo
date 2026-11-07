# Appolo — Feature Map

Clean-room feature map for a Podium-class reputation & messaging platform.
Everything below is derived from **publicly visible product information** (marketing
pages, help centers, public docs, app store listings) and generic industry practice.
No Podium source code, private API, or authenticated UI was used.

**Scope:** reviews + messaging + AI + contacts + reporting + listings.
**Explicitly out of scope:** payments, financing, wallet, loans, card processing.

Legend: **B** = build in-house · **I** = integrate a provider · **D** = defer · **X** = excluded.

---

## 1. Product pillars

| # | Pillar | What it does | Why it matters |
|---|--------|--------------|----------------|
| P1 | **Reviews** | Ask for reviews, route customers to the right platform, manage and reply to every review in one inbox | Core reputation loop; primary acquisition wedge |
| P2 | **Messaging** | Shared team inbox across SMS, webchat, email, social DMs | Where review requests and leads actually happen |
| P3 | **AI Employee** | 24/7 answering, qualification, booking, reminders, re-engagement | The current market differentiator |
| P4 | **Contacts / CRM** | One profile per customer with a full timeline and consent state | Makes P1–P3 coherent |
| P5 | **Reporting** | Volume, rating, response rate, conversion, team and AI performance | Retention + upsell proof |
| P6 | **Listings & web** | Google Business Profile management, review widget, optional site builder | Feeds the review funnel |

---

## 2. Reviews (RV)

| ID | Feature | Description | How | Phase |
|----|---------|-------------|-----|-------|
| RV-01 | Review request via SMS/email | Send a personalized ask after a visit, job, or transaction | B | 2 |
| RV-02 | Review request via QR / short link / NFC | Printable and counter-top capture for walk-ins | B | 2 |
| RV-03 | Multi-platform routing | One request link that lets the customer choose Google / Facebook / BBB / DealerRater / industry sites | B | 2 |
| RV-04 | Policy-safe private feedback | Optional "tell us first" step that collects private feedback **without** blocking or filtering public reviews | B | 2 |
| RV-05 | Template library + variables | `{{first_name}}`, `{{service}}`, `{{employee}}`, `{{location}}`, `{{review_link}}` | B | 2 |
| RV-06 | Send timing & throttling | Delay after visit, quiet hours, max asks per contact per period | B | 2 |
| RV-07 | Follow-up cadence | One polite reminder max by default; stop on click/review/opt-out | B | 2 |
| RV-08 | Consent & opt-out ledger | Per-channel consent, STOP/HELP handling, immutable audit trail | B | 2 |
| RV-09 | Contact review status | invited → clicked → posted → declined → opted-out, per platform | B | 2 |
| RV-10 | Unified review inbox | Aggregate reviews from connected platforms, filter by location/platform/rating/status | B | 3 |
| RV-11 | Reply drafting (AI) | Draft on-brand, policy-safe replies; human approves | B | 3 |
| RV-12 | Reply publishing | Post replies back to the source platform where an API allows | I | 3 |
| RV-13 | Google Business Profile sync | Import reviews and publish replies via the official Business Profile API | I | 3 |
| RV-14 | Facebook Page reviews | Import and reply via Meta Graph API (subject to app review) | I | 3 |
| RV-15 | BBB / DealerRater / Yelp / others | API-less platforms: manual entry, email parsing, or CSV import | B/I | 4 |
| RV-16 | Review widget / public feed | Embeddable, SEO-friendly wall of reviews with schema.org markup | B | 3 |
| RV-17 | Public review landing page | Branded page per location with rating summary and platform buttons | B | 2 |
| RV-18 | Analytics | Volume, average rating, response rate, platform mix, trend, location/employee comparison | B | 3 |
| RV-19 | Employee attribution | Track which tech/agent drove the review; leaderboard | B | 4 |
| RV-20 | Historical import | Backfill past reviews and contacts via CSV | B | 4 |
| RV-21 | AI-personalized invite copy | Per-contact message variants generated from service context | B | 4 |
| RV-22 | Review request automation triggers | Fire on appointment completed, invoice paid (status only), tag added, or manual | B | 3 |
| RV-23 | Dispute / flag workflow | Internal flagging of policy-violating reviews with evidence notes | B | 5 |
| RV-24 | Competitor / local benchmark | Aggregate public rating comparison per market | D | 6 |

**Policy guardrails baked into the design**
- No review gating: every customer can always reach the public review form.
- No incentives for positive reviews, no stipulating a minimum rating.
- Private feedback is optional and never a condition of the public link.
- Platform terms respected; unsupported platforms are manual/import only.

---

## 3. Messaging (MS)

| ID | Feature | Description | How | Phase |
|----|---------|-------------|-----|-------|
| MS-01 | Shared inbox | One queue for SMS, webchat, email, Facebook/Instagram DMs | B | 1 |
| MS-02 | Conversation states | open / pending / snoozed / closed, priority, spam | B | 1 |
| MS-03 | Assignment & mentions | Assign to a teammate, @mention, internal notes | B | 1 |
| MS-04 | Saved replies / snippets | Team-level and personal, with variables | B | 1 |
| MS-05 | MMS & attachments | Images, PDFs, voice notes; size/type validation | I | 2 |
| MS-06 | Broadcasts | Segment-based mass SMS/email with schedule and throttling | B | 3 |
| MS-07 | Keyword automations | "STOP", "HOURS", "BOOK", custom keywords → action | B | 3 |
| MS-08 | Business hours & away messages | Per-location schedule, holiday overrides, auto-reply | B | 2 |
| MS-09 | Consent management | Consent source, timestamp, IP, channel; hard block without consent | B | 1 |
| MS-10 | Phone number management | Provision local numbers, A2P 10DLC registration, port requests | I | 2 |
| MS-11 | Calls | Click-to-call, call log, recording (with consent), voicemail + transcription | I | 4 |
| MS-12 | Webchat widget | Embeddable, themeable, mobile-friendly, SSE/WebSocket delivery | B | 1 |
| MS-13 | Two-way email | Threaded email channel with reply parsing | I | 2 |
| MS-14 | Social DMs | Facebook Messenger + Instagram DM ingestion and reply | I | 4 |
| MS-15 | Scheduled messages | Send later, per-contact timezone | B | 3 |
| MS-16 | Contact merge from inbox | Create/merge a contact inline from an unknown number | B | 1 |
| MS-17 | Team metrics | First response time, resolution time, volume per agent | B | 4 |
| MS-18 | Mobile inbox | Responsive PWA; native wrappers later | B | 5 |
| MS-19 | Spam & abuse handling | Rate limits, blocklist, duplicate detection | B | 2 |

---

## 4. AI Employee (AI)

| ID | Feature | Description | How | Phase |
|----|---------|-------------|-----|-------|
| AI-01 | 24/7 auto-response | Answer inbound SMS/webchat/email when no human is active | B/I | 4 |
| AI-02 | Intent & lead qualification | Extract service need, urgency, location, contactability; score the lead | B | 4 |
| AI-03 | Calendar booking | Offer slots, book/reschedule/cancel against a real calendar | B | 4 |
| AI-04 | Confirmations & reminders | Appointment confirmation and reminder sequences | B | 4 |
| AI-05 | Database reactivation | Re-engage dormant contacts with consented, throttled campaigns | B | 5 |
| AI-06 | Knowledge base / RAG | Ingest hours, services, pricing ranges, policies, FAQs; cite sources | B | 4 |
| AI-07 | Custom playbooks | Per-location goals, tone, allowed actions, escalation rules, banned topics | B | 4 |
| AI-08 | Human handoff | Escalate with a full summary and suggested reply | B | 4 |
| AI-09 | Summaries & next best action | Thread summary, sentiment, suggested next step | B | 4 |
| AI-10 | AI Studio | Performance dashboard, sandbox tester, transcript review, escalation rules editor | B | 5 |
| AI-11 | Brand voice & languages | Tone presets, per-location voice, multilingual replies | B | 5 |
| AI-12 | Guardrails | No medical/legal/financial advice, PII redaction, prompt-injection defense, tool allowlist | B | 4 |
| AI-13 | Review reply generation | Draft replies per review with platform-length and policy limits | B | 3 |
| AI-14 | Voice agent (calls) | Answer calls, qualify, book, transfer; requires telephony + STT/TTS | D | 6 |
| AI-15 | AI invite copy | Personalized review asks | B | 4 |
| AI-16 | Eval harness | Golden-set regression tests for tone, correctness, escalation, injection resistance | B | 4 |
| AI-17 | Cost & usage controls | Per-org token budgets, model routing, caching | B | 5 |

---

## 5. Contacts / CRM (CT)

| ID | Feature | Description | Phase |
|----|---------|-------------|-------|
| CT-01 | Unified profile | Name, phones, emails, addresses, tags, custom fields, owner | 1 |
| CT-02 | Timeline | Messages, reviews, appointments, notes, consent events in one feed | 2 |
| CT-03 | CSV import/export | Mapping UI, dedupe preview, error report | 1 |
| CT-04 | Tags & segments | Static and dynamic (e.g. "no review in 90 days") | 2 |
| CT-05 | Custom fields | Text, number, date, select, multi-select per org | 2 |
| CT-06 | Duplicate detection & merge | Phone/email normalization, merge with history preservation | 3 |
| CT-07 | Consent state | Channel-level status surfaced on the profile and enforced everywhere | 1 |
| CT-08 | Location assignment | Contacts belong to one or more locations | 2 |
| CT-09 | Data export & deletion | GDPR/CCPA delete with audit trail | 4 |

---

## 6. Platform / admin (PL)

| ID | Feature | Description | Phase |
|----|---------|-------------|-------|
| PL-01 | Multi-location orgs | Org → locations → users; per-location settings | 1 |
| PL-02 | Roles & permissions | Owner, admin, manager, agent, viewer; per-module scopes | 1 |
| PL-03 | Audit log | Who changed what, when, before/after for sensitive objects | 2 |
| PL-04 | Notifications | In-app, email, web push; per-user preferences | 2 |
| PL-05 | API keys & webhooks | Org-scoped keys, signed outbound webhooks, retries | 4 |
| PL-06 | Integrations | Google/Outlook calendar, HubSpot, Salesforce, Mailchimp, QuickBooks, Shopify, Mindbody, Nextech | 5 |
| PL-07 | Branding | Logo, colors, custom domain for landing pages/widget | 4 |
| PL-08 | Plan gating | Tiers, seat limits, feature flags, trial state (**no payment processing**) | 5 |
| PL-09 | Onboarding | Checklist + sample data + guided first review request | 3 |
| PL-10 | Status & support | Health page, in-app help, impersonation with audit | 5 |

---

## 7. Reporting (RP)

| ID | Feature | Description | Phase |
|----|---------|-------------|-------|
| RP-01 | Home dashboard | Reviews this month, avg rating, response rate, open conversations, bookings | 3 |
| RP-02 | Review report | Filters: location, platform, employee, date; CSV export | 3 |
| RP-03 | Messaging report | Volume, response/resolution time, channel mix, opt-outs | 4 |
| RP-04 | AI report | Deflection, bookings, handoffs, CSAT proxy, token cost | 5 |
| RP-05 | Scheduled reports | Weekly/monthly email to selected recipients | 5 |
| RP-06 | Location comparison | Rank locations by rating, volume, response rate | 4 |
| RP-07 | Free reputation audit | Public lead magnet: enter a business, get a public-rating snapshot | D |

---

## 8. Listings & web (WB / LS)

| ID | Feature | Description | How | Phase |
|----|---------|-------------|-----|-------|
| WB-01 | Review widget | Embeddable JS + iframe fallback, schema.org `Review`/`AggregateRating` | B | 3 |
| WB-02 | Review landing pages | Per-location, SEO, fast, brandable | B | 2 |
| WB-03 | Simple site builder | Templates, sections, lead form → inbox | D | 6 |
| LS-01 | Google Business Profile management | Hours, photos, posts, Q&A, review replies via official API | I | 5 |
| LS-02 | Directory sync | Push NAP data to major directories | D | 6 |

---

## 9. Explicitly excluded

| Feature | Reason |
|---|---|
| Card payments / POS / terminals | Out of scope by request |
| Financing / lending / wallet | Out of scope by request |
| Loans, buy-now-pay-later | Out of scope by request |
| Payment links and invoices with money movement | Out of scope by request |

Plan tiers and seat limits still exist (PL-08) — that is billing **state**, not payment processing.

---

## 10. Compliance & policy constraints (design inputs, not afterthoughts)

1. **Google review policy** — no gating, no incentives, no bulk fake reviews, no review swapping. The product must not offer "only ask happy customers."
2. **TCPA / consent** — explicit opt-in per phone number, recorded with source + timestamp + IP; STOP/HELP honored instantly and permanently until re-consent.
3. **A2P 10DLC** — US SMS requires brand/campaign registration. Provision through a provider that handles it; surface status in the UI.
4. **CAN-SPAM / GDPR / CCPA** — unsubscribe, data export, deletion, retention windows.
5. **Platform API terms** — Google Business Profile API access requires an approved project; Meta requires app review. Fall back to manual/import where not granted.
6. **AI disclosure** — configurable disclosure that the customer is talking to an AI; never impersonate a named human.
7. **No scraping** of authenticated competitor surfaces; all integrations use documented APIs or user-provided exports.

---

## 11. Parity summary

| Pillar | Podium-class coverage in this map |
|---|---|
| Reviews | 24 features — invite → route → collect → manage → reply → report |
| Messaging | 19 features — multi-channel shared inbox with consent and automations |
| AI | 17 features — answering, qualification, booking, RAG, playbooks, studio, evals |
| Contacts | 9 features — unified profile, segments, consent, merge, export |
| Platform | 10 features — multi-location, RBAC, audit, webhooks, integrations |
| Reporting | 7 features — operational and reputation analytics |
| Listings/web | 5 features — widget, landing pages, GBP, deferred site builder |

**Deliberate non-parity:** payments, financing, wallet, lending (excluded), and voice AI / site builder / directory sync (deferred to phase 6).