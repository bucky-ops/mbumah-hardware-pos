#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - v2.18.4 expert console verification
// ============================================================================
// Static verification (no database, no network) that the v2.18.4 release
// deliverables are present and internally consistent:
//
//   1. The expert console route exists and is role-gated to SUPER_ADMIN and
//      STORE_OWNER (the /api/health/schema in-handler pattern).
//   2. ORG_DIAGNOSTIC_REASON_CODES in src/lib/org/diagnostics.ts matches the
//      documented vocabulary below (contract drift breaks consumers).
//   3. The slug repair apply route keeps its three hard guards: explicit
//      confirmation, a PostgreSQL (non-SQLite) refusal, and the backup-first
//      scripts/backup-db.mjs invocation.
//   4. The v2.18.4 documentation set exists (expert information, roadmap,
//      database migration policy, test audit report).
//
// Usage: node scripts/verify-org-console-expert-info.mjs
// Exit codes: 0 = all checks pass, 1 = at least one check failed.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let failures = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}${detail ? ` (${detail})` : ''}`);
  }
}

function readRepoFile(relativePath) {
  const full = join(root, relativePath);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Expert console route: exists + role gate
// ---------------------------------------------------------------------------

const expertConsolePath = 'src/app/api/org/expert-console/route.ts';
const expertConsole = readRepoFile(expertConsolePath);
check('expert-console route exists', expertConsole !== null, expertConsolePath);
const roleGatePattern = /requireRole\(\s*['"]SUPER_ADMIN['"]\s*,\s*['"]STORE_OWNER['"]\s*\)/;
check(
  'expert-console route is gated to SUPER_ADMIN and STORE_OWNER',
  expertConsole !== null && roleGatePattern.test(expertConsole),
  `expected requireRole('SUPER_ADMIN', 'STORE_OWNER') in ${expertConsolePath}`,
);

// ---------------------------------------------------------------------------
// 2. Reason-code vocabulary contract
// ---------------------------------------------------------------------------

const DOCUMENTED_REASON_CODES = [
  'ready',
  'missing-slug',
  'missing-subdomain',
  'store-inactive',
  'workspace-disabled',
  'invalid-host',
  'reserved-subdomain',
  'path-route-missing',
  'schema-drift',
  'permission-denied',
  'unknown',
];

const diagnosticsPath = 'src/lib/org/diagnostics.ts';
const diagnostics = readRepoFile(diagnosticsPath);
check('diagnostics data layer exists', diagnostics !== null, diagnosticsPath);

let actualCodes = null;
if (diagnostics !== null) {
  const match = diagnostics.match(/ORG_DIAGNOSTIC_REASON_CODES\s*=\s*\[([^\]]*)\]/);
  if (match) {
    actualCodes = [...match[1].matchAll(/['"]([a-z-]+)['"]/g)].map((m) => m[1]);
  }
}
check(
  'ORG_DIAGNOSTIC_REASON_CODES matches the documented vocabulary',
  actualCodes !== null &&
    actualCodes.length === DOCUMENTED_REASON_CODES.length &&
    DOCUMENTED_REASON_CODES.every((code, i) => actualCodes[i] === code),
  actualCodes === null
    ? 'could not parse ORG_DIAGNOSTIC_REASON_CODES'
    : `got [${actualCodes.join(', ')}]`,
);

// ---------------------------------------------------------------------------
// 3. Slug repair apply guards
// ---------------------------------------------------------------------------

const applyPath = 'src/app/api/org/slug-repair/apply/route.ts';
const applyRoute = readRepoFile(applyPath);
check('slug-repair apply route exists', applyRoute !== null, applyPath);

const confirmEnforced =
  applyRoute !== null && /confirm\s*!==\s*true/.test(applyRoute);
check(
  'slug-repair apply enforces explicit confirmation',
  confirmEnforced,
  `expected a "confirm !== true" refusal in ${applyPath}`,
);

const providerRefusal =
  applyRoute !== null &&
  /startsWith\(\s*['"]file:['"]\s*\)/.test(applyRoute) &&
  applyRoute.includes('database-migration-policy');
check(
  'slug-repair apply refuses non-SQLite databases with migration guidance',
  providerRefusal,
  `expected a "file:" DATABASE_URL check referencing database-migration-policy in ${applyPath}`,
);

// The route computes the script path at runtime (join + concatenation) so the
// bundler never tries to resolve it as a module; accept both spellings.
const backupFirst =
  applyRoute !== null &&
  applyRoute.includes('spawnSync') &&
  (applyRoute.includes('backup-db.mjs') || applyRoute.includes("backup-db' + '.mjs"));
check(
  'slug-repair apply is backup-first (scripts/backup-db.mjs)',
  backupFirst,
  `expected a backup-db.mjs invocation in ${applyPath}`,
);

// ---------------------------------------------------------------------------
// 4. Documentation set
// ---------------------------------------------------------------------------

const REQUIRED_DOCS = [
  'docs/org-console-expert-information.md',
  'docs/org-console-roadmap.md',
  'docs/database-migration-policy.md',
  'docs/TEST_AUDIT_REPORT.md',
  'docs/TEST_AUDIT_REPORT.json',
];

for (const doc of REQUIRED_DOCS) {
  check(`documentation exists: ${doc}`, existsSync(join(root, doc)));
}

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? 'verify-org-console-expert: ALL CHECKS PASSED'
    : `verify-org-console-expert: ${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
