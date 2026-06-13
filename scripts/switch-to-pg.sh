#!/usr/bin/env bash
# Switches Prisma schema from SQLite to PostgreSQL for Vercel builds
# This is called during the Vercel build process

SCHEMA_FILE="prisma/schema.prisma"

# On Vercel, the VERCEL environment variable is always set
if [ -z "${VERCEL:-}" ]; then
  echo "Not running on Vercel, keeping SQLite for local dev"
  exit 0
fi

echo "Vercel environment detected, switching schema to PostgreSQL..."

# Replace sqlite with postgresql
sed -i 's/provider  = "sqlite"/provider  = "postgresql"/' "$SCHEMA_FILE"

# Add directUrl if not present
if ! grep -q "directUrl" "$SCHEMA_FILE"; then
  sed -i '/url       = env("DATABASE_URL")/a\  directUrl = env("DIRECT_URL")' "$SCHEMA_FILE"
fi

# Remove migration_lock.toml to avoid provider mismatch
rm -f prisma/migrations/migration_lock.toml

echo "Schema switched to PostgreSQL for production build"
