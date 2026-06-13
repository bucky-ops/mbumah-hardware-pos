#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - Quick Neon PostgreSQL Setup
# ============================================================================
# Creates a Neon PostgreSQL database and configures the project for Vercel.
#
# Prerequisites:
#   - Neon CLI: npm install -g neonctl
#   - A Neon account (free at https://neon.tech)
#
# Usage:
#   ./scripts/setup-neon.sh                    # Interactive (browser login)
#   NEON_API_KEY=xxx ./scripts/setup-neon.sh   # Non-interactive with API key
# ============================================================================

set -euo pipefail

echo "MBUMAH HARDWARE POS - Neon PostgreSQL Setup"
echo "============================================"

# Check for Neon CLI
if ! command -v neonctl &> /dev/null; then
  echo "Installing Neon CLI..."
  npm install -g neonctl
fi

# Authenticate
if [ -n "${NEON_API_KEY:-}" ]; then
  echo "Using provided NEON_API_KEY"
  export NEON_API_KEY
else
  echo "Opening browser for Neon authentication..."
  neonctl auth
fi

# Create project
echo "Creating Neon project..."
PROJECT_OUTPUT=$(neonctl projects create \
  --name "mbumah-hardware-pos" \
  --region-id "aws-us-east-1" \
  --pg-version 16 \
  --output json 2>&1)

PROJECT_ID=$(echo "$PROJECT_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])" 2>/dev/null || echo "")

if [ -z "$PROJECT_ID" ]; then
  echo "Failed to create project. Output:"
  echo "$PROJECT_OUTPUT"
  exit 1
fi

echo "Project created: $PROJECT_ID"

# Get connection string
echo "Retrieving connection string..."
CONN_OUTPUT=$(neonctl connection-string "$PROJECT_ID" --role-name neondb_owner --database-name neondb 2>&1)
DATABASE_URL="$CONN_OUTPUT"

# Direct URL (without pooler)
DIRECT_URL=$(echo "$DATABASE_URL" | sed 's/-pooler//g')

echo ""
echo "Connection strings:"
echo "  DATABASE_URL: $DATABASE_URL"
echo "  DIRECT_URL:   $DIRECT_URL"

# Update .env
echo ""
echo "Updating .env file..."

# Generate secrets
NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "mbumah-pos-secret-$(date +%s)")
JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "mbumah-pos-jwt-$(date +%s)")

cat > .env << EOF
DATABASE_URL="${DATABASE_URL}"
DIRECT_URL="${DIRECT_URL}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="${JWT_SECRET}"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_CURRENCY="KES"
EOF

echo ".env updated with Neon connection strings."

# Generate Prisma client and push schema
echo ""
echo "Running Prisma migrations..."
npx prisma generate
npx prisma migrate deploy

echo ""
echo "Seeding database..."
npx prisma db seed

echo ""
echo "=========================================="
echo "  Neon database setup complete!"
echo ""
echo "  Connection strings saved to .env"
echo "  Database seeded with demo data"
echo ""
echo "  Next steps:"
echo "  1. Run 'bun run dev' to test locally"
echo "  2. Run './scripts/deploy-vercel.sh' to deploy"
echo "=========================================="
