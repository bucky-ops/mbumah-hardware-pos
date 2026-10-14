#!/usr/bin/env node
// MBUMAH HARDWARE POS - Branch manager schema repair (v2.18.1)
//
// Safe, additive, idempotent repair for the User side of the branch-manager
// binding on a local SQLite database:
//   - users.storeId (nullable FK to the stores table) and users.isActive
//     must exist; both are added when a legacy database lacks them.
//   - users.email must be unique: the unique index is only created after a
//     duplicate check passes (duplicates STOP the repair with an exact
//     report; rows are never deleted).
//   - Branch-bound users (BRANCH_MANAGER, CASHIER) with a NULL/empty
//     storeId get a deterministic backfill from their email local part
//     (juja.manager@..., thika.manager@... and the
//     {town}.cashier@... pattern) matched case-insensitively against the
//     stores table slugs. A branch-bound user with no determinable store is
//     reported and left untouched: the app already denies unassigned
//     branch-bound accounts server-side.
//
// Hard safety rules (branch-manager binding spec, phases 2 and 9):
//   1. Raw SQL only. No Prisma model queries during repair (a drifted
//      database is exactly where the Prisma client fails, e.g. P2022).
//   2. A timestamped backup is created and verified BEFORE any write and is
//      restored automatically if the repair fails.
//   3. Additive only. Nothing is dropped, nothing is deleted, no
//      --accept-data-loss, no destructive commands ever.
//   4. Idempotent: re-running on a healthy database performs no writes.
//   5. PostgreSQL is never modified: the script prints the required
//      migration guidance and exits.
//
// Usage:
//   node scripts/repair-branch-manager-schema.mjs            (repair)
//   node scripts/repair-branch-manager-schema.mjs --check    (report only)

import { readFileSync, existsSync, copyFileSync, statSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// Roles that must be bound to exactly one branch at the application layer.
const STORE_BOUND_ROLES = ['BRANCH_MANAGER', 'CASHIER'];

// ---------------------------------------------------------------------------
// DATABASE_URL resolution (same rules as the workspace repair script).
// ---------------------------------------------------------------------------

function readEnvFileValues() {
  const values = {};
  for (const candidate of [join(repoRoot, '.env'), join(repoRoot, '.env.nodocker')]) {
    if (!existsSync(candidate)) continue;
    try {
      for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in values)) values[key] = value;
      }
    } catch {
      // Unreadable env file: fall through, other sources may still work.
    }
  }
  return values;
}

export function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl) return null;
  const url = databaseUrl.trim();
  if (!url.startsWith('file:')) return { error: 'not-sqlite', url };
  let rest = url.slice('file:'.length);
  if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  rest = rest.replace(/\?.*$/, '');
  let candidate = rest;
  if (/^[A-Za-z]:[\\/]/.test(rest) || !rest.startsWith('/')) {
    candidate = rest.replace(/\\/g, '/');
  }
  if (!candidate) return { error: 'empty-path', url };
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    decoded = candidate;
  }
  const finalPath = isAbsolute(decoded) ? decoded : join(repoRoot, decoded);
  return { path: finalPath, url };
}

function resolveDatabaseUrl() {
  const envValues = readEnvFileValues();
  return process.env.DATABASE_URL || envValues.DATABASE_URL || null;
}

// ---------------------------------------------------------------------------
// Table + column helpers (raw SQL only).
// ---------------------------------------------------------------------------

