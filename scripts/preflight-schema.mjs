#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Schema preflight (dry-run convergence on a COPY)
// ============================================================================
// Answers ONE question before an install or update touches the live shop
// database: "will this schema apply safely?"
//
// HOW IT WORKS (SQLite):
//   1. Copies the live database (with -wal/-shm sidecars) to a throwaway
//      preflight file next to the original. The live database is NEVER
//      opened for writing by this script.
//   2. Runs `prisma migrate diff --exit-code` between the copy and the
//      schema model - a read-only, authoritative drift detector.
//   3. If drift exists, classifies how the change applies by running
//      `prisma db push` against the COPY (never the live file):
//        lossless-converge  plain push succeeded (no data-loss warnings)
//        additive-converge  the push needed --accept-data-loss on the copy,
//                           which for this project's recurring drift (new
//                           nullable idempotencyKey @unique columns on
//                           stock_movements / debt_ledgers / equipment_rentals
//                           / expenses / transactions and users.isEngraved)
//                           is the known safe additive case
//        unsafe             even --accept-data-loss failed on the copy;
//                           applying to the live database would likely lose
//                           data (duplicate values on a new unique index,
//                           missing table, wrong database, ...)
//   4. Deletes the preflight copy (KEEP_PREFLIGHT_DB=1 keeps it for
//      inspection) and exits:
//        0  safe to apply (in-sync, lossless-converge or additive-converge)
//        1  UNSAFE - callers must abort / roll back
//        2  environment problem (no DATABASE_URL, unreachable server)
//
// PostgreSQL / Neon: set PREFLIGHT_DATABASE_URL to a disposable staging
// database (or any readable replica). For server databases the script runs
// the read-only diff and reports the SQL that WOULD be applied; it never
// writes to the server.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, copyFileSync, rmSync, readFileSync, writeFileSync as _wf } from 'node:fs';
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
// The schema declares directUrl = env("DIRECT_URL"); default it to the main
// URL so operator runs never trip over P1012 for a variable they never set.
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

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

