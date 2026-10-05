#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS — One-command laptop installer (Linux / macOS / WSL)
# ============================================================================
# Usage:
#   bash deploy/laptop/install-laptop.sh [--lan]
#
#   --lan   Configure the POS on the laptop's LAN IP instead of localhost
#           so phones/other PCs on the shop Wi-Fi can connect.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║      MBUMAH HARDWARE POS — Laptop Standalone Installer           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# ── 1. Preflight ─────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is not installed. Install Docker first:"
  echo "   curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose v2 is not available. Update Docker."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker daemon is not running. Start Docker and re-run."
  exit 1
fi
echo "✅ Docker is ready"

# ── 2. Generate .env with real secrets (first run only) ─────────────────────
if [ -f .env ]; then
  echo "ℹ️  Existing .env found — keeping it (secrets preserved)."
else
  cp deploy/laptop/.env.laptop.example .env
  PG_PASS="$(openssl rand -base64 24 | tr -d '/+=')"
  NA_SECRET="$(openssl rand -base64 32)"
  JWT_SECRET="$(openssl rand -base64 32)"
  CRON_SECRET="$(openssl rand -base64 32)"
  sed -i.bak \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" \
    -e "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${NA_SECRET}|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
    -e "s|^CRON_SECRET=.*|CRON_SECRET=${CRON_SECRET}|" \
    .env && rm -f .env.bak
  echo "✅ .env created with freshly generated secrets"
fi

# ── 3. LAN mode (optional) ───────────────────────────────────────────────────
if [ "${1:-}" = "--lan" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -z "${LAN_IP}" ]; then
    echo "❌ Could not auto-detect the LAN IP. Set NEXTAUTH_URL and"
    echo "   NEXT_PUBLIC_APP_URL in .env manually, then re-run."
    exit 1
  fi
  sed -i.bak \
    -e "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=http://${LAN_IP}:3000|" \
    -e "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://${LAN_IP}:3000|" \
    .env && rm -f .env.bak
  echo "✅ Configured for LAN access at http://${LAN_IP}:3000"
fi

# ── 4. Build and start the stack (first build takes 5–15 min) ────────────────
echo "🏗️  Building and starting the stack (first build: 5–15 minutes)..."
docker compose -f docker-compose.laptop.yml up -d --build

# ── 5. Wait for the app to become healthy ────────────────────────────────────
echo "⏳ Waiting for the app to become healthy (up to 10 minutes)..."
for i in $(seq 1 40); do
  if curl -fsS http://localhost:${APP_PORT:-3000}/api/health >/dev/null 2>&1; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ✅ MBUMAH HARDWARE POS IS RUNNING                               ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "   🌐 Open:       $(grep '^NEXTAUTH_URL=' .env | cut -d= -f2-)"
    echo "   👤 Login:      admin@mbumahhardware.co.ke"
    echo "   🔑 Password:   password123"
    echo ""
    echo "   ⚠️  1. CHANGE THE ADMIN PASSWORD IMMEDIATELY (Profile → Security)"
    echo "   ⚠️  2. After first login set SEED_DATABASE=false in .env, then:"
    echo "         docker compose -f docker-compose.laptop.yml up -d"
    echo ""
    exit 0
  fi
  printf "."
  sleep 15
done

echo ""
echo "❌ App did not become healthy in 10 minutes. Check logs:"
echo "   docker compose -f docker-compose.laptop.yml logs app --tail=100"
exit 1
