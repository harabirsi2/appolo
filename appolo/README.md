# Appolo

A clean-room, Podium-class reputation and messaging platform.
Reviews, shared inbox, AI employee, contacts, reporting — **no payments.**

## Documents

| File | Contents |
|---|---|
| [`FEATURE_MAP.md`](./FEATURE_MAP.md) | Every feature with ID, description, build-vs-integrate call, and phase |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Stack, data model, API surface, pipelines, AI subsystem, security, risks |
| [`ROADMAP.md`](./ROADMAP.md) | Phased plan, exit criteria, MVP cut line, open decisions |

## At a glance

- **Pillars:** Reviews · Messaging · AI Employee · Contacts/CRM · Reporting · Listings
- **MVP:** Phases 0–3 (foundations → reviews + messaging + automations)
- **Differentiator:** Phase 4 (AI answering, qualification, booking, handoff)
- **Excluded:** payments, financing, wallet, lending, card processing
- **Recommended stack:** Next.js 15 · Postgres 16 · Drizzle · Redis/BullMQ ·
  Twilio · Resend · pgvector

## Clean-room statement

This project is an independent implementation built from publicly available
product information and general industry practice. It does not contain, copy, or
derive from Podium's proprietary source code, private APIs, or authenticated
product surfaces. All integration work uses documented third-party APIs or
user-provided exports.

Product copy, terminology, and branding are original to Appolo.

## Compliance posture

- No review gating or review incentives.
- Explicit, recorded consent per channel; STOP/HELP honored immediately.
- A2P 10DLC registration handled through the SMS provider.
- AI discloses itself; no impersonation of named humans.
- Data export and deletion supported per org.

## Status

Design phase complete. Implementation begins after stack sign-off
(see open decisions in `ROADMAP.md`).