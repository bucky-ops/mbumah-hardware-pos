#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS — Start the POS (Linux/macOS, no Docker)
# Runs the app in the foreground; background jobs go to cron.log.
# ============================================================================
set -e
cd "$(dirname "$0")/../.."

if [ ! -f .next/standalone/server.js ]; then
  echo "[FAIL] No build found. Run the installer first: bash deploy/nodocker/install-nodocker.sh"
  exit 1
fi

# Refresh standalone static/public copies (idempotent)
[ -d .next/static ] && cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
[ -d public ] && cp -r public .next/standalone/ 2>/dev/null || true

# ── UPDATE ON STARTUP (v2.10.1) ─────────────────────────────────────────────
# Every launch checks GitHub for a newer release and installs it BEFORE the
# POS starts (catch-up for installs that were off at the 23:00 cron, and for
# installs created before the updater existed). Backs up data first; a failed
# update rolls the code back automatically. Disable: UPDATE_ON_START=0 in .env
# or pass -NoUpdate once.
SKIP_UPDATE=0
for arg in "$@"; do
  case "$arg" in
    -NoUpdate|--no-update) SKIP_UPDATE=1 ;;
  esac
done
if [ "$SKIP_UPDATE" -eq 0 ]; then
  UOS="$(grep -m1 -E '^UPDATE_ON_START=' .env 2>/dev/null | sed -E 's/^UPDATE_ON_START=//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//' || echo "")"
  case "$UOS" in
    0|false|no|off) SKIP_UPDATE=1 ;;
  esac
fi
if [ "$SKIP_UPDATE" -eq 0 ]; then
  PKG_BEFORE="$(node -p "require('./package.json').version" 2>/dev/null || echo "")"
  echo ""
  echo "Checking for updates... (disable with UPDATE_ON_START=0 in .env)"
  bash deploy/nodocker/update-pos.sh -Quiet -NoStart || echo "[WARN] Update check failed - starting the POS anyway."
  PKG_AFTER="$(node -p "require('./package.json').version" 2>/dev/null || echo "")"
  if [ -n "$PKG_BEFORE" ] && [ -n "$PKG_AFTER" ] && [ "$PKG_BEFORE" != "$PKG_AFTER" ]; then
    echo "[OK] Mbumah POS was updated to v$PKG_AFTER."
  fi
fi

# Background jobs in the background, logged to cron.log
nohup node deploy/nodocker/cron-local.mjs > cron.log 2>&1 &
echo "Background jobs running → cron.log (pid $!)"

# Readiness watcher: wait until health reports a WORKING database (not just a
# 200 — an empty database also returns 200), then open the browser. If the DB
# stays broken, print the same fix the Windows script shows.
(
  for i in $(seq 1 30); do
    sleep 2
    BODY="$(curl -sf -m 3 http://127.0.0.1:3000/api/health 2>/dev/null)" || continue
    STATS="$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);console.log(h.checks?.database_stats?.status??"unknown");}catch{console.log("unknown")}})' 2>/dev/null)"
    if [ "$STATS" = "ok" ]; then
      ( xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null || true ) &
      break
    fi
  done
  if [ "$STATS" != "ok" ] 2>/dev/null; then
    echo ""
    echo "WARNING: server is running but the DATABASE is not ready (modules will show unavailable)."
    echo "  Fix: re-run the installer → bash deploy/nodocker/install-nodocker.sh"
    echo "  Diagnose with: node deploy/nodocker/verify-db.mjs"
  fi
) &

echo "Starting MBUMAH HARDWARE POS... (Ctrl+C stops it)"
node deploy/nodocker/start-server.mjs
