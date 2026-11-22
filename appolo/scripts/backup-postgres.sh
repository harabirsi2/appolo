#!/usr/bin/env bash
#
# Nightly logical backup of the whole product.
#
# Usage:  MIGRATE_DATABASE_URL=postgres://… BACKUP_DIR=/var/backups/appolo ./scripts/backup-postgres.sh
#
# The database *is* the product: orgs, rankings, every matchup, every review.
# There is no other copy of it anywhere, so this script refuses to report
# success unless the dump is readable — a backup that has never been listed is a
# guess, and a truncated dump passes `pg_dump`'s exit code.
#
# Retention: 14 daily + 8 weekly (Sunday), because "restore last night" and
# "restore before that bad import three weeks ago" are different questions.
#
# Deliberately not a WAL archive: that needs a base backup, a shell and a
# wal-g/pgBackRest dependency, and buys point-in-time recovery for a product
# whose worst realistic loss is a day of personal rankings. Revisit when someone
# pays for it. See docs/RUNBOOK.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/appolo}"
RETENTION_DAILY="${RETENTION_DAILY:-14}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-8}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY_OF_WEEK="$(date -u +%u)"
URL="${MIGRATE_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$URL" ]; then
  echo "backup: MIGRATE_DATABASE_URL (or DATABASE_URL) must be set" >&2
  exit 2
fi

# Use the owner/migrator role, not appolo_app: RLS applies to the app role, so a
# dump taken as appolo_app silently exports only the rows of whichever tenant the
# session happened to be scoped to.
case "$URL" in
  *appolo_app*) echo "backup: refusing to dump as appolo_app (row-level security would hide other tenants)" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR"
NAME="appolo-${STAMP}.dump"
TARGET="${BACKUP_DIR}/${NAME}"
TMP="${TARGET}.partial"

echo "backup: dumping to ${TMP}"
pg_dump --format=custom --no-owner --no-privileges --file="$TMP" "$URL"

# Verify before trusting: a custom-format archive must list, and the list must
# contain the tables the product cannot survive without.
pg_restore --list "$TMP" > "${TMP}.toc"
for table in orgs item_matchups item_ratings catalog_items org_members; do
  if ! grep -q "TABLE DATA public ${table} " "${TMP}.toc"; then
    echo "backup: dump is missing table data for ${table} — treating as failed" >&2
    exit 1
  fi
done

mv "$TMP" "$TARGET"
rm -f "${TMP}.toc"
SIZE="$(du -h "$TARGET" | cut -f1)"
echo "backup: ok ${NAME} (${SIZE})"

if [ "$DAY_OF_WEEK" = "7" ]; then
  cp "$TARGET" "${BACKUP_DIR}/weekly-${NAME}"
  echo "backup: copied to weekly-${NAME}"
fi

# Rotation. -mtime +N keeps the newest N days; weekly copies are rotated
# separately so a week's worth of dailies cannot evict them.
find "$BACKUP_DIR" -maxdepth 1 -name 'appolo-*.dump' -mtime "+${RETENTION_DAILY}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'weekly-*.dump' -mtime "+$((RETENTION_WEEKLY * 7))" -print -delete

echo "backup: retained $(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' | wc -l | tr -d ' ') archives in ${BACKUP_DIR}"
