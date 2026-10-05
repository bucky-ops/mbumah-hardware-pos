#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS — No-Docker Laptop Installer (Linux / macOS)
# ============================================================================
# For machines that cannot run Docker. Stack: Node.js 20 + SQLite file.
# Usage: bash deploy/nodocker/install-nodocker.sh [--lan]
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=============================================================="
echo "  MBUMAH HARDWARE POS - No-Docker Laptop Installer"
echo "  (Node.js + SQLite - no virtualization required)"
echo "=============================================================="

# ── 1. Node.js 20+ ───────────────────────────────────────────────────────────
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
fi
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  echo "[FAIL] Node.js 20+ is required. Install it, e.g.:"
  echo "       curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  echo "   or:  https://nodejs.org"
  exit 1
fi
echo "[OK] Node $(node -v)"

# ── 2. bun (used by the database seed step) ──────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  echo "[SETUP] Installing bun (needed for database seeding)..."
  npm install -g bun
fi
echo "[OK] bun $(bun -v)"

# ── 3. Database file + .env (first run only) ────────────────────────────────
DB_DIR="$HOME/mbumah-pos-data"
mkdir -p "$DB_DIR"
DB_FILE="$DB_DIR/pos.db"
DB_URL="file:$DB_FILE"

if [ -f .env ]; then
  echo "[INFO] Existing .env found - keeping it (secrets preserved)."
else
  cp deploy/nodocker/.env.nodocker.example .env
  gen() { openssl rand -base64 "$1" 2>/dev/null || head -c 48 /dev/urandom | base64; }
  sed -i.bak \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" \
    -e "s|^DIRECT_URL=.*|DIRECT_URL=${DB_URL}|" \
    -e "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$(gen 32)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(gen 32)|" \
    -e "s|^CRON_SECRET=.*|CRON_SECRET=$(gen 32)|" \
    .env && rm -f .env.bak
  echo "[OK] .env created - secrets generated, database at: $DB_FILE"
fi

# ── 4. LAN mode — decide BEFORE the build ────────────────────────────────────
if [ "${1:-}" = "--lan" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -z "${LAN_IP}" ]; then
    echo "[FAIL] Could not auto-detect the LAN IP. Set NEXTAUTH_URL and NEXT_PUBLIC_APP_URL in .env manually."
    exit 1
  fi
  sed -i.bak \
    -e "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=http://${LAN_IP}:3000|" \
    -e "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://${LAN_IP}:3000|" \
    .env && rm -f .env.bak
  echo "[OK] LAN access configured: http://${LAN_IP}:3000"
fi

# ── 5. Environment for the toolchain ─────────────────────────────────────────
export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')"
export DIRECT_URL="$(grep -m1 '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
export SKIP_ENV_VALIDATION=1

# ── 6. Install → schema → seed → build ───────────────────────────────────────
echo "[BUILD 1/4] Installing dependencies (2-5 min, needs internet)..."
npm ci

echo "[BUILD 2/4] Creating the database schema..."
npm run db:push

echo "[BUILD 3/4] Seeding the database (admin + demo data)..."
npm run db:seed

echo "[BUILD 4/4] Building the production app (3-8 min)..."
npm run build

# ── 7. Assemble the standalone server ────────────────────────────────────────
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

echo ""
echo "=============================================================="
echo "  INSTALL COMPLETE"
echo "=============================================================="
echo "  Start the POS (anytime):"
echo "    bash deploy/nodocker/start-pos.sh"
echo ""
echo "  First login:  admin@mbumahhardware.co.ke / password123"
echo "  !! CHANGE THE ADMIN PASSWORD IMMEDIATELY (Profile > Security)"
echo "  !! Then set SEED_DATABASE=false in .env"
echo "  Database file (back this up): $DB_FILE"
