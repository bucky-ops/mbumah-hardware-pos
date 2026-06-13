#!/usr/bin/env bash
# Switches Prisma schema from SQLite to PostgreSQL for Vercel builds
# This is called during the Vercel build process

SCHEMA_FILE="prisma/schema.prisma"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "No DATABASE_URL found, keeping SQLite for local dev"
  exit 0
fi

# Check if DATABASE_URL is a PostgreSQL URL
if [[ "$DATABASE_URL" == postgres* ]]; then
  echo "PostgreSQL DATABASE_URL detected, switching schema provider..."

  # Replace sqlite with postgresql
  sed -i 's/provider  = "sqlite"/provider  = "postgresql"/' "$SCHEMA_FILE"

  # Add directUrl if not present
  if ! grep -q "directUrl" "$SCHEMA_FILE"; then
    sed -i '/url       = env("DATABASE_URL")/a\  directUrl = env("DIRECT_URL")' "$SCHEMA_FILE"
  fi

  echo "Schema switched to PostgreSQL for production build"
else
  echo "Non-PostgreSQL DATABASE_URL, keeping SQLite"
fi
