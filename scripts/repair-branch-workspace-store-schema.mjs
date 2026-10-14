#!/usr/bin/env node
// MBUMAH HARDWARE POS - Branch workspace store schema repair (v2.18.0.3)
//
// Safe, additive, idempotent repair for the Store workspace columns that
// branch workspaces depend on:
//   - slug        (path mode:      /stores/{slug}/dashboard)
//   - subdomain   (subdomain mode: {subdomain}.{NEXT_PUBLIC_ROOT_DOMAIN})
//   - status      (ACTIVE stores only; the Prisma model column, the spec's
//                  "isActive" concept in this schema)
//
// Hard safety rules (branch workspace correction spec, phase 3):
//   1. Raw SQL only. No Prisma model queries during repair (a drifted local
//      database is exactly the situation where the Prisma client itself
//      fails, e.g. P2022).
//   2. A timestamped backup is created and verified BEFORE any write, and is
//      restored automatically if the repair fails.
//   3. Additive only: missing columns are added, values are backfilled.
//      Nothing is dropped, nothing is deleted, no --accept-data-loss.
//   4. Duplicate slug/subdomain values STOP the repair with an exact report
//      instead of forcing a unique index.
//   5. The repair is first rehearsed on a scratch copy of the database; the
//      live database is only touched after the scratch rehearsal succeeds.
//   6. PostgreSQL databases are never modified: the script prints the schema
//      drift it detects and exits, requiring an explicit migration instead.
//   7. Idempotent: re-running on a healthy database performs no writes.
//
// Usage:
//   node scripts/repair-branch-workspace-store-schema.mjs            (repair)
//   node scripts/repair-branch-workspace-store-schema.mjs --check    (report only)

import { readFileSync, existsSync, copyFileSync, statSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// DATABASE_URL resolution (repo .env file wins over the inherited shell value
// only when the shell value is unset; matches the launcher precedence).
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

/**
 * Resolve a SQLite database file path from DATABASE_URL.
 * Supports Windows absolute paths in every URL shape:
 *   file:///C:/Users/kamam/mbumah-pos-data/pos.db
 *   file:C:/Users/kamam/mbumah-pos-data/pos.db
 *   file:C:\Users\kamam\mbumah-pos-data\pos.db
 *   file:/home/z/mbumah-ver/prisma/prisma/dev.db
 */
export function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl) return null;
  const url = databaseUrl.trim();
  if (!url.startsWith('file:')) return { error: 'not-sqlite', url };
  let rest = url.slice('file:'.length);
  // file:///C:/... -> strip the authority slash run, keep the windows drive.
  if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  rest = rest.replace(/\?.*$/, ''); // drop ?connection_limit=... style params
  let candidate = rest;
  if (/^[A-Za-z]:[\\/]/.test(rest) || !rest.startsWith('/')) {
    // Windows drive path (forward or back slashes): normalize separators.
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
// Deterministic slug mapping (case-insensitive, tolerant of the
// "MBUMAH HARDWARE - " display prefix; spec phase 3).
// ---------------------------------------------------------------------------

const SLUG_PATTERNS = [
  { pattern: /nairobi\s*cbd/i, slug: 'nairobi-cbd' },
  { pattern: /juja\s*main|^\s*juja\b/i, slug: 'juja-main' },
  { pattern: /nakuru/i, slug: 'nakuru' },
  { pattern: /ruiru/i, slug: 'ruiru' },
  { pattern: /thika/i, slug: 'thika' },
];

export function slugForStoreName(name) {
  if (!name) return null;
  for (const { pattern, slug } of SLUG_PATTERNS) {
    if (pattern.test(name)) return slug;
  }
  // Generic fallback: strip the display prefix, slugify the rest.
  const stripped = name.replace(/^mbumah\s*hardware\s*-\s*/i, '');
  const slugified = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugified || null;
}

// ---------------------------------------------------------------------------
// Repair routine (raw SQL only).
// ---------------------------------------------------------------------------

function findStoreTable(db) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) IN ('stores','store')",
  ).all();
  if (rows.length === 0) return null;
  // Prefer the plural Prisma mapping used by this schema (@@map("stores")).
  return rows.find((r) => r.name.toLowerCase() === 'stores')?.name ?? rows[0].name;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
}

export function preflightStoreColumns(db) {
  const table = findStoreTable(db);
  if (!table) return { found: false };
  const columns = tableColumns(db, table).map((c) => ({ name: c.name, notnull: !!c.notnull, dflt: c.dflt_value }));
  const has = (name) => columns.some((c) => c.name.toLowerCase() === name);
  return {
    found: true,
    table,
    columns,
    missing: {
      slug: !has('slug'),
      subdomain: !has('subdomain'),
      status: !has('status'),
    },
  };
}

