#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS — Rollback to a previous version (Linux/macOS, no-Docker)
# ============================================================================
# Thin interactive wrapper around update-pos.sh:
#   1. Reads the update ledger (~/mbumah-pos-data/update-ledger.jsonl) and
#      lists the last 20 successful updates/rollbacks.
#   2. You pick the version you want to go back TO.
#   3. It calls update-pos.sh -ToVersion <tag> -Force, which takes a fresh
#      backup, installs the older code, rebuilds and health-checks it - the
#      same safe path as a normal update.
# Your DATA is never changed: versions are forward-compatible, so the database
# always stays as it is (a pre-update backup is taken anyway).
#
# Usage:
#   bash deploy/nodocker/rollback-pos.sh
#   bash deploy/nodocker/rollback-pos.sh -ToVersion v2.8.0   (skip the menu)
# ============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LEDGER="$HOME/mbumah-pos-data/update-ledger.jsonl"
UPDATE_SCRIPT="$SCRIPT_DIR/update-pos.sh"

echo ""
echo "=============================================================="
echo "  MBUMAH HARDWARE POS - ROLLBACK TO A PREVIOUS VERSION"
echo "  Your sales data is NOT touched by a rollback."
echo "=============================================================="
echo ""

if [ ! -f "$UPDATE_SCRIPT" ]; then
  echo "[FAIL] update-pos.sh not found next to this script."
  exit 1
fi

TO_VERSION=""
if [ $# -ge 2 ] && { [ "$1" = "-ToVersion" ] || [ "$1" = "--to-version" ]; }; then
  TO_VERSION="$2"
fi

if [ -z "$TO_VERSION" ]; then
  ENTRIES_FILE="${TMPDIR:-/tmp}/mbumah-rollback-entries.$$"
  : > "$ENTRIES_FILE"
  if [ -f "$LEDGER" ]; then
    # tail -100 keeps the parse bounded; entries are one JSON object per line.
    tail -100 "$LEDGER" 2>/dev/null | while IFS= read -r line; do
      EV="$(printf '%s' "$line" | sed -n 's/.*"event"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      if [ "$EV" = "UPDATE_SUCCESS" ] || [ "$EV" = "ROLLBACK_SUCCESS" ]; then
        printf '%s\n' "$line" >> "$ENTRIES_FILE"
      fi
    done
  fi

  TOTAL=0
  [ -s "$ENTRIES_FILE" ] && TOTAL="$(wc -l < "$ENTRIES_FILE" | tr -d ' ')"
  if [ "$TOTAL" -gt 20 ]; then
    # keep only the newest 20 (the file is chronological)
    tail -20 "$ENTRIES_FILE" > "$ENTRIES_FILE.new" && mv "$ENTRIES_FILE.new" "$ENTRIES_FILE"
    TOTAL=20
  fi

  if [ "$TOTAL" -gt 0 ]; then
    echo "Versions this POS has been on (newest first):"
    echo ""
    N=0
    ROWS_FILE="${TMPDIR:-/tmp}/mbumah-rollback-rows.$$"
    # reverse (newest first) - portable awk, no tac needed on macOS
    awk '{a[NR]=$0} END{for(i=NR;i>=1;i--) print a[i]}' "$ENTRIES_FILE" > "$ROWS_FILE.rev"
    : > "$ROWS_FILE.out"
    while IFS= read -r line; do
      N=$((N + 1))
      FROM="$(printf '%s' "$line" | sed -n 's/.*"from"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      TOO="$(printf '%s' "$line" | sed -n 's/.*"to"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      TS="$(printf '%s' "$line" | sed -n 's/.*"ts"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-16 | sed 's/T/ /')"
      printf '%3s. %-10s -> %-10s  (%s)\n' "$N" "$FROM" "$TOO" "$TS" >> "$ROWS_FILE.out"
      printf '%s\n' "$FROM" >> "$ROWS_FILE.from"
    done < "$ROWS_FILE.rev"
    cat "$ROWS_FILE.out"
    echo ""
    echo "A rollback installs the version in the FROM column of the row you pick."
    printf 'Enter the number to roll back to (or press Enter to cancel): '
    read -r ANSWER || ANSWER=""
    case "$ANSWER" in
      ''|*[!0-9]*) TO_VERSION="" ;;
      *) TO_VERSION="$(sed -n "${ANSWER}p" "$ROWS_FILE.from" 2>/dev/null)" ;;
    esac
    rm -f "$ENTRIES_FILE" "$ROWS_FILE" "$ROWS_FILE.rev" "$ROWS_FILE.out" "$ROWS_FILE.from"
    if [ -z "$TO_VERSION" ]; then
      echo "Rollback cancelled - nothing was changed."
      exit 0
    fi
  else
    rm -f "$ENTRIES_FILE"
    # Empty / missing ledger: fall back to the previous git tag, else manual reinstall.
    echo "[INFO] No update history found yet (the ledger is created by updates)."
    PREV_TAG=""
    if [ -d "$ROOT/.git" ]; then
      PREV_TAG="$(git -C "$ROOT" tag --sort=-creatordate 2>/dev/null | sed -n '2p')"
    fi
    if [ -n "$PREV_TAG" ]; then
      echo "[INFO] Based on the git history, the previous version is: $PREV_TAG"
      printf 'Roll back to %s now? (y/N): ' "$PREV_TAG"
      read -r ANSWER || ANSWER=""
      if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
        TO_VERSION="$PREV_TAG"
      fi
    else
      echo "[INFO] This copy has no local version history (installed from a ZIP)."
      echo "       To go back to an older version: uninstall, then re-install from"
      echo "       the release ZIP you want (see deploy/nodocker/README.md)."
      exit 0
    fi
    if [ -z "$TO_VERSION" ]; then
      echo "Rollback cancelled - nothing was changed."
      exit 0
    fi
  fi
fi

case "$TO_VERSION" in v*) ;; *) TO_VERSION="v$TO_VERSION" ;; esac

echo ""
echo "[ROLLBACK] Going back to $TO_VERSION (a fresh backup is taken first)..."
echo ""

bash "$UPDATE_SCRIPT" -ToVersion "$TO_VERSION" -Force
CODE=$?

echo ""
if [ "$CODE" -eq 0 ]; then
  echo "[OK] Rollback to $TO_VERSION finished successfully."
else
  echo "[FAIL] Rollback had a problem - see the messages above."
  echo "       Take a photo of the screen and send it to your developer."
fi
exit $CODE