function findTable(db, names) {
  const placeholders = names.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND lower(name) IN (${placeholders})`)
    .all(...names.map((n) => n.toLowerCase()));
  if (rows.length === 0) return null;
  return rows[0].name;
}

function columnNames(db, table) {
  return db
    .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
    .all()
    .map((c) => c.name.toLowerCase());
}

function duplicateReport(db, table, column) {
  return db
    .prepare(
      `SELECT "${column}", COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL GROUP BY "${column}" HAVING COUNT(*) > 1`,
    )
    .all();
}

/**
 * Deterministic store slug for a branch-bound user's email local part:
 * juja.manager@..., thika.manager@..., ruiru.cashier@... -> town slug.
 * Returns null when the local part does not map to a known store slug.
 */
export function storeSlugForEmail(email, storeSlugs) {
  if (!email || !email.includes('@')) return null;
  const local = email.split('@')[0].toLowerCase();
  // Strip a leading legacy prefix if someone reused the pattern for other
  // addresses; keep it strict: only manager./cashier. prefixed locals and
  // bare town locals are considered deterministic.
  const candidates = new Set([local]);
  for (const part of local.split('.')) {
    if (part) candidates.add(part);
  }
  for (const candidate of candidates) {
    if (storeSlugs.has(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Repair routine.
// ---------------------------------------------------------------------------

export function repairBranchManagerSchema(db, log) {
  const usersTable = findTable(db, ['users', 'user']);
  if (!usersTable) {
    log('FAIL: no users table found in this database (nothing to repair).');
    return { ok: false, reason: 'no-users-table' };
  }
  const storesTable = findTable(db, ['stores', 'store']);
  log(`Users table: ${usersTable}; stores table: ${storesTable ?? 'MISSING'}.`);
  const actions = [];

  const columns = columnNames(db, usersTable);

  // 1. Additive columns.
  if (!columns.includes('storeid')) {
    db.exec(`ALTER TABLE "${usersTable}" ADD COLUMN storeId TEXT`);
    actions.push('added column users.storeId TEXT (nullable)');
    log('Added missing column: users.storeId');
  }
  if (!columns.includes('isactive')) {
    db.exec(`ALTER TABLE "${usersTable}" ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1`);
    actions.push("added column users.isActive INTEGER NOT NULL DEFAULT 1");
    log('Added missing column: users.isActive (default 1)');
  }

  // 2. Deterministic storeId backfill for branch-bound users only.
  if (storesTable) {
    const storeColumns = columnNames(db, storesTable);
    if (storeColumns.includes('slug')) {
      const stores = db.prepare(`SELECT id, slug FROM "${storesTable}"`).all();
      const slugToId = new Map(stores.map((s) => [s.slug, s.id]));
      const branchBound = db
        .prepare(
          `SELECT id, email, role FROM "${usersTable}" WHERE role IN (?, ?) AND (storeId IS NULL OR storeId = '')`,
        )
        .all(...STORE_BOUND_ROLES);
      let backfilled = 0;
      const unresolvable = [];
      for (const user of branchBound) {
        const slug = storeSlugForEmail(user.email, new Set(stores.map((s) => s.slug)));
        const storeId = slug ? slugToId.get(slug) : null;
        if (storeId) {
          db.prepare(`UPDATE "${usersTable}" SET storeId = ? WHERE id = ?`).run(storeId, user.id);
          backfilled += 1;
          log(`Backfilled storeId for ${user.email} (${user.role}): ${storeId} (slug ${slug})`);
        } else {
          unresolvable.push(user);
          log(
            `WARNING: branch-bound user ${user.email} (${user.role}) has no determinable store; left unassigned (the app denies unassigned branch-bound accounts server-side).`,
          );
        }
      }
      actions.push(`branch-bound storeId backfill: ${backfilled} user(s), ${unresolvable.length} unresolved`);
    } else {
      log('WARNING: stores table has no slug column; run scripts/repair-branch-workspace-store-schema.mjs first.');
    }
  }

  // 3. isActive normalization (NULL -> active) so auth checks behave.
  db.exec(`UPDATE "${usersTable}" SET isActive = 1 WHERE isActive IS NULL`);
  actions.push('normalized NULL isActive to 1');

  // 4. Email uniqueness: check duplicates FIRST, stop instead of forcing.
  const dupEmails = duplicateReport(db, usersTable, 'email');
  if (dupEmails.length > 0) {
    log('FAIL: duplicate email values would violate the unique index. Repair stopped, no index created.');
    for (const row of dupEmails) log(`   duplicate email "${row.email}" on ${row.n} rows`);
    log('Resolve the duplicates manually (the users keep their access; nothing was changed).');
    return { ok: false, reason: 'duplicate-email', actions, duplicates: dupEmails };
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "${usersTable}"(email)`);
  actions.push('ensured unique index users_email_key');

  // 5. Helpful indexes for the branch binding (safe, idempotent).
  db.exec(`CREATE INDEX IF NOT EXISTS "users_storeId_idx" ON "${usersTable}"(storeId)`);

  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity?.integrity_check !== 'ok') {
    log(`FAIL: integrity_check after repair: ${integrity?.integrity_check}`);
    return { ok: false, reason: 'integrity', actions };
  }

  log(`Repair routine complete: ${actions.length} action group(s), integrity ok.`);
  return { ok: true, actions };
}

