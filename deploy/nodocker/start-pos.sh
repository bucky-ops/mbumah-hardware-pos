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

( sleep 4; xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null || true ) &

echo "Starting MBUMAH HARDWARE POS... (Ctrl+C stops it)"
node deploy/nodocker/start-server.mjs
