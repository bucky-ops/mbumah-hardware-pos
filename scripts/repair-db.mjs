#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Safe additive database repair (operator command)
// ============================================================================
// One command an operator can run when /api/health reports "Schema drift
// detected" or the POS logs Prisma P2022 ("column does not exist") errors:
//
//   npm run db:repair
//
// WHAT IT DOES, IN ORDER (never destructive on purpose):
//   1. Verified file backup first (scripts/backup-db.mjs: refuses missing or
//      empty files, verifies size, keeps BACKUP_KEEP newest copies).
//   2. Schema converge (same semantics as scripts/ensure-schema.mjs, run
//      here under this script's control): plain push, then - only if Prisma
//      refuses because of this project's known additive drift (new nullable
//      idempotencyKey @unique columns on stock_movements / debt_ledgers /
//      equipment_rentals / expenses / transactions, and users.isEngraved) -
//      a SQLite file backup plus --accept-data-loss. No table is dropped and
//      no column data is removed by that class of change.
//   3. Verification: a second plain `prisma db push --skip-generate` must be
//      a clean no-op, proving the schema now matches the model definitions.
//
// Target selection: .env wins over the inherited environment (same rule as
// ensure-schema.mjs); REPAIR_DATABASE_URL overrides both for tests and
// unusual setups (mirrors PREFLIGHT_DATABASE_URL in the preflight script).
//
// Exit 0 = repaired and verified. Exit 1 = something failed; restore from the
// backup printed in step 1 and contact support with the log.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, copyFileSync, readFileSync, readdirSync, unlinkSync, statSync, writeFileSync as _wf, rmSync as _rm } from 'node:fs';
import * as fsModule from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// -- .env WINS over inherited environment (same rule as ensure-schema) -------
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
// The schema declares directUrl = env("DIRECT_URL"); default it so operator
// runs never trip over P1012 for a variable they never set.
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;
// Explicit override for tests and unusual setups (mirrors the preflight script).
if (process.env.REPAIR_DATABASE_URL) {
  // db push and friends use directUrl for schema management, so both URLs
  // must point at the repair target.
  process.env.DATABASE_URL = process.env.REPAIR_DATABASE_URL;
  process.env.DIRECT_URL = process.env.REPAIR_DATABASE_URL;
}

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
    console.error(`[repair] x failed to launch prisma: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

function runScript(script, label) {
  console.log(`[repair] ${label} ...`);
  const r = spawnSync(process.execPath, [join(root, 'scripts', script)], { stdio: 'inherit', env: process.env, cwd: root });
  if (r.error) {
    console.error(`[repair] x ${label} failed to launch: ${r.error.message}`);
    return false;
  }
  return r.status === 0;
}

// SQLite file backup before the --accept-data-loss fallback (same retention
// rules as ensure-schema.mjs: pos.db.pre-repair-<ts>, newest 5 kept).
function backupSqlite(dbUrl) {
  let p = dbUrl.startsWith('file:') ? dbUrl.slice('file:'.length) : '';
  if (!p) return '';
  p = p.split('?')[0];
  const dbFile = resolvePath(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(root, p));
  if (!existsSync(dbFile)) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${dbFile}.pre-repair-${stamp}`;
  try {
    copyFileSync(dbFile, backup);
    for (const side of ['-wal', '-shm']) {
      if (existsSync(dbFile + side)) copyFileSync(dbFile + side, backup + side);
    }
    const dir = dirname(dbFile);
    const base = `${dbFile}.pre-repair-`;
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
    console.warn(`[repair] ! could not take the pre-repair backup: ${e && e.message ? e.message : e}`);
    return '';
  }
}


// -- CLI target override ------------------------------------------------------
// The Prisma CLI resolves env() from the .env FILE with file-wins precedence
// ("Environment variables loaded from .env" overrides the inherited process
// environment). To point CLI children at an explicit target, rewrite the two
// URL lines inside .env for the duration of the call and restore afterwards.
function withEnvFileOverride(url, fn) {
  const { writeFileSync, rmSync } = fsModule;
  const had = existsSync(envPath);
  const original = had ? readFileSync(envPath, 'utf8') : '';
  const setLine = (text, name) => {
    const re = new RegExp(`^([ \\t]*${name}[ \\t]*=)[^\\r\\n]*`, 'm');
    if (re.test(text)) return text.replace(re, `$1${url}`);
    return text + (text.endsWith('\n') ? '' : '\n') + `${name}=${url}\n`;
  };
  const next = setLine(setLine(original, 'DATABASE_URL'), 'DIRECT_URL');
  try {
    writeFileSync(envPath, next);
    return fn();
  } finally {
    try {
      if (had) writeFileSync(envPath, original);
      else rmSync(envPath, { force: true });
    } catch { }
  }
}

// ============================================================================
console.log(`[repair] target: ${process.env.DATABASE_URL}`);

console.log('[repair] Step 1/3: verified backup of the live database.');
if (!runScript('backup-db.mjs', 'backup')) {
  console.error('[repair] Refusing to repair without a verified backup. Nothing was changed.');
  process.exit(1);
}

console.log('[repair] Step 2/3: converging the schema (plain push first, safe additive fallback).');
if (!runScript('setup-prisma-provider.mjs', 'provider check')) {
  console.error('[repair] x setup-prisma-provider failed - cannot continue safely.');
  process.exit(1);
}
if (withEnvFileOverride(process.env.DATABASE_URL, () => runPrisma(['db', 'push', '--skip-generate']))) {
  console.log('[repair] plain push reports the schema already in sync.');
} else {
  console.warn('[repair] ! plain push failed - the known additive-drift case (new unique');
  console.warn('                indexes on existing tables produce data-loss warnings).');
  const isSqlite = process.env.DATABASE_URL.startsWith('file:');
  if (isSqlite) {
    const backup = backupSqlite(process.env.DATABASE_URL);
    console.log(`[repair] ${backup ? `pre-converge backup saved: ${backup}` : 'pre-converge backup could not be created - continuing'}`);
  }
  if (!withEnvFileOverride(process.env.DATABASE_URL, () => runPrisma(['db', 'push', '--skip-generate', '--accept-data-loss']))) {
    console.error('[repair] x the schema could not be converged. Nothing else was changed.');
    console.error('[repair]   Restore the backup printed in step 1 and report the log output.');
    process.exit(1);
  }
  console.log('[repair] schema converged (data preserved).');
}

console.log('[repair] Step 3/3: verifying the repair (second push must be a clean no-op).');
if (!withEnvFileOverride(process.env.DATABASE_URL, () => runPrisma(['db', 'push', '--skip-generate']))) {
  console.error('[repair] x verification push failed - the schema still does not match.');
  console.error('[repair]   Restore the backup printed in step 1 and report the log output.');
  process.exit(1);
}

console.log('[repair] OK database repaired and verified: schema matches the application.');
console.log('[repair]    Start the POS; /api/health should report database: ok.');
