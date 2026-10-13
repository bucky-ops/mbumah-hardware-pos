#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - standalone server launcher (no-Docker installs)
// Loads <repo>/.env into the environment, then runs the Next.js standalone
// server (.next/standalone/server.js). The standalone server does not read
// .env by itself, which is why this launcher exists.
//
// PRECEDENCE (IMPORTANT - this caused the "backend unavailable / empty DB"
// class of failures): values from <repo>/.env OVERRIDE any DATABASE_URL etc.
// already present in the inherited environment. A stray DATABASE_URL left
// over in the shell/system environment (from another project, a manual
// `set DATABASE_URL=...`, a CI harness, ...) used to silently redirect the
// server to a different - often empty - database: the frontend still rendered
// (static assets) while every API call failed with "table does not exist".
// The launcher's entire documented job is to apply the repo .env, so .env
// wins. NODE_ENV / PORT / HOSTNAME are still controlled here after loading.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    // .env WINS over the inherited environment (see header comment).
    process.env[m[1]] = v;
  }
} else {
  console.error('✗ .env not found in repo root. Run the installer first.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || process.env.APP_PORT || '3000';
process.env.HOSTNAME = '0.0.0.0';

const server = join(root, '.next', 'standalone', 'server.js');
if (!existsSync(server)) {
  console.error('✗ Build output missing (.next/standalone/server.js). Run the installer first.');
  process.exit(1);
}

console.log('──────────────────────────────────────────────────');
console.log('  MBUMAH HARDWARE POS');
console.log(`  →  http://localhost:${process.env.PORT}   (keep this window open)`);
// Show WHICH database file this server will use - makes the "wrong/empty
// database" class of failures visible at a glance in the support photo.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('file:')) {
  console.log(`  Database: ${process.env.DATABASE_URL.slice('file:'.length)}`);
} else if (process.env.DATABASE_URL) {
  console.log(`  Database: ${String(process.env.DATABASE_URL).replace(/:\/\/[^@]*@/, '://***@')}`);
}
console.log('──────────────────────────────────────────────────');

// ---------------------------------------------------------------------------
// SCHEMA SELF-HEAL (v2.15.2): a laptop whose database was created by an older
// release can boot with a schema that lags the code (e.g. v2.14.0 added the
// `idempotencyKey @unique` columns; the bare `prisma db push` the older
// installers ran refuses to add unique indexes to a non-empty database).
// The server then serves Prisma P2022 errors on /api/notifications, /api/debt,
// /api/reminders/debt/overdue and /api/stock-movements while /api/health
// still looks fine. Running the converge step here - on EVERY boot, before
// the server starts - makes such installs heal themselves the next time the
// POS is opened. It is a ~1s no-op when the schema is already in sync.
// Disable with SKIP_SCHEMA_HEAL=1 in .env (support escape hatch).
// ---------------------------------------------------------------------------
const skipHeal = ['1', 'true', 'yes', 'off'].includes(
  String(process.env.SKIP_SCHEMA_HEAL || '').toLowerCase(),
);
if (skipHeal) {
  console.info('[schema] Self-heal skipped (SKIP_SCHEMA_HEAL is set).');
} else {
  console.info('[schema] Checking the database schema matches this release ...');
  const heal = spawnSync(process.execPath, [join(root, 'scripts', 'ensure-schema.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (heal.status !== 0) {
    console.warn('');
    console.warn('[schema] WARNING: the database schema could NOT be converged automatically.');
    console.warn('         The POS will still start, but /api/health will report "Schema');
    console.warn('         drift" and some modules (notifications, debt, stock movements)');
    console.warn('         will error until the schema is fixed. Fix by running the');
    console.warn('         updater (Update-Mbumah-POS.bat) or, in this folder:');
    console.warn('           npm run db:push');
    console.warn('');
  }
}

const child = spawn(process.execPath, [server], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
