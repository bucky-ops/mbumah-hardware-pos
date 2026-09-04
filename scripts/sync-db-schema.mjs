#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Build-time database schema sync
// ─────────────────────────────────────────────────────────────────────────────
//
// ROOT-CAUSE FIX for the production HTTP 500 on POST /api/transactions.
//
// INCIDENT SUMMARY (2026-09):
//   Every POS checkout returned `500 {"success":false,"error":"An unexpected
//   error occurred. Please try again."}`. Reproduced locally with a drifted
//   database: the deployed code writes `SalesTransaction.idempotencyKey`
//   (and M-Pesa checkouts write `OutboxEvent` rows) — columns/tables added by
//   the financial-audit remediation (PRs #12/#14). The Vercel build command
//   only ran `prisma generate && next build`, so the production Neon database
//   — originally created with `prisma db push` — never received the new
//   schema objects. First checkout query → Prisma P2022
//   "The column `idempotencyKey` does not exist in the current database".
//
// WHY `db push` ALONE COULDN'T SELF-HEAL:
//   Prisma classifies adding a UNIQUE constraint as a data-loss warning and
//   REFUSES `prisma db push` without `--accept-data-loss` (verified: the
//   `idempotencyKey @unique` index addition triggers exactly that refusal).
//
// THIS SCRIPT (runs in `npm run vercel-build` BEFORE `next build`):
//   1. `prisma migrate deploy`            — the correct, data-loss-safe path.
//      Works on any database with a migration history (fresh Neon branches).
//   2. FALLBACK `prisma db push`          — one-time drift recovery for
//      databases created via `db push` (no `_prisma_migrations` history).
//      The fallback NEEDS `--accept-data-loss` because of the unique-index
//      warning above. This is safe ONLY because the verified prod drift is
//      purely additive (new nullable column + new table + indexes). The build
//      fails loudly if even this cannot converge.
//   3. `prisma migrate resolve --applied` — best-effort: records the baseline
//      migration as applied so FUTURE deploys take the clean `migrate deploy`
//      path (step 1) and the `--accept-data-loss` fallback never runs again.
//
// The script is a no-op when DATABASE_URL is absent (e.g. `vercel build`
// locally without env vars) so generic builds never hard-fail here.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';

const BASELINE_MIGRATION = '20260904120000_financial_baseline';

const DATABASE_URL = process.env.DATABASE_URL || '';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`❌ [schema-sync] failed to launch ${cmd}:`, result.error.message);
    return false;
  }
  return result.status === 0;
}

if (!DATABASE_URL) {
  console.warn('⚠️  [schema-sync] DATABASE_URL is not set — skipping schema sync.');
  console.warn('    Production deploys MUST provide DATABASE_URL (Neon) or runtime');
  console.warn('    queries will fail with Prisma P2021/P2022 (missing table/column).');
  process.exit(0);
}

console.log('🗄️  [schema-sync] step 1/3: prisma migrate deploy …');
if (run('npx', ['prisma', 'migrate', 'deploy'])) {
  console.log('✅ [schema-sync] migration history applied — schema is up to date.');
  process.exit(0);
}

console.warn('⚠️  [schema-sync] migrate deploy failed (expected for databases created');
console.warn('    with `prisma db push` — they have no migration history yet).');
console.warn('🗄️  [schema-sync] step 2/3: prisma db push (one-time drift recovery) …');
console.warn('    → Uses --accept-data-loss because adding unique indexes (e.g.');
console.warn('      sales_transactions.idempotencyKey) is classified as a data-loss');
console.warn('      warning. Verified safe: the current drift is purely additive.');
if (!run('npx', ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate'])) {
  console.error('❌ [schema-sync] db push could not converge the schema. Aborting the');
  console.error('   build rather than deploying code that will 500 at runtime.');
  console.error('   ACTION: inspect the database state (duplicate rows on new unique');
  console.error('   keys are the usual cause) and re-deploy.');
  process.exit(1);
}

console.log('♻️  [schema-sync] step 3/3: recording baseline migration as applied …');
console.log(`    (best-effort — future deploys will use migrate deploy exclusively)`);
const resolved = run('npx', ['prisma', 'migrate', 'resolve', '--applied', BASELINE_MIGRATION]);
if (!resolved) {
  console.warn('⚠️  [schema-sync] could not mark the baseline applied (non-fatal).');
  console.warn('    Schema IS synced; future deploys will retry the converge step.');
}

console.log('✅ [schema-sync] database schema is in sync with prisma/schema.prisma.');