function duplicateReport(db, table, column) {
  return db
    .prepare(
      `SELECT "${column}", COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" <> '' GROUP BY "${column}" HAVING COUNT(*) > 1`,
    )
    .all();
}

export function repairStoreWorkspaceColumns(db, log) {
  const pre = preflightStoreColumns(db);
  if (!pre.found) {
    log('FAIL: no stores table found in this database (nothing to repair).');
    return { ok: false, reason: 'no-store-table' };
  }
  log(`Store table: ${pre.table} (${pre.columns.length} columns).`);
  const actions = [];

  // 1. Additive columns. SQLite cannot add NOT NULL without a default and
  //    cannot add UNIQUE at all, so nullable-first + backfill + index.
  if (pre.missing.slug) {
    db.exec(`ALTER TABLE "${pre.table}" ADD COLUMN slug TEXT`);
    actions.push('added column slug TEXT (nullable)');
    log('Added missing column: slug');
  }
  if (pre.missing.subdomain) {
    db.exec(`ALTER TABLE "${pre.table}" ADD COLUMN subdomain TEXT`);
    actions.push('added column subdomain TEXT (nullable)');
    log('Added missing column: subdomain');
  }
  if (pre.missing.status) {
    db.exec(`ALTER TABLE "${pre.table}" ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`);
    actions.push("added column status TEXT NOT NULL DEFAULT 'ACTIVE'");
    log("Added missing column: status (default 'ACTIVE')");
  }

  // 2. Backfill slug from the deterministic name mapping (only where empty).
  const nameCol = pre.columns.some((c) => c.name === 'name') ? 'name' : null;
  if (!nameCol) {
    log('FAIL: stores table has no name column; cannot backfill slugs safely.');
    return { ok: false, reason: 'no-name-column', actions };
  }
  const stores = db.prepare(`SELECT id, name, slug, subdomain, status FROM "${pre.table}"`).all();
  let slugBackfilled = 0;
  let subBackfilled = 0;
  let statusBackfilled = 0;
  const unresolved = [];
  for (const store of stores) {
    if (store.slug === null || store.slug === '') {
      const slug = slugForStoreName(store.name);
      if (!slug) {
        unresolved.push(store.id);
        continue;
      }
      db.prepare(`UPDATE "${pre.table}" SET slug = ? WHERE id = ?`).run(slug, store.id);
      slugBackfilled += 1;
      log(`Backfilled slug for "${store.name}" (id=${store.id}): ${slug}`);
    }
    if (store.subdomain === null || store.subdomain === '') {
      const current = db.prepare(`SELECT slug FROM "${pre.table}" WHERE id = ?`).get(store.id);
      if (current?.slug) {
        db.prepare(`UPDATE "${pre.table}" SET subdomain = ? WHERE id = ?`).run(current.slug, store.id);
        subBackfilled += 1;
        log(`Backfilled subdomain from slug for id=${store.id}: ${current.slug}`);
      }
    }
    if (store.status === null || store.status === undefined || store.status === '') {
      db.prepare(`UPDATE "${pre.table}" SET status = 'ACTIVE' WHERE id = ?`).run(store.id);
      statusBackfilled += 1;
      log(`Backfilled status ACTIVE for id=${store.id}`);
    }
  }
  actions.push(`slug backfill: ${slugBackfilled}, subdomain backfill: ${subBackfilled}, status backfill: ${statusBackfilled}`);

  // 3. Duplicate checks BEFORE unique indexes: stop, never delete rows.
  const dupSlugs = duplicateReport(db, pre.table, 'slug');
  const dupSubs = duplicateReport(db, pre.table, 'subdomain');
  if (dupSlugs.length > 0) {
    log('FAIL: duplicate slug values would violate the unique index. Repair stopped, no index created.');
    for (const row of dupSlugs) log(`   duplicate slug "${row.slug}" on ${row.n} rows`);
    return { ok: false, reason: 'duplicate-slug', actions, duplicates: dupSlugs, unresolved };
  }
  if (dupSubs.length > 0) {
    log('FAIL: duplicate subdomain values would violate the unique index. Repair stopped, no index created.');
    for (const row of dupSubs) log(`   duplicate subdomain "${row.subdomain}" on ${row.n} rows`);
    return { ok: false, reason: 'duplicate-subdomain', actions, duplicates: dupSubs, unresolved };
  }

  // 4. Unique indexes (safe now: no duplicates).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "stores_slug_key" ON "${pre.table}"(slug)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "stores_subdomain_key" ON "${pre.table}"(subdomain)`);
  actions.push('ensured unique indexes stores_slug_key + stores_subdomain_key');

  // 5. Still unresolved (no deterministic mapping): report exactly, succeed
  //    only if the database now satisfies the workspace requirements.
  const remaining = db
    .prepare(`SELECT id, name FROM "${pre.table}" WHERE slug IS NULL OR slug = ''`)
    .all();
  for (const row of remaining) {
    log(`WARNING: store id=${row.id} ("${row.name}") still has no slug; its workspace stays unavailable until the slug is configured.`);
  }

  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity?.integrity_check !== 'ok') {
    log(`FAIL: integrity_check after repair: ${integrity?.integrity_check}`);
    return { ok: false, reason: 'integrity', actions, unresolved };
  }

  log(`Repair routine complete: ${actions.length} action group(s), integrity ok.`);
  return { ok: true, actions, unresolved: remaining.map((r) => r.id) };
}

