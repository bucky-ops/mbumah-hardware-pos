#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - One-click database backup (Linux/macOS, no Docker)
# ============================================================================
# Copies the single SQLite database file (plus its -wal/-shm sidecars when
# present, plus the .env configuration) into ~/MbumahBackups (or
# ~/Desktop/MbumahBackups) with a timestamp.
#
# Non-interactive by design so it can run from cron ("Mbumah POS Nightly
# Backup", 02:30 - see install-nodocker.sh) or be typed by hand.
# ============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DB_FILE="$HOME/mbumah-pos-data/pos.db"
if [ -f "$ROOT/.env" ]; then
  FROM_ENV="$(grep -m1 -E '^DATABASE_URL=' "$ROOT/.env" | sed 's/^DATABASE_URL=//; s/"//g' | sed 's|^file:||')"
  if [ -n "$FROM_ENV" ]; then
    case "$FROM_ENV" in
      /*) DB_FILE="$FROM_ENV" ;;
      *)  DB_FILE="$ROOT/$FROM_ENV" ;;
    esac
  fi
fi

echo ""
echo "=============================================================="
echo "  MBUMAH HARDWARE POS - BACKUP"
echo "=============================================================="
echo ""

if [ ! -f "$DB_FILE" ]; then
  echo "[FAIL] Database not found at: $DB_FILE"
  echo "       Install the POS first, or ask your developer."
  exit 1
fi

if [ -d "$HOME/Desktop" ]; then
  DEST_DIR="$HOME/Desktop/MbumahBackups"
else
  DEST_DIR="$HOME/MbumahBackups"
fi
mkdir -p "$DEST_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

if ! cp -f "$DB_FILE" "$DEST_DIR/pos-$STAMP.db"; then
  echo "[FAIL] Copying the database failed (is the POS holding it open?)."
  exit 1
fi
echo "[OK] Database backed up:  $DEST_DIR/pos-$STAMP.db"

# SQLite sidecars (write-ahead log / shared memory) - copy them too when the
# POS is running, otherwise the .db copy alone may be missing recent writes.
if [ -f "$DB_FILE-wal" ]; then
  cp -f "$DB_FILE-wal" "$DEST_DIR/pos.db-wal-$STAMP" &&
    echo "[OK] Sidecar backed up:   $DEST_DIR/pos.db-wal-$STAMP"
fi
if [ -f "$DB_FILE-shm" ]; then
  cp -f "$DB_FILE-shm" "$DEST_DIR/pos.db-shm-$STAMP" &&
    echo "[OK] Sidecar backed up:   $DEST_DIR/pos.db-shm-$STAMP"
fi

if [ -f "$ROOT/.env" ]; then
  cp -f "$ROOT/.env" "$DEST_DIR/env-$STAMP.bak" &&
    echo "[OK] Configuration backed up:  $DEST_DIR/env-$STAMP.bak"
fi

echo ""
echo "Now copy the MbumahBackups folder to a USB stick or cloud drive."
echo "(A backup that only lives on the same laptop is not a backup!)"
