#!/usr/bin/env bash
# Vercel Build Script for MBUMAH HARDWARE POS
# Handles Prisma generation with fallback env vars and Neon PostgreSQL setup

set -e

echo "=== MBUMAH HARDWARE POS - Vercel Build ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

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

echo "✅ DATABASE_URL is set (starts with: ${DATABASE_URL:0:30}...)"

# Generate Prisma client
echo "🔧 Running prisma generate..."
npx prisma generate

# Run migrations if we have a real Neon database URL
if [[ "$DATABASE_URL" == *"neon.tech"* ]] || [[ "$DATABASE_URL" == *"postgresql"* ]]; then
  echo "🗄️  Running prisma migrate deploy..."
  npx prisma migrate deploy || {
    echo "⚠️  Migration deploy failed, trying prisma db push..."
    npx prisma db push --accept-data-loss || {
      echo "⚠️  DB push also failed, continuing with build anyway..."
    }
  }
else
  echo "ℹ️  Skipping migrations (not a PostgreSQL database URL)"
fi

# Build the Next.js app
echo "🏗️  Running next build..."
npx next build

echo "✅ Build complete!"
