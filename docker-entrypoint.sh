#!/bin/sh
# ============================================================================
# MBUMAH HARDWARE POS - Docker Entrypoint
# Runs Prisma schema push + seed before starting the Next.js server.
# ============================================================================

set -e

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║          MBUMAH HARDWARE POS - Starting Production Server       ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# ── Step 1: Configure Prisma provider ────────────────────────────────────────
echo ""
echo "[1/4] Configuring Prisma provider for DATABASE_URL..."
node scripts/setup-prisma-provider.mjs

# ── Step 2: Generate Prisma Client ───────────────────────────────────────────
echo ""
echo "[2/4] Generating Prisma Client..."
npx prisma generate

# ── Step 3: Converge the database schema ─────────────────────────────────────
# Using `prisma db push` (via scripts/ensure-schema.mjs) instead of
# `prisma migrate deploy` because:
#   - Self-hosted deployments typically start from an empty database
#   - db push is simpler and doesn't require migration history
#   - For existing databases the push is additive; when it is refused (adding
#     unique indexes to a non-empty database), ensure-schema.mjs backs the
#     file up and converges with --accept-data-loss (self-heal, v2.15.2)
echo ""
echo "[3/4] Pushing database schema..."
# Self-healing converge (v2.15.2): plain `db push` REFUSES to add unique
# indexes (e.g. the idempotencyKey columns) to a NON-EMPTY existing database,
# which left self-hosted containers serving Prisma P2022 errors after an
# update. scripts/ensure-schema.mjs retries with the data-loss acceptance
# after a safety backup - see the header of that script.
node scripts/ensure-schema.mjs || {
  echo "Warning: schema converge failed. The database may not be ready yet."
  echo "   Retrying in 5 seconds..."
  sleep 5
  node scripts/ensure-schema.mjs || {
    echo "[FAIL] Database schema could not be converged after retry. Check your DATABASE_URL."
    echo "   Exiting so the container restart policy can retry from a clean state."
    echo "   (Starting the server anyway would render every module 'unavailable'.)"
    exit 1
  }
}

# ── Step 4: Seed database (first run only) ───────────────────────────────────
# The seed script is idempotent - it checks for existing data before inserting.
# Seeding runs when SEED_DATABASE=true, OR automatically when the database is
# EMPTY (fresh install). The auto-seed guarantees a new laptop/compose stack
# always boots with the admin account present instead of an unusable,
# "backend unavailable" empty database.
echo ""
echo "[4/4] Seeding database (if needed)..."
if [ "${SEED_DATABASE:-false}" = "true" ]; then
  echo "   SEED_DATABASE=true - running seed..."
  npx prisma db seed 2>&1 || echo "Warning: Seed failed. You can run it manually: docker compose exec app npx prisma db seed"
else
  VERIFY=0
  node ./verify-db.mjs || VERIFY=$?
  if [ "$VERIFY" = "10" ]; then
    echo "   Database is reachable but EMPTY - running the first-run seed..."
    npx prisma db seed 2>&1 || echo "Warning: Seed failed. You can run it manually: docker compose exec app npx prisma db seed"
  elif [ "$VERIFY" = "0" ]; then
    echo "   Database already seeded - skipping (set SEED_DATABASE=true to force)."
  else
    echo "   Warning: Could not verify the database (see error above). You can run the seed manually:"
    echo "      docker compose exec app npx prisma db seed"
  fi
fi

# ── Start the server ─────────────────────────────────────────────────────────
echo ""
echo "[ok] Startup checks complete. Starting Next.js server on port 3000..."
echo ""
exec node server.js
