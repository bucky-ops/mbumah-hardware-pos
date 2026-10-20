#!/usr/bin/env node
/**
 * verify-spec-paths.mjs — the EMS spec's Phase 4.6/4.7 path-parity gate.
 *
 * The EMS spec (v2.18.9, "Create:" lists in Phase 4.6 and Phase 4.7) names
 * every API route and page the payroll-run-lifecycle + performance/self-service
 * phases must provide. This script is the MECHANICAL half of that governance
 * contract: every named path must exist on disk. API paths need a route.ts;
 * page paths need a page.tsx in the right route group. The alias routes are
 * additionally asserted to RE-EXPORT their canonical handler (source check)
 * so the two can never drift apart silently.
 *
 * Exit 0 = full parity. Exit 1 = any missing path or broken alias.
 *
 * Usage: node scripts/verify-spec-paths.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'app');

// Phase 4.6 — payroll run lifecycle, journal posting, payslips, P10, corrections.
// (spec v2.18.9 Phase 4.6 "Create:" list, verbatim)
const PHASE_46 = {
  api: [
    '/api/payroll/runs',
    '/api/payroll/runs/[id]/validate',
    '/api/payroll/runs/[id]/approve',
    '/api/payroll/runs/[id]/reject',
    '/api/payroll/runs/[id]/post',
    '/api/payroll/runs/[id]/disburse',
    '/api/payroll/runs/[id]/lock',
    '/api/payroll/runs/[id]/payslips',
    '/api/payroll/payslips/[id]',
    '/api/payroll/payslips/[id]/pdf',
    '/api/payroll/payslips/[id]/trace',
    '/api/payroll/corrections',
    '/api/payroll/exports/p10',
    '/api/payroll/exports/statutory',
    '/api/payroll/liability-report',
  ],
  pages: ['/hr/payroll'],
};

// Phase 4.7 — performance, assets, disciplinary, self-service.
// (spec v2.18.9 Phase 4.7 "Create:" list, verbatim)
const PHASE_47 = {
  api: [
    '/api/hr/performance/cycles',
    '/api/hr/performance/reviews',
    '/api/hr/goals',
    '/api/hr/assets',
    '/api/hr/discipline',
    '/api/self-service/me',
    '/api/self-service/me/payslips',
    '/api/self-service/me/attendance',
    '/api/self-service/me/leave',
    '/api/self-service/me/documents',
  ],
  pages: [
    '/employees/me',
    '/employees/me/payslips',
    '/employees/me/attendance',
    '/employees/me/leave',
    '/employees/me/goals',
    '/employees/me/documents',
  ],
};

// The three spec-path aliases introduced in v2.160.0 — each must re-export
// its canonical handler so parity is structural, not incidental.
const ALIASES = [
  {
    alias: '/api/payroll/exports/p10',
    canonical: '/api/hr/reports/p10',
  },
  {
    alias: '/api/payroll/exports/statutory',
    canonical: '/api/hr/reports/statutory-liability',
  },
  {
    alias: '/api/payroll/liability-report',
    canonical: '/api/hr/reports/statutory-liability',
  },
];

/** /api/x/y → src/app/api/x/y/route.ts */
function apiRoutePath(p) {
  const rel = p.replace(/^\/api\//, 'api/');
  return join(ROOT, rel, 'route.ts');
}

/**
 * Page path → candidate page.tsx locations across route groups.
 * /hr/payroll → (shell)/hr/payroll/page.tsx
 * /employees/me → (selfservice)/employees/me/page.tsx
 */
function pageCandidates(p) {
  const rel = p.replace(/^\//, '');
  return [
    join(ROOT, '(shell)', rel, 'page.tsx'),
    join(ROOT, '(selfservice)', rel, 'page.tsx'),
    join(ROOT, rel, 'page.tsx'),
  ];
}

function resolveRelative(fromFile, relSpec) {
  const fromDir = join(fromFile, '..');
  const parts = join(fromDir, relSpec).split(/[\\/]/);
  return parts.join('/');
}

let failures = 0;
function check(label, ok, detail = '') {
  const mark = ok ? '  ✓' : '  ✗';
  console.log(`${mark} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

console.log('\nEMS spec path parity — Phase 4.6 (payroll run lifecycle)');
for (const p of PHASE_46.api) {
  check(p, existsSync(apiRoutePath(p)), 'missing route.ts');
}
for (const p of PHASE_46.pages) {
  check(p, pageCandidates(p).some(existsSync), 'missing page.tsx in any route group');
}

console.log('\nEMS spec path parity — Phase 4.7 (performance, self-service)');
for (const p of PHASE_47.api) {
  check(p, existsSync(apiRoutePath(p)), 'missing route.ts');
}
for (const p of PHASE_47.pages) {
  check(p, pageCandidates(p).some(existsSync), 'missing page.tsx in any route group');
}

console.log('\nAlias re-export parity (spec path ≡ canonical handler)');
for (const a of ALIASES) {
  const aliasFile = apiRoutePath(a.alias);
  if (!existsSync(aliasFile)) {
    check(`${a.alias} re-exports ${a.canonical}`, false, 'alias route.ts missing');
    continue;
  }
  const src = readFileSync(aliasFile, 'utf8');
  // The alias must re-export the canonical GET handler AND statically declare
  // the segment config locally (Next.js refuses re-exported `dynamic`).
  const re = new RegExp(
    "export\\s*\\{\\s*GET\\s*\\}\\s*from\\s*'[^']*/route'",
  );
  const dyn = new RegExp("export\\s*const\\s*dynamic\\s*=\\s*'force-dynamic'");
  const m = src.match(/from\s+'([^']+)'/);
  let resolvesToCanonical = false;
  if (m) {
    const target = resolveRelative(aliasFile, m[1]).replace(/\\/g, '/');
    // Import specifiers omit the .ts extension — compare without it.
    resolvesToCanonical = target.endsWith(`${a.canonical}/route`);
  }
  const ok = re.test(src) && dyn.test(src) && resolvesToCanonical;
  check(`${a.alias} re-exports ${a.canonical}`, ok, 'must `export { GET } from <canonical>/route` + local `export const dynamic`');
}

console.log(
  failures === 0
    ? '\nSPEC-PATH PARITY: OK — every Phase 4.6/4.7 path exists.\n'
    : `\nSPEC-PATH PARITY: ${failures} failure(s) — see ✗ above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
