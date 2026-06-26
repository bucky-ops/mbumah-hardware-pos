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
  # Default to POSTGRESQL when DATABASE_URL is unset.
  # This happens during Vercel's install phase (before build env vars are
  # injected) and during fresh `bun install` before .env exists. Defaulting
  # to postgresql ensures the committed schema (provider=postgresql) is
  # used as-is on Vercel, preventing the "URL must start with file:" runtime
  # error that occurs when sqlite provider meets a postgresql DATABASE_URL.
  # Local dev with SQLite MUST set DATABASE_URL=file:./... in .env so the
  # postinstall hook switches the provider correctly.
  PROVIDER="postgresql"
fi

# Replace the provider value in the datasource block.
# We only target "sqlite" and "postgresql" — the generator's
# "prisma-client-js" provider is never matched.
# Use a regex that tolerates variable whitespace between "provider" and "="
# (the committed schema uses `provider  = "postgresql"` with 2 spaces for
# alignment with `directUrl =`).
sed -E "s/(provider[[:space:]]+=[[:space:]]+\")(sqlite|postgresql)(\")/\1${PROVIDER}\3/g" \
  prisma/schema.prisma > prisma/schema.prisma.tmp
mv prisma/schema.prisma.tmp prisma/schema.prisma

echo "✓ Prisma provider set to: ${PROVIDER}"
