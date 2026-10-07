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
