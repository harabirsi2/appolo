# Security

Controls implemented in this repository, and the risks that remain.

## Authentication and sessions

- Passwords are hashed with scrypt; no plaintext is stored or logged.
- Sessions are database rows referenced by an HttpOnly cookie (`appolo_session`),
  with expiry. `getSession` requires an **active** membership, so disabled or
  invited members cannot use an existing session.
- Workspace selection is ordered by membership age rather than an arbitrary
  `LIMIT 1`.
- Sign-in: 20 attempts per email per 15 minutes, keyed by a hash of the email;
  a successful sign-in clears the counter. Sign-up: 20 per client IP per hour.
  Both return `429` with `Retry-After`.

## Authorization and tenant isolation

- Every tenant table carries `org_id`; Postgres RLS policies key off
  `app.org_id`, which `withOrg` sets per transaction.
- Service functions that cross tenants are limited to public aggregates
  (community leaderboards, public profiles, reviews) and never return private
  rows.
- Account export and deletion require the session's own org and, for deletion,
  the account password.

## Input and output

- Mutations validate with Zod schemas.
- Queries are parameterised through Drizzle; `ILIKE` search escapes `%`, `_` and
  backslash so wildcards cannot turn a search into a full scan or a match-all.
- Media URLs are restricted to https or app-relative paths; `javascript:`,
  `data:` and protocol-relative URLs are rejected.
- React escapes rendered text; raw HTML is not injected anywhere.
- Contact CSV export neutralizes spreadsheet formula injection: a cell starting
  with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an apostrophe
  (plain numbers and phone numbers are left intact).

## Webhook intake and messaging idempotency

- Twilio callbacks are verified with `X-Twilio-Signature`. With no auth token
  configured the check is open outside production (the local/mock path); in
  production an unsigned callback is refused unless
  `TWILIO_ALLOW_UNSIGNED_WEBHOOKS=true` is set explicitly.
- Inbound SMS is stored once per `(org_id, provider_sid)` (unique index), so a
  concurrent Twilio retry cannot create duplicate messages, contacts,
  automations or AI replies.
- Delivery status is monotonic: a replayed or out-of-order callback cannot
  regress `delivered` back to `sent`, and each `(message, event)` pair is
  stored once, so replays do not stack event rows.
- Provider-less sends use a local mock (marked "delivered") only in development
  and test, or with `ALLOW_MOCK_PROVIDERS=true`. In production an unconfigured
  provider throws instead of silently reporting success.

## Abuse controls

- Interactive endpoints (matchup fetches, votes, reactions, comments) use
  Postgres fixed-window counters and return `429` with `Retry-After`.
- Bulk contact export (PII egress) is limited to 5 per minute per org and writes
  an `audit_logs` entry recording the actor.
- Community scores shrink thin samples toward a prior and down-weight votes
  flagged by coordinated-voting detection (five or more shared titles with
  sustained near-identical scores).

## Secrets and operations

- Configuration comes from environment variables (`.env` is untracked); no keys
  or passwords are committed.
- The demo account is seeded intentionally and protected from deletion.
- Provider enrichment is capped (three concurrent lookups, 15/minute, 10-minute
  query cache) so a search cannot be used to amplify outbound traffic.

## Known risks

1. **Proxy trust.** The per-IP limit uses the first `x-forwarded-for` entry,
   which a direct client can spoof. It is reliable only behind a proxy that
   overwrites the header; a trusted-hop count is not implemented.
2. **Account lockout.** Twenty bad attempts lock an email for 15 minutes; an
   attacker can deliberately trigger this. A captcha or progressive delay would
   soften it.
3. **No CSRF token scheme.** Mutations rely on the session cookie and same-site
   cookie defaults. An explicit double-submit token or strict origin check is
   not implemented.
4. **Session pruning.** Expired sessions are not garbage-collected; there is no
   scheduler yet.
5. **Dependency audit.** `pnpm audit` is not part of the verification gate.
6. **Blocking and private accounts.** Reports exist, but blocking is not
   enforced across every query, and profiles are public.
7. **File uploads.** Attachments are URLs with validation, not uploaded blobs;
   there is no virus scanning because no bytes are stored.
