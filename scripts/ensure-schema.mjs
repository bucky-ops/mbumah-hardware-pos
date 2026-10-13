#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Database schema self-heal (all self-hosted paths)
// ============================================================================
// ROOT-CAUSE FIX for the offline P2022 incident (2026-10):
//   A laptop updated to v2.14.0 kept serving Prisma errors like
//   "The column `equipment_rentals.idempotencyKey` does not exist in the
//   current database" on /api/notifications, /api/debt, /api/reminders/debt/
//   overdue and /api/stock-movements. The v2.14.0 schema added five nullable
//   `idempotencyKey @unique` columns; on a NON-EMPTY existing database Prisma
//   classifies adding a unique constraint as a data-loss warning and REFUSES
//   `prisma db push` in non-interactive mode ("Use the --accept-data-loss
//   flag"). The installer/updater/docker-entrypoint all ran the bare push
//   with no fallback, so the schema silently stayed behind the code.
//   (Cloud/Vercel deploys were already covered by scripts/sync-db-schema.mjs;
//   this script gives the self-hosted paths the same converge guarantee.)
//
// WHAT IT DOES (idempotent - safe to run on every install/update/start):
//   1. Load <repo>/.env (env WINS over inherited - same precedence as
//      start-server.mjs, see its header) and run setup-prisma-provider.mjs
//      so the schema provider always matches DATABASE_URL.
//   2. `prisma db push --skip-generate` - succeeds and is a fast no-op when
//      the database is already in sync.
//   3. FALLBACK (only if step 2 failed): for SQLite databases take a quick
//      file backup first (pos.db -> pos.pre-heal-<ts>.db, newest 5 kept),
//      then `prisma db push --skip-generate --accept-data-loss` to converge.
//      For this project's drift (new nullable unique columns) that is safe;
//      the updater additionally takes a full pre-update backup and the
//      nightly backup runs at 02:30.
//   4. Exit 0 on converge, exit 1 with a loud message when even the fallback
//      cannot (wrong/missing database, duplicate values on a new unique
//      index, ...). Callers: installer/updater abort + roll back; the server
//      launcher boots anyway so /api/health reports the drift.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, copyFileSync, readdirSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// -- .env WINS over inherited environment (same rule as start-server.mjs) ----
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('[ensure-schema] x DATABASE_URL is not set and no .env was found.');
  console.error('               Run the installer first, or set DATABASE_URL explicitly.');
  process.exit(1);
}

// -- Resolve the Prisma CLI portably (no npx: works identically on Windows) --
function prismaCliPath() {
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve('prisma/package.json');
    const pkg = req(pkgJson);
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.prisma;
    if (bin) return join(dirname(pkgJson), bin);
  } catch { }
  return null;
}

function runPrisma(args) {
  const cli = prismaCliPath();
  const result = cli
    ? spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env, cwd: root })
    : spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', env: process.env, cwd: root, shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[ensure-schema] x failed to launch prisma: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

// -- SQLite safety backup before the --accept-data-loss fallback -------------
function backupSqlite(dbUrl) {
  // file:<path>[?params] -> absolute path of the database file
  let p = dbUrl.startsWith('file:') ? dbUrl.slice('file:'.length) : '';
  if (!p) return '';
  p = p.split('?')[0];
  const dbFile = resolvePath(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(root, p));
  if (!existsSync(dbFile)) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${dbFile}.pre-heal-${stamp}`;
  try {
    copyFileSync(dbFile, backup);
    for (const side of ['-wal', '-shm']) {
      if (existsSync(dbFile + side)) copyFileSync(dbFile + side, backup + side);
    }
    // Retention: keep the newest 5 pre-heal backups of this database file.
    const dir = dirname(dbFile);
    const base = `${dbFile}.pre-heal-`;
    const olds = readdirSync(dir)
      .filter((f) => f.startsWith(base) && statSync(join(dir, f)).isFile() && f.endsWith('.db'))
      .sort()
      .reverse()
      .slice(5);
    for (const f of olds) {
      try { unlinkSync(join(dir, f)); } catch { }
    }
    return backup;
  } catch (e) {
    console.warn(`[ensure-schema] ! could not take the pre-heal backup: ${e && e.message ? e.message : e}`);
    return '';
  }
}

// ============================================================================
console.log('[ensure-schema] Checking the database schema ...');

// Step 1 - the provider must match DATABASE_URL (idempotent, edits the schema
// text in place; committed schema is postgresql, laptop installs are sqlite).
const setup = spawnSync(process.execPath, [join(root, 'scripts', 'setup-prisma-provider.mjs')], {
  stdio: 'inherit', env: process.env, cwd: root,
});
if (setup.status !== 0) {
  console.error('[ensure-schema] x setup-prisma-provider failed - cannot continue safely.');
  process.exit(1);
}

// Step 2 - plain push: a fast no-op when already in sync.
if (runPrisma(['db', 'push', '--skip-generate'])) {
  console.log('[ensure-schema] OK database schema is in sync.');
  process.exit(0);
}

// Step 3 - refused (or failed): back up SQLite data, then converge with the
// data-loss acceptance. Adding nullable unique columns (this project's
// recurring additive migration style) is the known safe case.
console.warn('[ensure-schema] ! plain schema push failed (existing database + new');
console.warn('                unique indexes produce data-loss warnings - this is the');
console.warn('                known additive-drift case, see the header of this file).');
const isSqlite = process.env.DATABASE_URL.startsWith('file:');
let backupNote = 'no file backup (non-SQLite database - rely on the updater/nightly backups)';
if (isSqlite) {
  const backup = backupSqlite(process.env.DATABASE_URL);
  backupNote = backup ? `backup saved: ${backup}` : 'backup could not be created - continuing';
  console.log(`[ensure-schema] ${backup}`);
}

if (runPrisma(['db', 'push', '--skip-generate', '--accept-data-loss'])) {
  console.log('[ensure-schema] OK database schema converged (data preserved).');
  process.exit(0);
}

console.error('[ensure-schema] x database schema could NOT be converged.');
console.error('                Do not start the POS on this schema - queries will fail');
console.error('                with Prisma P2021/P2022 ("column does not exist").');
console.error('                Check DATABASE_URL and duplicate values on new unique');
console.error(`                columns. ${backupNote}`);
process.exit(1);