// ---------------------------------------------------------------------------
// Backup + restore helpers.
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function backupDatabase(dbPath, log) {
  const stamp = timestamp();
  const backupPath = `${dbPath}.pre-workspace-repair.${stamp}.bak`;
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

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  console.log('MBUMAH HARDWARE POS - branch workspace store schema repair (v2.18.0.3)');
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

  // Preflight on the live database (read-only operations only).
  const liveDb = new DatabaseSync(dbPath);
  const pre = preflightStoreColumns(liveDb);
  if (!pre.found) {
    log('No stores table found. Nothing to repair.');
    liveDb.close();
    process.exit(0);
  }
  const needsWork = pre.missing.slug || pre.missing.subdomain || pre.missing.status;
  log(`Preflight: table ${pre.table}, missing columns: ${JSON.stringify(pre.missing)}`);
  // Only query slug values when the column exists (drifted databases may not
  // have it yet; the missing-column report above already covers that case).
  const storesNeedingSlug = pre.missing.slug
    ? []
    : liveDb
        .prepare(`SELECT id, name FROM "${pre.table}" WHERE slug IS NULL OR slug = ''`)
        .all();
  if (storesNeedingSlug.length > 0) {
    log(`Preflight: ${storesNeedingSlug.length} store(s) without slug:`);
    for (const s of storesNeedingSlug) log(`   id=${s.id} name="${s.name}"`);
  }
  if (CHECK_ONLY) {
    liveDb.close();
    log('Check complete (no writes performed). Run without --check to repair.');
    writeLog(logLines);
    process.exit(needsWork || storesNeedingSlug.length > 0 ? 1 : 0);
  }

  if (!needsWork && storesNeedingSlug.length === 0) {
    const dupSlugs = duplicateReport(liveDb, pre.table, 'slug');
    const dupSubs = duplicateReport(liveDb, pre.table, 'subdomain');
    liveDb.close();
    if (dupSlugs.length === 0 && dupSubs.length === 0) {
      log('Database already satisfies the branch workspace requirements. No writes performed.');
      writeLog(logLines);
      process.exit(0);
    }
    log('Column shape is fine but duplicates exist; see the report below.');
  }
  const integrityBefore = liveDb.prepare('PRAGMA integrity_check').get();
  liveDb.close();
  if (integrityBefore?.integrity_check !== 'ok') {
    log(`FAIL: integrity_check before repair: ${integrityBefore?.integrity_check}. Refusing to repair a damaged database.`);
    writeLog(logLines);
    process.exit(1);
  }

  // Backup, rehearse on a scratch copy, then repair live.
  let backupPath = null;
  try {
    backupPath = backupDatabase(dbPath, log);

    const scratchPath = `${dbPath}.workspace-repair-scratch`;
    copyFileSync(dbPath, scratchPath);
    const scratchDb = new DatabaseSync(scratchPath);
    const rehearsal = repairStoreWorkspaceColumns(scratchDb, (line) => log(`  [scratch] ${line}`));
    scratchDb.close();
    try {
      unlinkSync(scratchPath);
    } catch {
      // Scratch cleanup is best-effort.
    }
    if (!rehearsal.ok) {
      log(`Scratch rehearsal failed (${rehearsal.reason}). Live database NOT modified.`);
      log('Resolve the reported duplicates or mapping gaps, then re-run.');
      writeLog(logLines);
      process.exit(1);
    }
    log('Scratch rehearsal succeeded. Applying the same repair to the live database.');
    console.log('');

    const liveDb2 = new DatabaseSync(dbPath);
    const result = repairStoreWorkspaceColumns(liveDb2, log);
    liveDb2.close();
    if (!result.ok) {
      restoreBackup(dbPath, backupPath, log);
      log('Repair failed on the live database; the backup was restored. Nothing was lost.');
      writeLog(logLines);
      process.exit(1);
    }
    log('');
    log('RESULT: branch workspace store schema is ready (path + subdomain workspaces).');
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

function writeLog(lines) {
  if (lines.length === 0) return;
  try {
    const dir = join(repoRoot, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'repair-branch-workspace-store-schema.log'), lines.join('\n') + '\n');
    console.log(`\nRepair log appended: logs/repair-branch-workspace-store-schema.log`);
  } catch {
    // Log writing is best-effort; the console output above is the record.
  }
}

main();
