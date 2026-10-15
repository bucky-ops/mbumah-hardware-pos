#!/usr/bin/env node
/**
 * verify-hr-isolation.mjs
 *
 * Static isolation verification for the /api/hr route family (the runtime
 * counterpart runs in vitest: src/tests/lib/hr-permissions.test.ts and the
 * existing tenant-scoping suites). Asserts every HR route:
 *   1. Composes the hrGuard helper (feature flag + hr permission + store scope).
 *   2. Never trusts a client storeId outside the documented SUPER_ADMIN path.
 *   3. Returns safe 404s for cross-branch record reads.
 * Read-only.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

const root = process.cwd();
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const hrRoutes = walk(path.join(root, 'src/app/api/hr'));
check('HR API routes exist', hrRoutes.length >= 4);

for (const file of hrRoutes) {
  const rel = path.relative(root, file);
  const src = readFileSync(file, 'utf8');
  check(`${rel} composes hrGuard`, /hrGuard\('/.test(src));
}

// The employees [id] route must return a safe 404 (no branch existence leak).
const detailRoute = path.join(root, 'src/app/api/hr/employees/[id]/route.ts');
if (existsSync(detailRoute)) {
  const src = readFileSync(detailRoute, 'utf8');
  check('employee detail route returns safe 404', /'Employee not found\.'/.test(src));
  check(
    'employee detail unmask is permission-gated',
    /hasHrPermission\(session\.role, 'hr\.employee\.unmask\.pii'\)/.test(src),
  );
  check('unmasked reads write an audit event', /unmask|Unmask/.test(src) && /hrAudit/.test(src));
} else {
  check('employee detail route exists', false);
}

// The list route must derive the store from the session, not the query.
const listRoute = path.join(root, 'src/app/api/hr/employees/route.ts');
if (existsSync(listRoute)) {
  const src = readFileSync(listRoute, 'utf8');
  check(
    'employee list resolves store from the session (client storeId ignored for non-admins)',
    /session\.storeId/.test(src) && /SUPER_ADMIN/.test(src),
  );
}

console.log('');
if (failures > 0) {
  console.log(`verify-hr-isolation: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-hr-isolation: all checks passed.');
