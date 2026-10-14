#!/usr/bin/env node
// MBUMAH HARDWARE POS - Branch workspace verification (v2.18.0.0)
//
// A practical, read-only wrapper for the branch workspace correction release:
//   1. Prints the workspace-relevant environment summary (parsed from .env
//      when the file exists; runtime process.env is what the app actually
//      reads - this is a convenience view, not a substitute for it).
//   2. Runs the hygiene sweeps: code files (src/, scripts/) must contain no
//      "stores/undefined" or "stores/null" link building; markdown mentions
//      of the old bug in docs/ and CHANGELOG.md are reported as informational
//      context, not failures.
//   3. Reminds you that the deep logic tests (link builder safety checks +
//      resolver reasonCode matrix) run under vitest, and prints the commands.
//
// Exit code 0 = clean, 1 = hygiene findings. The script NEVER modifies files
// and NEVER touches the database or the hosts file.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENV_KEYS = [
  'NEXT_PUBLIC_USE_SUBDOMAINS',
  'NEXT_PUBLIC_STORE_WORKSPACE_MODE',
  'NEXT_PUBLIC_ROOT_DOMAIN',
  'NEXT_PUBLIC_APP_URL',
  'NEXTAUTH_URL',
  'ALLOWED_HOSTS',
  'TRUST_X_FORWARDED_HOST',
  'NEXTAUTH_COOKIE_DOMAIN',
  'NEXTAUTH_COOKIE_SECURE',
  'NEXTAUTH_COOKIE_SAME_SITE',
];

const HYGIENE_PATTERN = /stores\/(undefined|null)/;
const HYGIENE_SOURCE = 'stores/undefined|stores/null';
const SELF = 'scripts/verify-branch-workspace.mjs';
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

function filterSelf(findings) {
  return findings.filter((f) => !f.includes(SELF));
}

function parseDotEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (ENV_KEYS.includes(key)) values[key] = value;
  }
  return values;
}

