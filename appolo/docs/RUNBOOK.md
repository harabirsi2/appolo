# Runbook: backups, restore, and incidents

The Postgres database is the product. Every org, every matchup, every Elo, every
review — there is no second copy of it. This runbook is written so a bad night
has a script instead of a decision.

## Numbers first

| | Value | Why that number |
| --- | --- | --- |
| **RPO** (max data loss) | 24 h | Nightly logical dump. The realistic worst case is losing a day of personal votes; losing them is annoying, not existential. |
| **RTO** (time to serve again) | ~30 min | Provision Postgres, restore the dump, run migrations, restart two processes. |
| Backup window | 03:00 UTC daily | Quietest hour; the dump is a few hundred MB at current scale and finishes in under a minute. |
| Retention | 14 daily + 8 weekly | "Restore last night" and "restore before that bad import three weeks ago" are different questions. |
| Verification | every run | The script lists the archive and asserts the tables that matter are in it. |
| Restore drill | every 90 days | An untested restore is a hypothesis. The drill is the test. |

These are accepted trade-offs, not optimums. Point-in-time recovery (WAL
archiving) would give minutes of RPO at the cost of a base-backup procedure, an
archiver process and a tool to maintain — skip it while the product is one box,
revisit the first time someone's data loss costs money.

## Nightly backup

`scripts/backup-postgres.sh` (custom-format `pg_dump`, verified, rotating).

```bash
# on the database host, from the repo root
sudo install -m 0755 scripts/backup-postgres.sh /usr/local/bin/appolo-backup

# /etc/cron.d/appolo-backup
0 3 * * * postgres MIGRATE_DATABASE_URL=postgres://migrator:…@127.0.0.1:5432/appolo BACKUP_DIR=/var/backups/appolo /usr/local/bin/appolo-backup >> /var/log/appolo-backup.log 2>&1
```

Two things it does that a bare `pg_dump` line does not:

1. **Refuses the `appolo_app` role.** RLS is enforced for that role, so a dump
   taken as it exports only the rows of whatever tenant the session was scoped
   to. Silent, catastrophic, and invisible until restore.
2. **Lists the archive and checks for `orgs`, `item_matchups`, `item_ratings`,
   `catalog_items`, `org_members`.** A truncated dump still exits 0. A dump
   without `item_matchups` is not a backup.

Off-site copy: the box and the backups must not share a failure domain.

```bash
# /etc/cron.d/appolo-offsite, one hour after the local run
0 4 * * * root rclone copy /var/backups/appolo remote:appolo-backups --max-age 25h
```

Anything is better than nothing here: `rclone` to Backblaze B2 (~$6/TB/month) or
object storage you already pay for. Encrypt if the bucket is not private.

Not done: managed-Postgres automated backups. If you move to a managed provider,
turn on their PITR and keep this script as the portable copy — provider backups
do not protect you from the provider.

## Restore

Restore is a **fresh database**, never "clean up the broken one". Half-applied
restores are how a 30-minute outage becomes a weekend.

```bash
# 1. Stop writers, so nothing new lands in a database you are about to replace.
systemctl stop appolo-web appolo-worker

# 2. Provision an empty database and the app role (same names as production).
createdb -O migrator appolo_restore

# 3. Restore. --no-owner because roles are recreated by the migration role guard,
#    not carried in the dump.
pg_restore --dbname postgres://migrator:…@127.0.0.1/appolo_restore \
           --no-owner --no-privileges --exit-on-error \
           /var/backups/appolo/appolo-20261122T030000Z.dump

# 4. Bring the schema forward. The dump predates today's migrations.
MIGRATE_DATABASE_URL=postgres://migrator:…/appolo_restore pnpm db:migrate

# 5. Verify BEFORE cutting over (see below), then point DATABASE_URL at it.
```

### Verification (run against the restored database)

```sql
-- The numbers that must be non-zero and plausible. Compare with the last
-- /api/health-sized snapshot of production you have.
select
  (select count(*) from orgs)            as orgs,
  (select count(*) from profiles)        as profiles,
  (select count(*) from catalog_items)   as items,
  (select count(*) from item_matchups)   as matchups,
  (select count(*) from item_ratings)    as ratings,
  (select count(*) from rating_comments) as comments;

-- Every org's model must still agree with its matchup log; a restore that lost
-- rows shows up here as a count mismatch, which the app then repairs on read.
select count(*) as drifted_models
from ranking_models m
where m.comparisons <> (
  select count(*) from item_matchups x
  join catalog_items c on c.id = x.item_id
  where x.org_id = m.org_id and c.kind = m.kind
);
```

Then, as the app role, confirm RLS is intact — a restore that recreated tables
as superuser would leave every tenant visible to every other:

```bash
DATABASE_URL=postgres://appolo_app:…@127.0.0.1/appolo_restore pnpm db:rls-test
```

All checks green → start web, start worker, `GET /api/health?strict=1` → 200,
cast one vote, confirm it appears in the log:

```bash
grep '"name":"vote"' /var/log/appolo-web.log | tail -1
```

## Restore drill (every 90 days, 20 minutes)

The drill is the whole point. Restore last night's dump into `appolo_drill`,
run the four verification steps above, drop it. If any step fails, fix the
runbook that day — not on the night it matters.

## Incidents

**Votes failing / 500s on `/api/rankings/*`**

```bash
curl -s localhost:3000/api/health | jq
grep '"level":"error"' /var/log/appolo-web.log | tail -20
```

Take the `requestId` from the user's error and `grep` it end-to-end.

**Worker not progressing** — `curl -s 'localhost:3000/api/health?strict=1' | jq .worker`.
`stale` with a live process means the heartbeat itself is failing (check the log
for `heartbeat failed`); `stale` with no process means it crashed (restart it,
then read the log).

**Database gone** — follow Restore. Say the RPO out loud to the affected users:
"we may have lost up to a day of votes" is a much better failure than silence.

**Deploy broke something** — redeploy the previous commit and run the previous
migration set forward; migrations are additive, so going back one version of code
against the current schema is safe by design.
