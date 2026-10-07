#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MBUMAH HARDWARE POS - Uninstaller (Linux / macOS, no Docker)
#
# Run from the app folder:   bash deploy/nodocker/uninstall-nodocker.sh
# or:                        bash Uninstall-Mbumah-POS.sh   (if provided)
#
# 1. Offers one final backup of the SQLite database (same folder as backup-pos).
# 2. Stops Mbumah POS background jobs (node start-server.mjs / cron-local.mjs
#    started from THIS folder only).
# 3. Removes .desktop launcher entries created by the installer (if any).
# 4. Asks (DELETE in capitals) before removing the app folder.
# Backups are NEVER deleted.
# ─────────────────────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$ROOT/deploy/nodocker/start-server.mjs" ]; then
  echo "[ERROR] Run this script from the app folder: bash deploy/nodocker/uninstall-nodocker.sh"
  exit 1
fi

echo ""
echo "============================================================"
echo "  MBUMAH HARDWARE POS - UNINSTALL"
echo "============================================================"
echo "App folder : $ROOT"
echo ""

# ── 1. final backup offer ───────────────────────────────────────────────────
printf "Back up the database one last time? (y/N): "
read -r answer
if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
  dbfile=""
  if [ -f "$ROOT/.env" ]; then
    # shellcheck disable=SC1091
    dbfile="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | sed 's/^DATABASE_URL=//; s/"//g' | sed 's|^file:||')"
    case "$dbfile" in
      /*) ;;
      *) dbfile="$ROOT/$dbfile" ;;
    esac
  fi
  if [ -n "$dbfile" ] && [ -f "$dbfile" ]; then
    mkdir -p "$HOME/Desktop/MbumahBackups" 2>/dev/null || mkdir -p "$HOME/MbumahBackups"
    stamp="$(date +%Y%m%d_%H%M%S)"
    dest="$HOME/MbumahBackups/mbumah-pos-$stamp.db"
    cp "$dbfile" "$dest" && echo "[OK] Backup saved: $dest"
  else
    echo "[WARN] Could not locate the SQLite database from .env - skipping backup."
  fi
fi

# ── 2. stop background jobs (this folder only) ──────────────────────────────
echo "[1/3] Stopping Mbumah POS background jobs..."
pkill -f "node .*$(printf '%s' "$ROOT" | sed 's/[][\.*^$/]/\\&/g')/deploy/nodocker/start-server.mjs" 2>/dev/null &&
  echo "      stopped start-server.mjs" || echo "      no start-server process found"
pkill -f "node .*$(printf '%s' "$ROOT" | sed 's/[][\.*^$/]/\\&/g')/deploy/nodocker/cron-local.mjs" 2>/dev/null &&
  echo "      stopped cron-local.mjs" || echo "      no cron process found"

# ── 3. launcher entries (best-effort) ───────────────────────────────────────
echo "[2/3] Removing launcher entries..."
for f in "$HOME/.local/share/applications/mbumah-pos.desktop" \
         "$HOME/Desktop/mbumah-pos.desktop" \
         "$HOME/Desktop/MbumahPOS.desktop"; do
  if [ -f "$f" ]; then rm -f "$f" && echo "      removed $f"; fi
done

# ── 4. app folder ───────────────────────────────────────────────────────────
echo "[3/3] App folder removal."
printf "Delete the app folder and its database? Type DELETE to confirm: "
read -r confirm
if [ "$confirm" = "DELETE" ]; then
  rm -rf "$ROOT" && echo "[OK] $ROOT removed."
  echo "Your backups are safe in ~/MbumahBackups (and Desktop\\MbumahBackups)."
else
  echo "App folder KEPT - nothing was deleted. Shortcuts/jobs were removed."
fi
