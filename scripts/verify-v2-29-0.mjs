#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.29.0 verification
// Static + structural checks for the self-service depth round: the SSR
// payslip year switcher (?year=YYYY), the email-log CSV export (pure
// serializer + route branch + viewer button), the leave seed pass, and
// version metadata.
// Run: npm run verify:v2-29-0

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

console.log('== SSR payslip year switcher ==');
check('service: listMyPayslipYears derives distinct UTC years from the 60-row window', (() => {
  const svc = read('src/lib/hr/self-service.ts') ?? '';
  const fn = svc.slice(svc.indexOf('export async function listMyPayslipYears'));
  return fn.includes('take: 60') && fn.includes('getUTCFullYear') && fn.includes('sort((a, b) => b - a)');
})());
check('page: reads ?year= searchParams with strict 4-digit validation', (() => {
  const p = read('src/app/(selfservice)/employees/me/payslips/page.tsx') ?? '';
  return p.includes('searchParams: Promise<{ year?: string }>') && p.includes('/^\\d{4}$/') && p.includes('parseYearParam');
})());
check('page: switcher is SSR navigation with aria-current + All-years fallback', (() => {
  const p = read('src/app/(selfservice)/employees/me/payslips/page.tsx') ?? '';
  return p.includes('aria-current={active') && p.includes('All years') && p.includes('<Link');
})());
check('page: per-view summary line (count + total net, tabular)', (() => {
  const p = read('src/app/(selfservice)/employees/me/payslips/page.tsx') ?? '';
  return p.includes('totalNet') && p.includes('tabular-nums') && p.includes('aria-live="polite"');
})());
check('tests: UTC bucketing + window + empty list covered', (() => {
  const t = read('src/tests/lib/payslip-years.test.ts') ?? '';
  return t.includes('buckets by UTC year') && t.includes('take: 60') && t.includes('resolves.toEqual([])');
})());

console.log('== Email-log CSV export ==');
check('serializer: pure RFC 4180 escaping (comma/quote/CR/LF, doubled quotes)', (() => {
  const s = read('src/lib/email-log-csv.ts') ?? '';
  return s.includes('export function escapeCsvCell') && s.includes('/[",\\r\\n]/') && s.includes('replace(/"/g, \'""\')');
})());
check('serializer: header row + CRLF line endings', (() => {
  const s = read('src/lib/email-log-csv.ts') ?? '';
  return s.includes("join('\\r\\n')") && s.includes('message_id') && s.includes('triggered_by');
})());
check('route: format=csv short-circuits before the paginated query', (() => {
  const r = read('src/app/api/notifications/logs/route.ts') ?? '';
  const csvIdx = r.indexOf("if (searchParams.get('format') === 'csv')");
  const queryIdx = r.indexOf('const [logs, total] = await Promise.all([');
  return csvIdx > 0 && queryIdx > 0 && csvIdx < queryIdx && r.includes('CSV_EXPORT_CAP = 2000');
})());
check('route: same role gate (requireAuth) + CSV headers with dated filename', (() => {
  const r = read('src/app/api/notifications/logs/route.ts') ?? '';
  return r.includes('text/csv; charset=utf-8') && r.includes('mbumah-email-delivery-log-') && r.includes("requireAuth(getLogsHandler, { roles: ALLOWED_ROLES })");
})());
check('viewer: Export CSV anchor carries active filters + download + aria-label', (() => {
  const v = read('src/components/admin/email-delivery-log-section.tsx') ?? '';
  return v.includes('format=csv&${params.toString()}') && v.includes('download') && v.includes('Export the filtered delivery log as CSV') && v.includes('<Download');
})());
check('tests: escaping + header/CRLF + full row shape + empty cells covered', (() => {
  const t = read('src/tests/lib/email-log-csv.test.ts') ?? '';
  return t.includes('doubles embedded quotes') && t.includes('emits the header row') && t.includes('renders absent messageId / user / dates as empty cells');
})());

console.log('== Leave seed pass ==');
check('seed: idempotent leave-type upsert + per-employee balance grant', (() => {
  const s = read('scripts/qa-seed-leave-dev.mjs') ?? '';
  return s.includes("findUnique({ where: { code: t.code } })") && s.includes('findFirst') && s.includes('leaveYear: YEAR') && s.includes('already present');
})());
check('seed: five standard Kenyan leave types incl. statutory flags', (() => {
  const s = read('scripts/qa-seed-leave-dev.mjs') ?? '';
  return ["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "COMPASSIONATE"].every((c) => s.includes(`code: '${c}'`)) && s.includes('isStatutory: true');
})());

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.29.0', pkg.version === '2.29.0', pkg.version);
check('mbumah.releaseVersion bumped in lockstep (2.29.0)', pkg.mbumah?.releaseVersion === '2.29.0' && pkg.mbumah?.baseVersion === '2.29.0');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a [2.29.0] entry', changelog.includes('[2.29.0]'));
const wn = read('src/lib/whats-new.ts') ?? '';
check("What's-New has the 2.29.0 entry", wn.includes("version: '2.29.0'"));
check('verify script registered in package.json', (pkg.scripts ?? {})['verify:v2-29-0'] === 'node scripts/verify-v2-29-0.mjs');

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll v2.29.0 checks PASS');
