#!/usr/bin/env bash
# MBUMAH HARDWARE POS - timestamped database backup (v2.14.0)
#
# Purpose:
#   Creates a compressed, timestamped backup of the SQLite database before
#   risky operations (schema pushes, imports, bulk edits) and on a schedule
#   (cron / systemd timer) for on-premise deployments.
#
# Usage:
#   ./scripts/backup.sh                       # backup DB from .env DATABASE_URL
#   ./scripts/backup.sh /path/to/custom.db    # backup an explicit db file
#   ./scripts/backup.sh --keep 14             # keep the newest 14 archives
#
# Owner module: scripts/ (operations). Exit codes: 0 ok, 1 failure.
#
# Notes:
#   - PostgreSQL deployments should use pg_dump instead; this script targets
#     the single-file SQLite setups used by self-hosted / laptop installs.
#   - Never commit the backups/ directory (gitignored at repository root).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/backups"
KEEP=0
DB_FILE=""

# --- argument parsing -------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)
      KEEP="${2:-0}"
      shift 2
      ;;
    *)
      DB_FILE="$1"
      shift
      ;;
  esac
done

# --- resolve the database file ---------------------------------------------
if [ -z "$DB_FILE" ]; then
  DB_FILE="$(sed -n 's/^DATABASE_URL="file:\(.*\)"$/\1/p' "${REPO_ROOT}/.env" 2>/dev/null | head -n 1 || true)"
  if [ -z "$DB_FILE" ]; then
    echo "backup: no DATABASE_URL in .env and no db path argument given" >&2
    exit 1
  fi
fi

if [ ! -f "$DB_FILE" ]; then
  echo "backup: database file not found: ${DB_FILE}" >&2
  exit 1
fi

# --- create the archive -----------------------------------------------------
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BASENAME="$(basename "$DB_FILE")"
ARCHIVE="${BACKUP_DIR}/${BASENAME%.db}-${STAMP}.db.gz"

# Use the sqlite3 backup path when available (safe against mid-write copies);
# fall back to a plain gzip of the file when sqlite3 is not installed.
if command -v sqlite3 >/dev/null 2>&1; then
  TMP_COPY="$(mktemp "${TMPDIR:-/tmp}/mbumah-backup-XXXXXX.db")"
  sqlite3 "$DB_FILE" ".backup '${TMP_COPY}'"
  gzip -c "$TMP_COPY" > "$ARCHIVE"
  rm -f "$TMP_COPY"
else
  gzip -c "$DB_FILE" > "$ARCHIVE"
fi

echo "backup: wrote ${ARCHIVE} ($(du -h "$ARCHIVE" | cut -f1))"

# --- retention --------------------------------------------------------------
if [ "$KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012
  ls -1t "${BACKUP_DIR}/${BASENAME%.db}"-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    rm -f "$old"
    echo "backup: pruned ${old}"
  done
fi
