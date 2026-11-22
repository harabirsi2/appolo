# Operations

What runs, how you know it is running, and what a deploy actually breaks. Every
item ends with a decision: do it now (hours), or skip it and say why.

---

## 1. Observability

### 1.1 Structured logs and correlation ids

Every request gets one id, and that id is on every line about the request.

- `middleware.ts` accepts an inbound `x-request-id` (8–64 chars of
  `[A-Za-z0-9_-]`, anything else is replaced) or mints a UUID. It is set on the
  request (so route handlers see it), on the response (so a user can quote it),
  and on the API access line.
- `lib/observability.ts` is the only logger. One JSON object per line on stdout,
  keys `ts / level / event`, plus event-specific fields. Secret-looking keys are
  renamed to `*_redacted` before they can be written.
- `withRequestLog(name, handler)` wraps a route and logs exactly one completion
  line with `status` and `durationMs`. Wired into every user-facing API route:
  `vote`, `undo`, `review`, `health`, `search`, `catalog`, `reports`,
  `report-abuse`, `review-requests-list`, `review-requests-send` and
  `review-requests-bulk`. `browse` has no API route — it is rendered on the
  server — so its requests are covered by the middleware start line only. The
  pattern is one line at the bottom of a route file:

  ```ts
  async function handle(request: NextRequest, { params }: Params) { /* … */ }
  export const POST = withRequestLog("vote", handle);
  ```

Why middleware cannot do the timing: it hands the request off and returns
without waiting for the render, so it knows when a request *started*. Duration
and status have to come from the handler.

What this buys: `grep '"level":"error"' | jq` for failures, `jq 'select(.durationMs
> 800)'` for slow routes, and one id to paste into `grep` when a user says "my
vote disappeared".

Not done, on purpose: no log shipping agent, no OpenTelemetry, no request body
logging (PII risk, and the DB has the data anyway). Hosts collect stdout.

**Action: done.** Cost: negligible; no dependency added.

### 1.2 `/api/health`

```
GET /api/health          → 200 while the web app can serve
GET /api/health?strict=1 → 503 unless the worker beat within 95s
```

```json
{
  "ok": true,
  "service": "appolo-web",
  "database": "up",
  "worker": { "status": "live", "lastSeenAt": "…", "ageSeconds": 12 },
  "latencyMs": 4,
  "time": "…",
  "release": "…"
}
```

- **Database**: `select 1` on the app role. Down → 503.
- **Worker**: the worker is not an HTTP service, so it cannot be polled. It
  upserts a row into `service_heartbeats` every 30 s
  (`apps/worker/src/heartbeat.ts`, migration `0028`), and health reports the age
  of that row. Write it before anything else in `main()`, so a worker that dies
  during startup still shows a stale beat instead of nothing.
- **Default is lenient**: a stale worker returns 200 with
  `x-worker-status: stale`, because ranking pages still work without it and
  taking a healthy site down for a wedged queue is worse than a degraded flag.
  Use `?strict=1` from an uptime monitor and accept the trade.

**Action: done.** Cost: 30 s heartbeat + one migration.

### 1.3 Error reporting: Sentry, not GlitchTip

