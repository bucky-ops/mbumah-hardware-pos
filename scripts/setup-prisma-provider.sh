#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MBUMAH HARDWARE POS — Prisma provider auto-detection (shell version)
# ─────────────────────────────────────────────────────────────────────────────
#
# Sets the Prisma provider in schema.prisma based on the DATABASE_URL scheme:
#   • file:./...        → sqlite      (local dev)
#   • postgresql://...  → postgresql  (Vercel / Neon / Supabase)
#
# Runs before `prisma generate` in the `build` and `db:*` npm scripts.
# Uses sed (portable: works on GNU and BSD sed via temp file).
# ─────────────────────────────────────────────────────────────────────────────
set -e

DB_URL="${DATABASE_URL:-}"

if [[ "$DB_URL" == postgresql:* ]] || [[ "$DB_URL" == postgres:* ]]; then
  PROVIDER="postgresql"
elif [[ "$DB_URL" == file:* ]]; then
  PROVIDER="sqlite"
else
  # Default to sqlite when DATABASE_URL is unset (fresh install before .env)
  PROVIDER="sqlite"
fi

# Replace the provider value in the datasource block.
# We only target "sqlite" and "postgresql" — the generator's
# "prisma-client-js" provider is never matched.
sed "s/provider = \"sqlite\"/provider = \"${PROVIDER}\"/g; s/provider = \"postgresql\"/provider = \"${PROVIDER}\"/g" \
  prisma/schema.prisma > prisma/schema.prisma.tmp
mv prisma/schema.prisma.tmp prisma/schema.prisma

echo "✓ Prisma provider set to: ${PROVIDER}"
