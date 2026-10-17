#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.47.0 verification
// Scope: the payroll-run APPROVAL digest — a pure run-digest module (copy
// builder + per-employee CSV attachment), the best-effort fan-out inside
// approvePayrollRun (maker + payroll group, actor excluded, CSV attached,
// honest emailStatus), the approve route surfacing the digest result, the
// notification feed carrying payroll_approved rows (both filter lists),
// NotificationType.PAYROLL_APPROVED, the run-dialog digest banner and the
// What's-New entry.
// Run: node scripts/verify-v2-47-0.mjs

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

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.47.0', PKG.version === '2.47.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.47.0', PKG.mbumah?.releaseVersion === '2.47.0');
check('mbumah.baseVersion is 2.47.0', PKG.mbumah?.baseVersion === '2.47.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.47.0 entry", WN.includes("version: '2.47.0'"));
check("What's-New mentions the approval digest", WN.includes('payroll run is approved'));
check("What's-New mentions the per-employee CSV", WN.includes('per-employee CSV'));
check('verify:v2-47-0 script is wired', (PKG.scripts ?? {})['verify:v2-47-0'] === 'node scripts/verify-v2-47-0.mjs');

console.log('== Pure module: src/lib/hr/payroll/run-digest.ts ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check('module exists', !!RD);
check('exports the payroll_approved marker', RD.includes("PAYROLL_APPROVED_METADATA_MARKER = 'payroll_approved'"));
check('reuses the RFC-4180 cell escaper', RD.includes("from '@/lib/hr/digest-csv'"));
check('CSV formula-injection contract documented', RD.includes('csvCell'));
check('filename slugs period + run type', RD.includes('mbumah-payroll-'));
check('null on approved empty run (no empty spreadsheet)', RD.includes('hasRows') && RD.includes('hasTotals'));
check('privacy contract in the email footer', RD.includes('never contains national IDs'));
check('money is deterministic (no locale-dependent toLocaleString)', !RD.includes('toLocaleString'));

console.log('== Service fan-out: src/lib/hr/payroll/run-service.ts ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('sends the digest inside approvePayrollRun', RS.includes('notifyPayrollRunApproved'));
check('fail-soft: approval never fails on digest errors', RS.includes("console.warn('[payroll] approval digest failed (best-effort)"));
check('returns { run, digest } contract', RS.includes('return { run: updated, digest }'));
check('audience excludes the actor', RS.includes('byId.delete(params.actorId)'));
check('maker always included (maker-checker contract)', RS.includes('preparedByUserId') && RS.includes('byId.set(maker.id, maker)'));
check('decision-capable roles mirror the leave fan-out', RS.includes("'SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'"));
check('CSV rides the email envelope', RS.includes('attachments: [csv]'));
check('NotificationLog metadata stamps run + CSV (names/sizes only)', RS.includes('csvFilename: csv.filename') && RS.includes('csvBytes: csv.byteSize'));
check('in-app rows carry the kind marker', RS.includes('kind: PAYROLL_APPROVED_METADATA_MARKER'));

console.log('== Approve route response ==');
const AR = read('src/app/api/payroll/runs/[id]/approve/route.ts') ?? '';
check('route destructures { run, digest }', AR.includes('const { run, digest } = await approvePayrollRun'));
check('response carries the digest result', AR.includes('data: run, digest'));

console.log('== Email service vocabulary ==');
const ES = read('src/lib/email-service.ts') ?? '';
check("NotificationType.PAYROLL_APPROVED exists", ES.includes("PAYROLL_APPROVED: 'PAYROLL_APPROVED'"));

console.log('== Feed route: both filter lists ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('imports the payroll marker', NF.includes("import { PAYROLL_APPROVED_METADATA_MARKER } from '@/lib/hr/payroll/run-digest'"));
check("type union carries 'payroll_approved'", NF.includes("| 'payroll_approved'"));
check('section-8 NOT list excludes payroll rows', (NF.split('NOT: {')[1] ?? '').includes('PAYROLL_APPROVED_METADATA_MARKER'));
check('section-9 OR list includes payroll rows', (NF.split("9. v2.31.0")[1] ?? '').includes('PAYROLL_APPROVED_METADATA_MARKER'));
check('mapping branch deep-links the Payroll tab', NF.includes("kind === 'payroll_approved'") && (NF.split("kind === 'payroll_approved'")[1] ?? '').includes("targetTab: 'payroll'"));
check('FAILED email delivery escalates to warning', (NF.split("kind === 'payroll_approved'")[1] ?? '').includes("extras.emailStatus === 'FAILED'"));
check('leave kind parser accepts payroll_approved', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'payroll_approved'"));

console.log('== Run dialog: honest digest banner ==');
const DL = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('captures body.digest after approve', DL.includes("if (action === 'approve')"));
check('renders the Approval digest banner', DL.includes('Approval digest · '));
check('emerald / amber / slate honest status styling', DL.includes("digestNotice.emailStatus === 'SENT'") && DL.includes("digestNotice.emailStatus === 'FAILED'"));
check('names the attached CSV file + size', DL.includes('csvFilename') && DL.includes('formatCsvSize'));
check('reuses the shared size formatter', DL.includes("import { formatCsvSize } from '@/lib/hr/digest-csv'"));

console.log('== Tests ==');
const TD = read('src/tests/payroll-run-digest.test.ts') ?? '';
check('pure + service test file exists', !!TD);
check('covers the fail-soft guarantee', TD.includes('expect(result.emailStatus)') || (read('src/tests/lib/payroll-run-lifecycle.test.ts') ?? '').includes('expect(digest).toBeNull()'));
check('covers the injection guard', TD.includes('=HYPERLINK'));
check('covers the actor exclusion + maker inclusion', TD.includes("byId.delete") || TD.includes("['maker-1', 'owner-1']"));

console.log('');
if (failures === 0) {
  console.log('v2.47.0 verification: ALL PASS');
} else {
  console.log(`v2.47.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
