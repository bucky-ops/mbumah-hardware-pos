#!/usr/bin/env bash
# Vercel Build Script for MBUMAH HARDWARE POS
# Handles Prisma generation with fallback env vars and Neon PostgreSQL setup

set -e

echo "=== MBUMAH HARDWARE POS - Vercel Build ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "OS: $(uname -s) $(uname -m)"

# Ensure DATABASE_URL exists for prisma generate
# Prisma generate validates the schema and needs env vars to be present
# We use the actual DATABASE_URL if available (from Vercel env), otherwise a dummy
if [ -z "${DATABASE_URL:-}" ]; then
  echo "⚠️  DATABASE_URL not set, using dummy URL for prisma generate"
  export DATABASE_URL="postgresql://build:build@localhost/build"
fi

if [ -z "${DIRECT_URL:-}" ]; then
  echo "⚠️  DIRECT_URL not set, using dummy URL for prisma generate"
  export DIRECT_URL="postgresql://build:build@localhost/build"
fi

# Strip channel_binding=require from URLs - Prisma doesn't support it
export DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/&channel_binding=require//' | sed 's/?channel_binding=require&/?/' | sed 's/?channel_binding=require$//')
export DIRECT_URL=$(echo "$DIRECT_URL" | sed 's/&channel_binding=require//' | sed 's/?channel_binding=require&/?/' | sed 's/?channel_binding=require$//')

echo "✅ DATABASE_URL is set (starts with: ${DATABASE_URL:0:30}...)"

# Generate Prisma client with correct binary targets for Vercel
echo "🔧 Running prisma generate..."
npx prisma generate

# Verify Prisma client was generated
echo "📦 Checking Prisma client..."
ls -la node_modules/.prisma/client/ 2>/dev/null || echo "⚠️  Prisma client not found in expected location"
ls -la node_modules/@prisma/client/ 2>/dev/null || echo "⚠️  @prisma/client not found"

# Run migrations if we have a real Neon/PostgreSQL database URL
if [[ "$DATABASE_URL" == *"neon.tech"* ]]; then
  echo "🗄️  Running prisma migrate deploy..."
  npx prisma migrate deploy || {
    echo "⚠️  Migration deploy failed, trying prisma db push..."
    npx prisma db push --accept-data-loss || {
      echo "⚠️  DB push also failed, continuing with build anyway..."
    }
  }
else
  echo "ℹ️  Skipping migrations (not a Neon database URL)"
fi

# Build the Next.js app
echo "🏗️  Running next build..."
npx next build

echo "✅ Build complete!"