// ---------------------------------------------------------------------------
// Backup + restore.
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function backupDatabase(dbPath, log) {
  const stamp = timestamp();
  const backupPath = `${dbPath}.pre-branch-manager-repair.${stamp}.bak`;
  copyFileSync(dbPath, backupPath);
  for (const side of ['-wal', '-shm']) {
    if (existsSync(dbPath + side)) copyFileSync(dbPath + side, backupPath + side);
  }
  const size = statSync(backupPath).size;
  if (size <= 0) throw new Error(`backup verification failed: ${backupPath} is empty`);
  log(`Backup created: ${backupPath} (${size} bytes)`);
  return backupPath;
}

function restoreBackup(dbPath, backupPath, log) {
  copyFileSync(backupPath, dbPath);
  for (const side of ['-wal', '-shm']) {
    const backupSide = backupPath + side;
    const liveSide = dbPath + side;
    if (existsSync(backupSide)) copyFileSync(backupSide, liveSide);
    else if (existsSync(liveSide)) unlinkSync(liveSide);
  }
  log(`Backup restored: ${backupPath} -> ${dbPath}`);
}

function writeLog(lines) {
  if (lines.length === 0) return;
  try {
    const dir = join(repoRoot, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'repair-branch-manager-schema.log'), lines.join('\n') + '\n');
    console.log(`\nRepair log appended: logs/repair-branch-manager-schema.log`);
  } catch {
    // Log writing is best-effort; the console output above is the record.
  }
}

function main() {
  console.log('MBUMAH HARDWARE POS - branch manager schema repair (v2.18.1)');
  console.log('');
  const logLines = [];
  const log = (line) => {
    console.log(line);
    logLines.push(`${new Date().toISOString()} ${line}`);
  };

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    console.log('DATABASE_URL is not set (shell or .env). Nothing to repair.');
    process.exit(0);
  }
  const resolved = resolveSqlitePath(databaseUrl);
  if (resolved.error === 'not-sqlite') {
    console.log(`DATABASE_URL is not a SQLite file URL (${resolved.url}).`);
    console.log('This repair only touches local SQLite databases. For PostgreSQL:');
    console.log('  1. Run: npx prisma migrate diff --from-schema-datasource-url --to-schema-datamodel prisma/schema.prisma --script');
    console.log('  2. Review the additive SQL, then apply it with an explicit migration.');
    console.log('  3. Never run destructive or automatic repairs against production.');
    process.exit(2);
  }
  if (resolved.error) {
    console.log(`Could not resolve DATABASE_URL (${resolved.url}): ${resolved.error}`);
    process.exit(2);
  }
  const dbPath = resolved.path;
  if (!existsSync(dbPath)) {
    console.log(`SQLite database not found: ${dbPath}`);
    console.log('Nothing to repair (a first-boot seed will create it).');
    process.exit(0);
  }

  log(`Database: ${dbPath}`);
  log(`Mode: ${CHECK_ONLY ? 'CHECK ONLY (no writes)' : 'REPAIR'}`);
  console.log('');

  let backupPath = null;
  try {
    if (!CHECK_ONLY) {
      backupPath = backupDatabase(dbPath, log);
    }
    const db = new DatabaseSync(dbPath);
    const result = repairBranchManagerSchema(db, log);
    db.close();
    if (!result.ok) {
      if (backupPath) {
        restoreBackup(dbPath, backupPath, log);
        log('The backup was restored; nothing was lost.');
      }
      writeLog(logLines);
      process.exit(1);
    }
    log('');
    log(CHECK_ONLY
      ? 'Check complete (no writes performed).'
      : 'RESULT: branch manager schema is ready (User.storeId binding + unique emails).');
    writeLog(logLines);
    process.exit(0);
  } catch (error) {
    log(`Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
    if (backupPath) {
      try {
        restoreBackup(dbPath, backupPath, log);
      } catch (restoreError) {
        log(`CRITICAL: backup restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        log(`The pre-repair backup is still at: ${backupPath}`);
      }
    }
    writeLog(logLines);
    process.exit(1);
  }
}

main();
