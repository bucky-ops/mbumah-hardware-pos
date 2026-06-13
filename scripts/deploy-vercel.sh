#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - Vercel Deployment Script
# ============================================================================
# This script deploys the project to Vercel with a Neon PostgreSQL database.
#
# Prerequisites:
#   - Node.js 18+ and npm installed
#   - A Vercel account (https://vercel.com/signup)
#   - A Neon account (https://neon.tech/signup) - Free tier works
#   - Vercel CLI: npm i -g vercel
#
# Usage:
#   Option 1: Full automated deployment
#     ./scripts/deploy-vercel.sh
#
#   Option 2: With existing Neon database
#     DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." ./scripts/deploy-vercel.sh
#
#   Option 3: With Vercel token (for CI/CD)
#     VERCEL_TOKEN="your-token" ./scripts/deploy-vercel.sh
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  __  __  ____  ___    ____                     _                 "
echo " |  \\/  |/ ___|/ _ \\  |  _ \\ __ _ ___ _____   _| |__   ___ _ __  "
echo " | |\\/| | |   | | | | | |_) / _\` / __/ __| | | | '_ \\ / _ \\ '__| "
echo " | |  | | |___| |_| | |  _ < (_| \\__ \\__ \\ |_| | |_) |  __/ |    "
echo " |_|  |_|\\____|\\___/  |_| \\_\\__,_|___/___/\\__,_|_.__/ \\___|_|    "
echo ""
echo "  HARDWARE POS & ERP - Vercel Deployment"
echo -e "${NC}"

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

for cmd in node npm npx; do
  if ! command -v $cmd &> /dev/null; then
    echo -e "${RED}Error: $cmd is not installed. Please install Node.js 18+.${NC}"
    exit 1
  fi
done

if ! command -v vercel &> /dev/null; then
  echo -e "${YELLOW}Vercel CLI not found. Installing...${NC}"
  npm install -g vercel
fi

echo -e "${GREEN}All prerequisites met.${NC}"

# Step 2: Set up Neon PostgreSQL database
echo -e "${YELLOW}[2/7] Setting up PostgreSQL database...${NC}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo ""
  echo -e "${BLUE}You need a PostgreSQL database for Vercel deployment.${NC}"
  echo ""
  echo "Option A: Create a free Neon database at https://console.neon.tech"
  echo "  1. Sign up / Log in"
  echo "  2. Click 'Create Project'"
  echo "  3. Name: mbumah-hardware-pos"
  echo "  4. Region: Choose closest to your users"
  echo "  5. Copy the connection string from the Dashboard"
  echo ""
  echo "Option B: Use Supabase at https://supabase.com (also free)"
  echo ""
  echo -e "${YELLOW}Paste your DATABASE_URL (PostgreSQL connection string):${NC}"
  read -r DATABASE_URL
fi

if [ -z "${DIRECT_URL:-}" ]; then
  # For Neon, the direct URL is the same as pooled URL but without -pooler
  DIRECT_URL="${DATABASE_URL}"
  echo -e "${BLUE}Using DATABASE_URL as DIRECT_URL (same for Neon).${NC}"
fi

echo -e "${GREEN}Database URL configured.${NC}"

# Step 3: Update .env file
echo -e "${YELLOW}[3/7] Updating environment configuration...${NC}"

cat > .env << EOF
DATABASE_URL="${DATABASE_URL}"
DIRECT_URL="${DIRECT_URL}"
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo 'mbumah-pos-secret-'$(date +%s))"
NEXTAUTH_URL="https://mbumah-hardware-pos.vercel.app"
JWT_SECRET="$(openssl rand -base64 32 2>/dev/null || echo 'mbumah-pos-jwt-'$(date +%s))"
NEXT_PUBLIC_APP_URL="https://mbumah-hardware-pos.vercel.app"
NEXT_PUBLIC_CURRENCY="KES"
EOF

echo -e "${GREEN}.env file updated.${NC}"

# Step 4: Generate Prisma client and run migrations
echo -e "${YELLOW}[4/7] Running Prisma migrations...${NC}"

export DATABASE_URL DIRECT_URL
npx prisma generate
npx prisma migrate deploy

echo -e "${GREEN}Migrations applied.${NC}"

# Step 5: Seed the database
echo -e "${YELLOW}[5/7] Seeding database with demo data...${NC}"

npx prisma db seed

echo -e "${GREEN}Database seeded.${NC}"

# Step 6: Deploy to Vercel
echo -e "${YELLOW}[6/7] Deploying to Vercel...${NC}"

# Link the project
VERCEL_ARGS=""
if [ -n "${VERCEL_TOKEN:-}" ]; then
  VERCEL_ARGS="--token ${VERCEL_TOKEN}"
fi

vercel link --yes $VERCEL_ARGS

# Set environment variables on Vercel
echo -e "${BLUE}Setting environment variables on Vercel...${NC}"

vercel env add DATABASE_URL production $VERCEL_ARGS <<< "$DATABASE_URL"
vercel env add DIRECT_URL production $VERCEL_ARGS <<< "$DIRECT_URL"
vercel env add NEXTAUTH_SECRET production $VERCEL_ARGS <<< "$(grep NEXTAUTH_SECRET .env | cut -d= -f2)"
vercel env add NEXTAUTH_URL production $VERCEL_ARGS <<< "https://mbumah-hardware-pos.vercel.app"
vercel env add JWT_SECRET production $VERCEL_ARGS <<< "$(grep JWT_SECRET .env | cut -d= -f2)"
vercel env add NEXT_PUBLIC_APP_URL production $VERCEL_ARGS <<< "https://mbumah-hardware-pos.vercel.app"
vercel env add NEXT_PUBLIC_CURRENCY production $VERCEL_ARGS <<< "KES"

# Deploy
vercel --prod $VERCEL_ARGS

echo -e "${GREEN}Deployed to Vercel!${NC}"

# Step 7: Summary
echo -e "${YELLOW}[7/7] Deployment complete!${NC}"

echo -e "${GREEN}"
echo "=========================================="
echo "  DEPLOYMENT SUCCESSFUL!"
echo "=========================================="
echo ""
echo "  Your app is live at:"
echo "  https://mbumah-hardware-pos.vercel.app"
echo ""
echo "  Demo accounts:"
echo "  - Super Admin:  admin@mbumahhardware.co.ke / Admin@2024"
echo "  - Branch Mgr:   thika.manager@mbumahhardware.co.ke / Manager@2024"
echo "  - Cashier:      cashier@mbumahhardware.co.ke / Cashier@2024"
echo "  - Accountant:   accountant@mbumahhardware.co.ke / Accountant@2024"
echo ""
echo "  Database: Neon PostgreSQL"
echo "  Next steps:"
echo "  1. Visit your app URL above"
echo "  2. Log in with the demo accounts"
echo "  3. Configure M-Pesa credentials in Settings"
echo "=========================================="
echo -e "${NC}"