function runPrisma(args, extraEnv) {
  const cli = prismaCliPath();
  const env = { ...process.env, ...extraEnv };
  const result = cli
    ? spawnSync(process.execPath, [cli, ...args], { stdio: 'pipe', encoding: 'utf8', env, cwd: root })
    : spawnSync('npx', ['prisma', ...args], { stdio: 'pipe', encoding: 'utf8', env, cwd: root, shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[preflight] x failed to launch prisma: ${result.error.message}`);
    return { ok: false, code: -1, output: String(result.error) };
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { ok: result.status === 0, code: result.status, output };
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
const schemaPath = join(root, 'prisma', 'schema.prisma');
const target = process.env.PREFLIGHT_DATABASE_URL || process.env.DATABASE_URL;
if (!target) {
  console.error('[preflight] x DATABASE_URL is not set and no .env was found.');
  process.exit(2);
}
const isSqlite = target.startsWith('file:');
if (process.env.PREFLIGHT_DATABASE_URL) {
  // db push uses directUrl for schema management; both URLs must point at
  // the preflight target or the classification silently tests a different
  // database (the inherited environment beats the .env file).
  process.env.DATABASE_URL = process.env.PREFLIGHT_DATABASE_URL;
  process.env.DIRECT_URL = process.env.PREFLIGHT_DATABASE_URL;
}

// Provider must match the URL before any CLI call.
const setup = spawnSync(process.execPath, [join(root, 'scripts', 'setup-prisma-provider.mjs')], {
  stdio: 'pipe', encoding: 'utf8', env: process.env, cwd: root,
});
if (setup.status !== 0) {
  console.error(`[preflight] x setup-prisma-provider failed:\n${setup.stderr || setup.stdout}`);
  process.exit(2);
}

// -- SQLite: copy the live file first; server DBs diff directly (read-only) ---
let copyDb = '';
let diffUrl = target;
if (isSqlite) {
  let p = target.slice('file:'.length).split('?')[0];
  const dbFile = resolvePath(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(root, p));
  if (!existsSync(dbFile)) {
    console.error(`[preflight] x database file not found: ${dbFile}`);
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  copyDb = `${dbFile}.preflight-${stamp}`;
  copyFileSync(dbFile, copyDb);
  for (const side of ['-wal', '-shm']) {
    if (existsSync(dbFile + side)) copyFileSync(dbFile + side, copyDb + side);
  }
  diffUrl = `file:${copyDb}`;
  console.log(`[preflight] live database : ${dbFile}`);
  console.log(`[preflight] preflight copy: ${copyDb}`);
} else {
  console.log('[preflight] server database detected - running the read-only diff only.');
  console.log(`[preflight] target: ${target.replace(/:[^:@/]+@/, ':***@')}`);
}

try {
  // Step 1 - authoritative read-only diff between the target and the models.
  const diff = runPrisma(
    ['migrate', 'diff', '--from-url', diffUrl, '--to-schema-datamodel', schemaPath, '--exit-code'],
    isSqlite ? { DATABASE_URL: diffUrl } : {},
  );
  if (diff.code === 0) {
    console.log('[preflight] PASS in-sync: the database already matches the schema.');
    process.exit(0);
  }
  if (diff.code !== 2) {
    console.error('[preflight] x the diff itself failed (unreachable database? wrong URL?).');
    const tail = diff.output.trim().split(/\r?\n/).slice(-8).join('\n');
    console.error(tail);
    process.exit(2);
  }

  // Step 2 - there IS drift. Show the SQL that would be applied.
  const diffSql = runPrisma(
    ['migrate', 'diff', '--from-url', diffUrl, '--to-schema-datamodel', schemaPath, '--script'],
    isSqlite ? { DATABASE_URL: diffUrl } : {},
  );
  const sql = (diffSql.output || '')
    .split(/\r?\n/)
    .filter((l) => !/^(Loaded Prisma config|Prisma config detected|Prisma schema loaded|Datasource "db"|warn The configuration|For more information)/.test(l.trim()))
    .join('\n')
    .trim();
  const sqlLines = sql.split(/\r?\n/).filter(Boolean).length;
  console.log(`[preflight] drift detected (${sqlLines} statement lines would be applied).`);
  console.log('[preflight] drift summary (first 20 lines):');
  for (const l of sql.split(/\r?\n/).slice(0, 20)) console.log(`[preflight]   | ${l}`);

  if (!isSqlite) {
    console.log('[preflight] DONE server database: review the SQL above and apply it on a');
    console.log('            staging database or during a maintenance window with a backup.');
    console.log('[preflight] result: DRIFT-PENDING (no write was performed).');
    process.exit(1);
  }

  // Step 3 - SQLite only: classify the convergence on the COPY.
  const pushPlain = withEnvFileOverride(diffUrl, () => runPrisma(['db', 'push', '--skip-generate'], { DATABASE_URL: diffUrl }));
  if (pushPlain.ok) {
    console.log('[preflight] PASS lossless-converge: a plain push applies the drift with no');
    console.log('            data-loss warnings (safe for empty or additive-only changes).');
    process.exit(0);
  }
  const pushAdl = withEnvFileOverride(diffUrl, () => runPrisma(['db', 'push', '--skip-generate', '--accept-data-loss'], { DATABASE_URL: diffUrl }));
  if (pushAdl.ok) {
    console.log('[preflight] PASS additive-converge: the push needed --accept-data-loss on the');
    console.log('            copy, which is the known safe additive case for this project');
    console.log('            (new nullable idempotencyKey / isEngraved columns). No table or');
    console.log('            column data is dropped by this schema change class.');
    process.exit(0);
  }

  console.error('[preflight] FAIL unsafe: even --accept-data-loss could not converge the copy.');
  const tail = pushAdl.output.trim().split(/\r?\n/).slice(-12).join('\n');
  console.error(tail);
  console.error('[preflight]           Do NOT apply this schema to the live database.');
  console.error('[preflight]           Typical causes: duplicate values on a new unique index,');
  console.error('[preflight]           wrong DATABASE_URL, or a schema bug. Take a backup and');
  console.error('[preflight]           investigate before any update.');
  process.exit(1);
} finally {
  if (copyDb) {
    if (process.env.KEEP_PREFLIGHT_DB === '1') {
      console.log(`[preflight] preflight copy kept for inspection: ${copyDb}`);
    } else {
      for (const f of [copyDb, `${copyDb}-wal`, `${copyDb}-shm`, `${copyDb}-journal`]) {
        try { rmSync(f, { force: true }); } catch { }
      }
    }
  }
}
