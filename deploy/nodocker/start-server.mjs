#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - server launcher (no-Docker installs)
// Loads <repo>/.env into the environment, then starts the production server
// for the build mode this release was built with (v2.18.0.2):
//
//   1. STANDALONE (Docker images and Linux no-Docker installs, built with
//      BUILD_STANDALONE=1): runs .next/standalone/server.js directly. The
//      standalone server does not read .env by itself, which is why this
//      launcher exists.
//   2. NORMAL (Windows laptops, v2.18.0.2 policy: Windows never builds
//      standalone): runs `next start` from node_modules against the plain
//      .next output. node_modules is present on every laptop install, so
//      no standalone bundle is needed - and the Windows EINVAL trace-copy
//      failure class cannot occur at all.
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

const port = process.env.PORT;

// ---------------------------------------------------------------------------
// Build-mode detection (must match next.config.ts resolveStandaloneOutput).
// ---------------------------------------------------------------------------
const standaloneServer = join(root, '.next', 'standalone', 'server.js');
const nextCli = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

let startArgs = null;
let startLabel = '';
if (existsSync(standaloneServer)) {
  startArgs = [standaloneServer];
  startLabel = 'standalone server (.next/standalone/server.js)';
} else if (existsSync(join(root, '.next', 'BUILD_ID'))) {
  if (!existsSync(nextCli)) {
    console.error('✗ Build output present but the Next.js CLI is missing (node_modules incomplete).');
    console.error('  Run the installer or updater once with internet to reinstall dependencies.');
    process.exit(1);
  }
  startArgs = [nextCli, 'start', '-p', String(port), '-H', '0.0.0.0'];
  startLabel = 'Next.js production server (next start)';
} else {
  console.error('✗ Build output missing (.next/standalone/server.js and .next/BUILD_ID).');
  console.error('  Run the installer first, or run Update-Mbumah-POS.bat once with internet.');
  process.exit(1);
}

console.log('──────────────────────────────────────────────────');
console.log('  MBUMAH HARDWARE POS');
console.log(`  →  http://localhost:${port}   (keep this window open)`);
// console.info is in the lint-allowed set (warn, error, info).
console.info(`  Server mode: ${startLabel}`);
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

// ---------------------------------------------------------------------------
// v2.18.0.2: in `next start` mode the CLI process is a CHILD of this
// launcher. The updater stops this launcher with a process-tree kill
// (taskkill /T on Windows), which removes the child too - do not detach,
// or stopped-but-still-listening orphans would hold port 3000.
// ---------------------------------------------------------------------------
const child = spawn(process.execPath, startArgs, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
