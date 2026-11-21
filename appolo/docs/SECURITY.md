# Security

Controls implemented in this repository, and the risks that remain.

## Authentication and sessions

- Spotify import uses an http-only, same-site state cookie bound to the acting
  org; the callback rejects a missing, mismatched or foreign state before
  exchanging the authorization code.

- Passwords are hashed with scrypt at N=2^17, r=8, p=1 (OWASP's current
  minimum) with a 16-byte random salt; no plaintext is stored or logged. The
  cost parameters are stored in the hash (`scrypt$N$r$p$salt$hash`), so a hash
  written under the previous N=2^14 keeps verifying and only new hashes get the
  higher cost. The derivation runs asynchronously (`scrypt`, not `scryptSync`),
  so one login no longer blocks the event loop for every other request.
- A stored hash cannot demand unbounded memory: verification rejects
  parameters outside a sane range before deriving.
- Sessions are database rows referenced by an HttpOnly cookie (`appolo_session`),
  with expiry. `getSession` requires an **active** membership, so disabled or
  invited members cannot use an existing session.
- Workspace selection is ordered by membership age rather than an arbitrary
  `LIMIT 1`.
- Sign-in: 20 attempts per email per 15 minutes, keyed by a hash of the email;
  a successful sign-in clears the counter. Sign-up: 20 per client IP per hour.
  Both return `429` with `Retry-After`.
- Sign-up does not confirm whether an address is registered: a taken email and
  any other rejection return the same message, and the taken-email path still
  derives a password hash so the response time does not answer the question
  either. The per-IP window bounds guessing. (A confirmation-email flow would
  remove the channel entirely; that is not implemented.)

## Authorization and tenant isolation

- Every tenant table carries `org_id`; Postgres RLS policies key off
  `app.org_id`, which `withOrg` sets per transaction.
- Service functions that cross tenants are limited to public aggregates
  (community leaderboards, public profiles, reviews) and never return private
  rows.
- Account export and deletion require the session's own org and, for deletion,
  the account password.

## Request integrity and browser hardening

- State-changing HTTP methods (`POST`, `PATCH`, `PUT`, `DELETE`) pass through a
  same-origin guard in `apps/web/middleware.ts`. A supplied `Origin` or
  `Referer` must match the request host; `Sec-Fetch-Site: cross-site` is
  rejected even when neither header is present. Non-browser clients and
  provider webhooks without browser provenance headers remain allowed. The
  comparison trusts the request `Host`; a reverse proxy must preserve the
  original host for the check to remain meaningful.
- The app sends a nonce-based Content-Security-Policy together with
  `X-Content-Type-Options: nosniff`, a strict referrer policy and a restrictive
  permissions policy. HSTS is sent in production. Framing is denied with
  `X-Frame-Options: DENY` and `frame-ancestors 'none'` except for the public
  chat and review widgets under `/embed/*`, which are intentionally embeddable
  on customer sites.
- Dependencies are audited in CI with `pnpm audit --prod --audit-level=low`.
  There is no allowlist; a reported vulnerability fails the build.

## Input and output

- Mutations validate with Zod schemas.
- Queries are parameterised through Drizzle; `ILIKE` search escapes `%`, `_` and
  backslash so wildcards cannot turn a search into a full scan or a match-all.
  Every pattern goes through `apps/web/lib/services/like-pattern.ts`
  (`likeContains` / `likePrefix`) rather than an inline `%${query}%`, which is
  also why contact, catalog, profile and review search behave the same way.
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

- Reviews, profiles and comments can be reported for spam, harassment, hate,
  sexual content, violence, misinformation or another reason. A workspace can
  hold only one report per item, so repeated reports are idempotent, and
  self-reports are rejected.
- The moderation queue is limited to users with `users.is_moderator`; the flag
  is read through `session.user.isModerator` and every queue/action endpoint
  re-checks it. Moderators can dismiss a report or hide/remove the content, and
  replaying an action is a no-op.
- Hidden and removed rows are excluded from public reviews, feeds, item pages,
  comments, profiles, search, taste twins, pod consensus and community
  leaderboards. Owners keep access to their own library for recovery.
- Interactive endpoints (matchup fetches, votes, reactions, comments) use
  Postgres fixed-window counters and return `429` with `Retry-After`. Reports
  share the same limiter at 20 per minute per org.
- Live catalog-provider search is capped at 30 requests per minute per org;
  local search is not metered. Goodreads and Letterboxd imports are capped at
  5 per minute per org so they cannot flood the shared catalog.
- Bulk contact export (PII egress) is limited to 5 per minute per org and writes
  an `audit_logs` entry recording the actor.
- Community scores shrink thin samples toward a prior and down-weight votes
  flagged by coordinated-voting detection (five or more shared titles with
  sustained near-identical scores).

## Public web chat widget

- A visitor does not choose its own identity. The first `POST` mints a random
  visitor id and returns an HMAC-SHA256 token (`WEBCHAT_TOKEN_SECRET`, 7-day
  expiry) in the form `v1.<uuid>.<expiry>.<signature>`. `GET` requires that
  token and verifies the signature before reading anything, so a guessed or
  reused `visitorId` no longer exposes another visitor's transcript. The token
  is compared with `timingSafeEqual` and the id it carries must be a UUID.
- In production the widget routes fail closed (`503`) when
  `WEBCHAT_TOKEN_SECRET` is missing or shorter than 32 characters; only
  development falls back to a fixed secret, with a warning.
- `POST` is rate limited per (widget key, client IP) through the shared Postgres
  fixed-window counter: 12 messages per minute, `429` with `Retry-After`. The
  endpoint can create a contact, fire keyword automations (a real SMS) and spend
  an AI reply, so it is metered before any of that runs.

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
3. **Sign-up oracle via timing.** The message is identical and a hash is
   derived on both paths, but the taken-email path still returns before the
   workspace transaction, so a determined observer could measure a difference.
   An email-confirmation flow is the real fix and is not implemented.
4. **Web chat token lifetime.** A token is valid for seven days and is stored in
   `localStorage`, readable by any script on the host page. The embed widget
   loads no third-party scripts, but a compromised customer site could read it.
3. **Session pruning.** Expired sessions are not garbage-collected; there is no
   scheduler yet.
4. **Blocking and private accounts.** Reporting and moderation are implemented,
   but user-level blocking is not enforced across every query, and profiles are
   public unless a moderator hides them.
5. **File uploads.** Attachments are URLs with validation, not uploaded blobs;
   there is no virus scanning because no bytes are stored.
