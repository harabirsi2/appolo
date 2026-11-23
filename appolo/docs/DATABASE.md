# Database and schema reference

Updated 2026-11-16. This is the dedicated reference for the PostgreSQL schema.
The repository's source of truth is `packages/db/src/schema.ts` plus the SQL
migrations, not a generated diagram or a stale ORM snapshot.

## Authority and layout

| Layer | Location | Role |
|---|---|---|
| Typed schema | `packages/db/src/schema.ts` | Canonical table/column/index definitions used by Drizzle |
| Framed migrations | `packages/db/drizzle/0000`–`0005` | Initial CRM/review tables and follow-up columns |
| Hand-written migrations | `packages/db/sql/0001`–`0022` | Media, social, ranking, RLS, search, imports and moderation changes |
| Applied ledger | `_appolo_migrations` | Records both directories after `pnpm db:migrate` |
| Seed | `packages/db/src/seed.ts` | Catalog, demo workspace and demo profile |

`migrate.ts` applies `drizzle/` first, then `sql/`, in filename order. The
Drizzle meta snapshot is known to be stale for the media layer; do not run
`drizzle-kit generate` against it without first regenerating a clean baseline.
New media/social changes should be idempotent SQL migrations like
`sql/0021_abuse_moderation.sql` (with `0022` for moderation-aware aggregates).

There are **74 tables** in the schema. The hand-written SQL directory currently
contains **23 migrations**: `0001`–`0022`, with two `0011` files
(`0011_auth_rate_limits.sql` and `0011_collab_pods.sql`).

## Table map

### Identity, tenancy and operations

`orgs`, `locations`, `users`, `memberships`, `sessions`, `auth_rate_limits`,
`api_keys`, `audit_logs`.

- A person is represented by an `orgs` row for ownership purposes; `users` is
  the login identity and `memberships` links users to orgs.
- `users.is_moderator` is the platform-level moderation flag read into
  `session.user.isModerator`.
- `memberships.status` must be `active` for a session to resolve.
- `auth_rate_limits` is identity-plane and outside tenant RLS because it is
  used before an org context exists.

### CRM, messaging and review operations

`contacts`, `contact_channels`, `tags`, `contact_tags`, `custom_fields`,
`contact_custom_values`, `consent_records`, `contact_events`, `channels`,
`phone_numbers`, `conversations`, `messages`, `message_events`,
`internal_notes`, `saved_replies`, `review_platforms`, `review_templates`,
`review_requests`, `review_tokens`, `reviews`, `review_replies`,
`private_feedback`, `review_widgets`.

- `reviews` here is the CRM/external-review table, not the social review model.
  Social reviews are `item_ratings` rows with review fields.
- Messaging replay safety is enforced by unique keys on
  `messages(org_id, provider_sid)` and `message_events(message_id, event)`.

### Automation, AI and calendar

`automations`, `automation_steps`, `automation_runs`, `campaigns`,
`campaign_recipients`, `ai_agents`, `ai_playbooks`, `ai_knowledge_docs`,
`ai_knowledge_chunks`, `ai_conversations`, `ai_turns`, `ai_evals`,
`ai_eval_runs`, `calendars`, `appointments`, `availability_rules`.

- AI knowledge chunks use JSON embeddings in the bundled Postgres; pgvector is
  optional and not required by the current schema.

### Platform plumbing

`webhook_endpoints`, `webhook_deliveries`, `imports`, `exports`,
`notifications`, `feature_flags`, `job_locks`.

- `job_locks` is a cross-tenant distributed lock table and has no `org_id`.

### Media catalog and rankings

`catalog_items`, `catalog_credits`, `item_ratings`, `item_matchups`,
`ranking_models`, `ranking_order`.

- `catalog_items` is shared across tenants. `item_ratings` is the per-profile
  ranking/review row and is unique on `(org_id, item_id)`.
- `item_matchups` is append-only and stores the outcome plus Elo before/after
  for both sides. It is the source of truth for rebuilding models.
- `ranking_models` is unique on `(org_id, kind)` and stores the fitted
  Bradley–Terry/Davidson snapshot.
- `ranking_order` has a composite primary key `(org_id, kind, item_id)` and
  stores the user's manual order without fabricating matchups.
- `catalog_credits` links cast/crew people to catalog titles.

### Social and public profiles

`profiles`, `profile_interests`, `follows`, `feed_dismissals`, `pods`,
`pod_members`, `pod_items`, `rating_reactions`, `rating_comments`, `watchlist`,
`rating_events`, `search_history`, `social_notifications`.

- `profiles` is unique on both `org_id` and `username`; it is the public face of
  an org.
- `follows` is unique on `(follower_org_id, followee_org_id)`.
- `pods(org_id, slug)` is unique; `pod_items(pod_id, item_id)` is unique.
- `rating_comments` is a single-level comment thread on `item_ratings`, not on
  the CRM `reviews` table.
- `social_notifications` stores follow/reaction/comment notifications.

### Moderation

`abuse_reports`.

Polymorphic report target:

| Column | Meaning |
|---|---|
| `reporter_org_id` | Org that filed the report |
| `content_org_id` | Org that owns the reported content |
| `content_type` | `review`, `profile`, or `comment` |
| `content_id` | UUID of the target row (`item_ratings.id`, `profiles.org_id`, or `rating_comments.id`) |
| `reason` | `spam`, `harassment`, `hate`, `sexual`, `violence`, `misinformation`, `other` |
| `status` | `open`, `dismissed`, or `actioned` |
| `action` | `hide`, `remove`, or `dismiss` once resolved |

`abuse_reports_reporter_content_uq` on `(reporter_org_id, content_type, content_id)`
makes a repeat report idempotent. Content moderation state lives on the target
itself as `moderation_status` (`visible`, `hidden`, `removed`) plus
`moderated_at` and `moderated_by` on `item_ratings`, `profiles`, and
`rating_comments`. Public queries filter `moderation_status = 'visible'`, and
`sql/0022_moderation_aggregates.sql` keeps the catalog's Bayesian score and
rating count limited to visible ratings whose profile is also visible,
recomputing when either the rating or the profile changes moderation state.

## RLS and access rules

- `withOrg(orgId, fn)` opens a transaction and sets `app.org_id`; tenant tables
  use `FORCE ROW LEVEL SECURITY` policies against that setting.
- Public social reads (`profiles`, public `pods`, `item_ratings`,
  `rating_comments`, catalog rows) run through the unscoped read path; they
  still filter moderation status and visibility.
- `abuse_reports` RLS is reporter-scoped in `sql/0021_abuse_moderation.sql`.
  The moderator queue and moderation actions use `getAdminDb()` because
  moderators must read and update reports across orgs.
- `users`, `memberships` and `sessions` are identity-plane lookups and are not
  protected by tenant RLS; code must always filter by user/org explicitly.

## Adding a table or column

1. Add the typed definition to `packages/db/src/schema.ts`.
2. Add an idempotent `sql/00NN_description.sql` migration with DDL, indexes, RLS
   policy and the `appolo_app` grant when the table is tenant-scoped.
3. Add the table to the relevant group above and document any new invariant.
4. Run `pnpm db:migrate`, then the RLS/import/moderation tests against a
   non-superuser app role.

## Useful commands

```bash
pnpm db:migrate            # apply drizzle/*.sql then sql/*.sql
pnpm db:seed               # seed catalog and demo workspace
pnpm db:rls-test           # cross-tenant isolation checks
pnpm db:idempotency-test   # webhook/message replay checks
```