function walkFiles(dir, files = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      walkFiles(full, files);
    } else if (st.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function sweepWithRg(targets, globs) {
  const args = ['-n', HYGIENE_SOURCE];
  for (const glob of globs) args.push('--glob', glob);
  args.push(...targets);
  const result = spawnSync('rg', args, {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  // ok is derived from the FILTERED findings: the script's own pattern string
  // (this file quoting the sweep) is excluded, so a self-match never fails.
  if (result.status === 0) {
    const findings = filterSelf(result.stdout.trim().split('\n').filter(Boolean));
    return { findings, ok: findings.length === 0 };
  }
  if (result.status === 1) return { findings: [], ok: true };
  return null; // rg unavailable or failed to run
}

function sweepWithNode(targets, extensions) {
  const findings = [];
  for (const target of targets) {
    const abs = join(repoRoot, target);
    if (!existsSync(abs)) continue;
    for (const file of walkFiles(abs)) {
      if (file.endsWith(SELF)) continue;
      if (extensions && !extensions.some((ext) => file.endsWith(ext))) continue;
      let lines;
      try {
        lines = readFileSync(file, 'utf8').split(/\r?\n/);
      } catch {
        continue;
      }
      lines.forEach((line, i) => {
        if (HYGIENE_PATTERN.test(line)) findings.push(`${file}:${i + 1}:${line.trim()}`);
      });
    }
  }
  return { findings, ok: findings.length === 0 };
}

async function main() {
  console.log('MBUMAH HARDWARE POS - branch workspace verification');
  console.log('');

  console.log('1. Workspace environment (.env when present; unset keys shown as -)');
  const envValues = parseDotEnv(join(repoRoot, '.env'));
  for (const key of ENV_KEYS) {
    const value = envValues[key];
    console.log(`   ${key}=${value === undefined || value === '' ? '-' : value}`);
  }
  console.log('   Safe local defaults: path mode everywhere; subdomain URLs never');
  console.log('   generated on localhost, 127.0.0.1 or raw IP addresses.');
  console.log('');

  console.log('2. Hygiene sweeps (no placeholder link building in code)');
  const codeSweep =
    sweepWithRg(['src', 'scripts'], ['*.ts', '*.tsx', '*.mjs', '*.js']) ??
    sweepWithNode(['src', 'scripts'], CODE_EXTENSIONS);
  if (codeSweep.findings.length === 0) {
    console.log('   PASS: 0 findings in src/ and scripts/ code files.');
  } else {
    for (const finding of codeSweep.findings) console.log(`   FAIL: ${finding}`);
    console.log(`   ${codeSweep.findings.length} finding(s).`);
  }
  const docSweep =
    sweepWithRg(['docs', 'CHANGELOG.md'], ['*.md']) ??
    sweepWithNode(['docs'], ['.md']);
  console.log(
    `   INFO: ${docSweep.findings.length} markdown mention(s) in docs/ and CHANGELOG.md (release notes quoting the fixed bug are expected).`,
  );
  console.log('   Reserved-subdomain handling: RESERVED_SUBDOMAINS in');
  console.log('   src/lib/workspace/config.ts (admin, api, www, ...) is enforced by');
  console.log('   both the host resolver and src/lib/branch-workspace.ts - reserved');
  console.log('   labels never become branch subdomains (path fallback instead).');
  console.log('');

  console.log('3. Local database preflight (read-only, SQLite only)');
  const dbStatus = await preflightDatabase();
  if (dbStatus.skipped) {
    console.log(`   SKIP: ${dbStatus.reason}`);
  } else if (dbStatus.ok) {
    console.log(`   PASS: stores table ${dbStatus.table} has slug, subdomain and status;`);
    console.log(`   ${dbStatus.storeCount} store(s), ${dbStatus.activeCount} ACTIVE, 0 duplicate slugs/subdomains.`);
    if (dbStatus.warnings.length > 0) {
      for (const w of dbStatus.warnings) console.log(`   WARN: ${w}`);
    }
  } else {
    for (const f of dbStatus.failures) console.log(`   FAIL: ${f}`);
    console.log('   Run: node scripts/repair-branch-workspace-store-schema.mjs --check');
  }
  console.log('');

  console.log('4. Deep logic tests (vitest; not re-run here)');
  console.log('   Full suite:        bun run test');
  console.log('   Targeted run:      bunx vitest run src/tests/lib/branch-workspace.test.ts');
  console.log('   Covers: link builder safety checks (localhost / raw IP / reserved');
  console.log('   labels / missing slug / inactive stores) and the resolver');
  console.log('   reasonCode matrix (store-not-found, store-inactive,');
  console.log('   user-not-allowed, missing-slug, schema-drift).');
  console.log('');

  if (!codeSweep.ok) {
    console.log('RESULT: hygiene findings above need attention (exit 1).');
    process.exit(1);
  }
  if (!dbStatus.skipped && !dbStatus.ok) {
    console.log('RESULT: local database preflight failed (exit 1); see the repair command above.');
    process.exit(1);
  }
  console.log('RESULT: clean (exit 0).');
}

/**
 * Read-only preflight of the local SQLite store workspace columns
 * (v2.18.0.3): missing slug/subdomain/status columns, stores without a
 * slug, and duplicate slugs/subdomains. Never writes; skips cleanly for
 * PostgreSQL URLs, missing databases or unavailable node:sqlite.
 */
async function preflightDatabase() {
  let databaseUrl = process.env.DATABASE_URL || null;
  if (!databaseUrl) {
    const envPath = join(repoRoot, '.env');
    if (existsSync(envPath)) {
      try {
        for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const eq = line.indexOf('=');
          if (eq === -1) continue;
          if (line.slice(0, eq).trim() === 'DATABASE_URL') {
            databaseUrl = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
            break;
          }
        }
      } catch {
        // Unreadable .env: treated as no URL below.
      }
    }
  }
  if (!databaseUrl) return { skipped: true, reason: 'DATABASE_URL is not set' };
  if (!databaseUrl.startsWith('file:')) {
    return { skipped: true, reason: 'non-SQLite DATABASE_URL (PostgreSQL preflight runs server-side)' };
  }
  let dbPath = databaseUrl.slice('file:'.length).replace(/\?.*$/, '');
  if (/^\/[A-Za-z]:/.test(dbPath)) dbPath = dbPath.slice(1);
  dbPath = dbPath.replace(/\\/g, '/');
  try {
    dbPath = decodeURIComponent(dbPath);
  } catch {
    // Keep the raw path when percent-decoding fails.
  }
  if (!existsSync(dbPath)) return { skipped: true, reason: `database file not found: ${dbPath}` };

  let DatabaseSync;
  try {
    // node:sqlite needs Node >= 22.5; older runtimes skip this section.
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return { skipped: true, reason: 'node:sqlite unavailable in this runtime' };
  }

  const failures = [];
  const warnings = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='stores'")
      .get();
    if (!tableRow) {
      db.close();
      return { skipped: true, reason: 'no stores table yet (first boot not run)' };
    }
    const table = tableRow.name;
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name.toLowerCase());
    for (const col of ['slug', 'subdomain', 'status']) {
      if (!columns.includes(col)) failures.push(`column missing on ${table}: ${col}`);
    }
    const storeCount = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    let activeCount = 0;
    if (columns.includes('status')) {
      activeCount = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE status = 'ACTIVE'`).get().n;
      const inactive = db.prepare(`SELECT name FROM "${table}" WHERE status IS NOT NULL AND status <> 'ACTIVE'`).all();
      for (const row of inactive) warnings.push(`store not ACTIVE: "${row.name}"`);
    }
    if (columns.includes('slug')) {
      const noSlug = db.prepare(`SELECT name FROM "${table}" WHERE slug IS NULL OR slug = ''`).all();
      for (const row of noSlug) failures.push(`store without slug: "${row.name}"`);
      const dupSlugs = db
        .prepare(`SELECT slug, COUNT(*) AS n FROM "${table}" WHERE slug IS NOT NULL AND slug <> '' GROUP BY slug HAVING COUNT(*) > 1`)
        .all();
      for (const row of dupSlugs) failures.push(`duplicate slug "${row.slug}" on ${row.n} rows`);
    }
    if (columns.includes('subdomain')) {
      const dupSubs = db
        .prepare(`SELECT subdomain, COUNT(*) AS n FROM "${table}" WHERE subdomain IS NOT NULL AND subdomain <> '' GROUP BY subdomain HAVING COUNT(*) > 1`)
        .all();
      for (const row of dupSubs) failures.push(`duplicate subdomain "${row.subdomain}" on ${row.n} rows`);
    }
    db.close();
    return { ok: failures.length === 0, table, storeCount, activeCount, failures, warnings };
  } catch (error) {
    failures.push(`preflight could not read the database: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, failures, warnings };
  }
}

main();
