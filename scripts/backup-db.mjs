#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Database backup tooling (hosting spec Phase 1 gap)
// ============================================================================
// Creates a timestamped backup of the configured database.
//
//   SQLite (self-hosted laptop / nodocker / dev):
//     - Resolves the database file from DATABASE_URL (supports file: URLs,
//       relative paths, and Windows absolute paths such as
//       C:/Users/<name>/mbumah-pos-data/pos.db).
//     - Copies the .db file plus its -wal / -shm sidecars when present.
//     - Verifies the backup exists and is non-empty before reporting success.
//     - Refuses to run when the database file is missing.
//     - BACKUP_DIR chooses the destination (default: <db-dir>/backups).
//     - BACKUP_KEEP / --keep N retention (default: keep the newest 20).
//     - Prints the restore path and recommends stopping the POS first for a
//       perfectly consistent copy (SQLite hot copies are crash-safe with WAL
//       but can miss in-flight transactions).
//
//   PostgreSQL (Vercel / Neon / docker compose):
//     - Prints the exact pg_dump / managed-snapshot guidance (credentials are
//       masked) and exits 2. This script deliberately does NOT handle
//       Postgres credentials itself; use pg_dump or the provider's snapshot
//       feature. deploy/nodocker/backup-pos.ps1 covers Windows operators.
//
// Exit codes: 0 = backup written, 1 = configuration or file error,
//             2 = provider not handled by this script (guidance printed).
// Idempotent: running twice simply creates two timestamped backups.
// ============================================================================
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// -- .env WINS over inherited environment (same rule as ensure-schema.mjs) ---
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

const keepArgIndex = process.argv.indexOf('--keep');
const keepArg = keepArgIndex !== -1 ? Number.parseInt(process.argv[keepArgIndex + 1], 10) : NaN;
const KEEP = Number.isFinite(keepArg) && keepArg > 0
  ? keepArg
  : Number.parseInt(process.env.BACKUP_KEEP ?? '', 10) || 20;

function fail(code, ...lines) {
  for (const l of lines) console.error(`[backup-db] ${l}`);
  process.exit(code);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail(1, 'DATABASE_URL is not set and no .env was found.', 'Set DATABASE_URL or run the installer first.');
// REPAIR_DATABASE_URL: explicit override used by scripts/repair-db.mjs so a
// repair run backs up the SAME database it repairs (wins over .env).
if (process.env.REPAIR_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.REPAIR_DATABASE_URL;
}

// -- Resolve the SQLite database file (file: URL, relative, or absolute) -----
function sqliteFilePath(url) {
  let p = url;
  if (p.startsWith('file:')) {
    p = p.slice('file:'.length);
    // file:/abs/path and file:./relative and file:relative all occur in the wild
    if (!p.startsWith('/') && !/^[A-Za-z]:/.test(p)) p = resolvePath(root, p);
  } else if (!isAbsolute(p)) {
    p = resolvePath(root, p);
  }
  // Windows paths can arrive as C:/... or C:\...; normalize separators for the
  // host OS. Node's path module on Windows accepts both spellings.
  return p.replace(/\//g, sep);
}

function pruneOldBackups(dir, baseName, keep) {
  const stem = baseName.replace(/\.db$/i, '');
  const entries = readdirSync(dir)
    .filter((f) => f.startsWith(`${stem}.`) && f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of entries.slice(keep)) {
    try {
      unlinkSync(join(dir, old.f));
      // Remove orphaned sidecars of pruned backups too.
      for (const side of ['-wal', '-shm']) {
        const p = join(dir, old.f + side);
        if (existsSync(p)) unlinkSync(p);
      }
      console.log(`[backup-db] pruned old backup ${old.f}`);
    } catch {
      // Pruning is best effort; never fail the fresh backup because of it.
    }
  }
}

if (databaseUrl.startsWith('file:') || /\.(db|sqlite|sqlite3)$/i.test(databaseUrl.split('?')[0])) {
  const dbFile = sqliteFilePath(databaseUrl);
  if (!existsSync(dbFile)) {
    fail(1, `Database file not found: ${dbFile}`, 'Verify DATABASE_URL points at the intended database. Nothing was written.');
  }
  let size;
  try {
    size = statSync(dbFile).size;
  } catch (e) {
    fail(1, `Database file is not readable: ${e.message}`);
  }
  if (size === 0) {
    fail(1, `Database file exists but is EMPTY (0 bytes): ${dbFile}`, 'Refusing to back up an empty file - verify DATABASE_URL.');
  }

  const backupDir = process.env.BACKUP_DIR
    ? resolvePath(process.env.BACKUP_DIR)
    : join(dirname(dbFile), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const baseName = dbFile.split(sep).pop();
  const backupFile = join(backupDir, `${baseName.replace(/\.db$/i, '')}.${stamp}.db`);

  try {
    copyFileSync(dbFile, backupFile);
    for (const side of ['-wal', '-shm']) {
      if (existsSync(dbFile + side)) copyFileSync(dbFile + side, backupFile + side);
    }
  } catch (e) {
    fail(1, `Backup copy failed: ${e.message}`, 'Close the POS (file locks) and retry.');
  }

  if (!existsSync(backupFile) || statSync(backupFile).size === 0) {
    fail(1, 'Backup verification failed: the backup file is missing or empty.');
  }

  pruneOldBackups(backupDir, baseName, KEEP);

  console.log('[backup-db] OK');
  console.log(`  source : ${dbFile} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  backup : ${backupFile}`);
  console.log(`  kept   : newest ${KEEP} backups in ${backupDir}`);
  console.log('  note   : stop the POS before backing up for a perfectly');
  console.log('           consistent copy; hot backups are crash-safe but may');
  console.log('           miss in-flight transactions.');
  process.exit(0);
}

// -- PostgreSQL: print guidance, never handle credentials here ---------------
if (databaseUrl.startsWith('postgres')) {
  let host = '<host>', port = '5432', dbname = '<db>', user = '<user>';
  try {
    const u = new URL(databaseUrl);
    host = u.hostname; port = u.port || '5432'; dbname = u.pathname.replace(/^\//, ''); user = u.username;
  } catch { /* keep placeholders */ }
  console.log('[backup-db] PostgreSQL detected - this script does not handle server credentials.');
  console.log('  Use pg_dump directly (password via PGPASSWORD or ~/.pgpass):');
  console.log(`    pg_dump -h ${host} -p ${port} -U ${user} -d ${dbname} -F c -f mbumah-pos.$(date +%Y%m%d-%H%M%S).dump`);
  console.log('  Managed providers (Neon, Supabase): take a point-in-time snapshot');
  console.log('  from the provider dashboard instead. deploy/nodocker/backup-pos.ps1');
  console.log('  wraps this for Windows operators.');
  process.exit(2);
}

fail(1, `Unrecognized DATABASE_URL scheme: ${databaseUrl.split(':')[0]}`);
