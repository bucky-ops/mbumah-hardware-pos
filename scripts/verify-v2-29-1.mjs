#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.29.1 verification (correction release)
// QA-caught production bug from v2.29.0: the SSR payslips page called
// formatKes() imported from the 'use client' self-service-ui module — a
// client REFERENCE on the server, so the route crashed for every employee
// with payslips. This correction moves both server-page formatter imports
// (payslips: formatKes; documents: formatDate — a second latent instance
// the regression guard caught) to the directive-free pure module, and adds
// a static vitest guard over all six portal pages.
// Run: npm run verify:v2-29-1

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Server-page formatter imports ==');
check('payslips page imports formatKes from the pure self-service-format module', (() => {
  const p = read('src/app/(selfservice)/employees/me/payslips/page.tsx') ?? '';
  return p.includes("import { formatKes } from '@/components/hr/self-service-format'") &&
    !/import\s*{[^}]*formatKes[^}]*from\s*'@\/components\/hr\/self-service-ui'/.test(p);
})());
check('documents page imports formatDate from the pure self-service-format module', (() => {
  const p = read('src/app/(selfservice)/employees/me/documents/page.tsx') ?? '';
  return p.includes("import { formatDate } from '@/components/hr/self-service-format'") &&
    !/import\s*{[^}]*formatDate[^}]*from\s*'@\/components\/hr\/self-service-ui'/.test(p);
})());
check('no other portal server page imports a formatter from the client module', (() => {
  let ok = true;
  for (const page of ['page.tsx', 'attendance/page.tsx', 'leave/page.tsx', 'goals/page.tsx']) {
    const src = read(`src/app/(selfservice)/employees/me/${page}`) ?? '';
    if (/import\s*{[^}]*(formatKes|formatDate)[^}]*from\s*'@\/components\/hr\/self-service-ui'/.test(src)) ok = false;
  }
  return ok;
})());
check('pure format module stays directive-free (both-graph importable)', (() => {
  const s = read('src/components/hr/self-service-format.ts') ?? '';
  return !/^\s*['"]use client['"]/m.test(s) && !/^\s*import\s+['"]server-only['"]/m.test(s);
})());
check('regression guard test exists and covers all six portal pages', (() => {
  const t = read('src/tests/lib/self-service-server-format.test.ts') ?? '';
  return t.includes('self-service-server-format') === false && t.includes('documents/page.tsx') && t.includes('payslips/page.tsx') && t.includes('attendance/page.tsx') && t.includes('goals/page.tsx') && t.includes('leave/page.tsx') && t.includes('directive-free');
})());

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.29.1', pkg.version === '2.29.1', pkg.version);
check('mbumah.releaseVersion bumped in lockstep (2.29.1)', pkg.mbumah?.releaseVersion === '2.29.1' && pkg.mbumah?.baseVersion === '2.29.1');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a [2.29.1] entry', changelog.includes('[2.29.1]'));
check('verify script registered in package.json', (pkg.scripts ?? {})['verify:v2-29-1'] === 'node scripts/verify-v2-29-1.mjs');

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll v2.29.1 checks PASS');