Chosen: **Sentry SaaS free tier**, called directly over HTTP from
`captureException` (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`). No SDK.

| | Sentry free | GlitchTip self-hosted |
| --- | --- | --- |
| Cost | $0 (5k events/mo, 1 seat, at time of writing) | a VPS (~$5–10/mo) *plus* the Postgres you must run and back up for it |
| Time to first error | 5 minutes | half a day, then permanent patching |
| Failure modes added | none | your error monitor is another thing that can be down, on the same box as the product |
| Data residency | their servers | yours |
| Volume ceiling | 5k events/mo | your disk |

For one developer on one box, a self-hosted GlitchTip means running a second
Postgres and a second web app to find out why the first one broke — that is the
opposite of the reliability it promises. Sentry's free tier covers a solo
product's error volume; move to GlitchTip only if (a) you exceed 5k events/mo and
refuse to pay, or (b) a customer requires EU-only storage.

The DSN-based POST keeps the option open: no SDK, no bundler plugin, no edge
runtime surprise. When you want breadcrumbs, releases and tracing, install
`@sentry/nextjs` and delete `captureException`'s transport — the call sites do
not change.

`onRequestError` in `apps/web/instrumentation.ts` catches everything Next fails
on, including errors your own `try/catch` never sees. Without it the only signal
is a 500 in the access log.

**Action for you (30 min):** create the Sentry project, set `SENTRY_DSN` and
`SENTRY_RELEASE` (`git rev-parse --short HEAD`) in the deploy environment, then
throw a test error behind a flag and confirm it arrives. Until the DSN is set
the reporter is a no-op and logs to stdout only.

**Skipped:** worker-side Sentry. The worker already logs every job failure and
heartbeats; a second DSN for one process is not worth the env var until the
worker does something a user can see break. Revisit when queue jobs start failing.

---

## 2. Uptime-safe deploys

What a `next start` restart actually breaks, in order of likelihood:

| Thing | What happens on deploy | Recovery |
| --- | --- | --- |
| Coalesced ranking rebuild (750 ms timer) | The queued fit is lost. | Self-healing: `getRankingModel` refits when the stored comparison count disagrees with the durable matchup log. `flushRankingRefreshes()` now drains on SIGTERM so the first user after a deploy does not pay the rebuild. |
| In-flight votes / reviews | `next start` has no server-close hook; without a grace period the socket dies mid-response. | Fixed: `installLifecycle()` flushes, then waits `SHUTDOWN_GRACE_MS` (default 5000) before exiting. Client retries are already safe — every vote carries an `idempotency-key` and replays return `x-idempotent-replay`. |
| ISR / `revalidatePath` queue | Revalidations queued in memory are dropped; public profile and podium pages can serve a stale card. | Cosmetic and self-healing on the next write. If a deploy must be pixel-fresh, hit the profile page once after the restart (warm) — do not add a purge system for this. |
| Worker restart | Jobs in flight are redelivered by BullMQ (jobs are idempotent by `idempotency-key`); the heartbeat gap makes `?strict=1` report stale for up to 95 s. | Expected during a deploy. Do not alert on strict health inside the deploy window. |
| Migrations | Forward-only SQL runs before the new code. | Every migration so far is additive with defaults, so old code keeps working during a rolling restart. Keep it that way: add nullable column → deploy code → backfill → add NOT NULL in a later migration. |
| Multi-instance rollout | Two versions run at once. | Nothing in the app holds per-process state that another instance needs (the coalescer is a latency optimisation, not a source of truth). Anything that changes behaviour must therefore be behind an env flag, not a deploy step. |

Deploy checklist (5 minutes):

1. `pnpm verify` locally, or let CI do it.
2. `pnpm db:migrate` against production **before** starting the new build.
3. Restart web; wait for `GET /api/health` to be 200.
4. Restart worker; wait for `worker.status === "live"` (≤ 30 s).
5. `GET /api/health?strict=1` → 200.
6. Cast one vote on a real account.

**Skipped:** zero-downtime blue/green, connection draining at the proxy, and a
readiness gate. All three need infrastructure this project does not have yet;
the 5 s grace plus idempotent retries covers the same failure at solo scale.
Revisit at two instances.

---

## 3. Moderation automation v1

See [MODERATION.md](./MODERATION.md). Two signals on the report pipeline —
duplicate detection and link-spam scoring — run when the report is inserted and
persisted on the row (`triage_action`, `triage_score`, `triage_reason`, migration
`0029`), so the queue sorts flagged reports first without re-scanning history on
every open. `flag` is the default action; `hide` is recorded only with
`MODERATION_AUTO_HIDE=1` and still waits for a moderator.

---

## 4. Provider terms

See [PROVIDER-TERMS.md](./PROVIDER-TERMS.md). Provider credit is rendered on every
surface that shows provider data — item pages via `DataAttribution`, search
results and browse via `DataAttributionSummary` — and every provider request
identifies the client through `CATALOG_USER_AGENT`. The remaining clauses (cache
TTL, iTunes request spacing, RAWG commercial use) are a checklist with a decision
and an hour estimate each.

---

## 5. Backups

See [RUNBOOK.md](./RUNBOOK.md). `scripts/backup-postgres.sh` + the restore
drill. RPO 24 h, RTO ~30 min, both stated as accepted trade-offs rather than
guessed at.

---

## 6. What is deliberately not here

| Skipped | Why |
| --- | --- |
| Metrics (Prometheus/Grafana) | Nothing to chart that logs and `/api/health` do not already answer at this scale. The first metric worth adding is vote latency p95, which the request log already carries. |
| Distributed tracing | One process, one database. The request id is the whole trace. |
| Log aggregation service | `jq` over stdout on one box. |
| Alerting (PagerDuty/Opsgenie) | A solo operator with no on-call rotation gets paged by an SMS from an uptime monitor, not a schedule. Point a free uptime check at `/api/health?strict=1` and let it text you. |
| Synthetic browser checks | CI runs the real browser suite; a synthetic check would duplicate it at 100× the maintenance. |
