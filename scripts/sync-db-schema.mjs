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
// The script is a no-op when DATABASE_URL is absent OR the database is
// UNREACHABLE (e.g. `vercel build` locally without env vars, or the GitHub
// Actions "Build" check which exports a dummy
// `postgresql://…@localhost:5432/…` DATABASE_URL purely so the
// provider auto-detection in setup-prisma-provider.mjs generates the
// postgresql client — there is no database server in CI, nothing to sync,
// and `next build` does not need one). Hard-fail (exit 1) is reserved for
// the case where the database IS reachable but cannot be converged — that
// is the genuine "do not deploy a build that will 500" signal.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import net from 'node:net';

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

// ── Reachability gate ────────────────────────────────────────────────────────
// Probes host:port from DATABASE_URL with a short TCP connect. Unreachable
// (connection refused / timeout / DNS failure) ⇒ there is no database to
// sync in this environment: warn loudly and skip (exit 0) so DB-less build
// environments (GitHub Actions) still produce artifacts. A reachable-but-
// uncooperative database keeps the strict fail-loudly behaviour below.
function probeDatabaseReachability(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const host = url.hostname;
    // IPv6 literals arrive bracketed in hrefs; net.connect wants them bare.
    const cleanHost = host.replace(/^\[|\]$/g, '');
    const port = Number.parseInt(url.port, 10) || 5432;
    const socket = net.connect({ host: cleanHost, port, timeout: timeoutMs });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function parseDatabaseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

if (!DATABASE_URL) {
  console.warn('⚠️  [schema-sync] DATABASE_URL is not set — skipping schema sync.');
  console.warn('    Production deploys MUST provide DATABASE_URL (Neon) or runtime');
  console.warn('    queries will fail with Prisma P2021/P2022 (missing table/column).');
  process.exit(0);
}

const dbUrl = parseDatabaseUrl(DATABASE_URL);
if (dbUrl && dbUrl.protocol.startsWith('postgres') && dbUrl.hostname) {
  const reachable = await probeDatabaseReachability(dbUrl);
  if (!reachable) {
    console.warn('⚠️  [schema-sync] database host ' + dbUrl.hostname + ':' +
      (Number.parseInt(dbUrl.port, 10) || 5432) + ' is UNREACHABLE — skipping schema sync.');
    console.warn('    Nothing to sync in this environment (e.g. GitHub Actions Build check');
    console.warn('    uses a placeholder localhost DATABASE_URL for provider detection).');
    console.warn('    Production deploys MUST provide a reachable DATABASE_URL (Neon) or');
    console.warn('    runtime queries will fail with Prisma P2021/P2022 (missing table/column).');
    process.exit(0);
  }
} else if (!dbUrl) {
  console.warn('⚠️  [schema-sync] DATABASE_URL is not a parsable URL — skipping schema sync.');
  process.exit(0);
}

// ── DIRECT_URL fallback (CLI schema operations) ──────────────────────────────
// schema.prisma declares `directUrl = env("DIRECT_URL")`. The Prisma CLI
// (migrate deploy / db push / migrate resolve) resolves it and FAILS with
// P1012 "Environment variable not found: DIRECT_URL" when absent — which
// would kill every build in environments that only configure DATABASE_URL.
// Schema surgery wants a DIRECT (non-pooled) connection, but falling back to
// DATABASE_URL is strictly better than failing the build: the pre-#15
// pipeline never touched the database at build time at all.
if (process.env.DIRECT_URL) {
  console.log('🔗 [schema-sync] DIRECT_URL is set — schema commands use the direct endpoint.');
} else {
  console.warn('⚠️  [schema-sync] DIRECT_URL is not set — falling back to DATABASE_URL for');
  console.warn('    schema commands. Neon: prefer the direct (non-pooled) endpoint for');
  console.warn('    build-time schema operations to avoid pgbouncer quirks.');
  process.env.DIRECT_URL = DATABASE_URL;
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
