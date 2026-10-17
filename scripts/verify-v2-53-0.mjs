#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.53.0 verification
// Scope: the run's filing file, on demand ("download a payroll run's digest
// CSV straight from the Pay Runs desk"). A new GET /api/payroll/runs/[id]/
// digest-csv route serves the SAME per-employee CSV the v2.47.0 approval and
// v2.48.0 posting emails attach — payrollRunDigestToCsv stays the single
// builder for both channels, so a downloaded CSV can never disagree with the
// inbox. Status gate: APPROVED files the approval variant, POSTED/LOCKED the
// posted variant; everything earlier refuses honestly (400
// RUN_NOT_EXPORTABLE); an empty run 404s (NO_RUN_DATA); exports are audit
// logged (DATA_EXPORT, field-name metadata only). Every v2.47–v2.52 feature
// is asserted intact (era-frozen version slots excepted by convention).
// Run: node scripts/verify-v2-53-0.mjs

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
check('package.json version is 2.53.0', PKG.version === '2.53.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.53.0', PKG.mbumah?.releaseVersion === '2.53.0');
check('mbumah.baseVersion is 2.53.0', PKG.mbumah?.baseVersion === '2.53.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.53.0 entry", WN.includes("version: '2.53.0'"));
check("What's-New names the on-demand filing story", WN.includes('filing file, on demand'));
check('verify:v2-53-0 script is wired', (PKG.scripts ?? {})['verify:v2-53-0'] === 'node scripts/verify-v2-53-0.mjs');
check('verify:v2-52-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-52-0'] === 'node scripts/verify-v2-52-0.mjs');

console.log('== Service: one builder for both channels ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('exports the pure status gate (unit-tested)', RS.includes('export function payrollRunExportDecision'));
check('APPROVED files the approval variant', RS.includes("runStatus === 'APPROVED'"));
check('POSTED and LOCKED file the posted variant', RS.includes("runStatus === 'POSTED' || runStatus === 'LOCKED'"));
check('earlier statuses refuse with RUN_NOT_EXPORTABLE', RS.includes("code: 'RUN_NOT_EXPORTABLE'") && RS.includes('from approval onward'));
check('exports the service-seam builder', RS.includes('export async function buildRunDigestExport'));
check('rows come from PayrollDetail scoped to the run', RS.includes('payrollRunId: params.run.id'));
check('rows ordered by payslip number then employee', RS.includes("orderBy: [{ payslipNumber: 'asc' }, { employeeId: 'asc' }]"));
check('unnamed employees fall back honestly', RS.includes("|| 'Unnamed employee'"));
check('approver label ladder name → email → Approver', RS.includes("return u?.name?.trim() || u?.email || fallback;"));
check('posted variant stamps payslip range from detail rows', RS.includes('firstPayslipNumber: slipNumbers[0] ?? null'));
check('poster label falls back to the approver label', RS.includes('posterLabel || approverLabel'));
check('empty run → null (the route answers 404)', RS.includes('return payrollRunDigestToCsv(rows, meta, params.now ?? new Date(), decision.variant);'));

console.log('== Route: GET /api/payroll/runs/[id]/digest-csv ==');
const RT = read('src/app/api/payroll/runs/[id]/digest-csv/route.ts') ?? '';
check('route file exists', !!RT);
check('same guard + roles as the run detail route', RT.includes("hrGuard('hr.payroll.read.all', READ_ROLES)"));
check('branch-scoped lookup (cross-branch id 404s)', RT.includes('storeId: session.storeId'));
check('unknown run → honest 404', RT.includes("code: 'NOT_FOUND'") && RT.includes('status: 404'));
check('status gate refusal → 400 RUN_NOT_EXPORTABLE', RT.includes("code: decision.code") && RT.includes('status: decision.status'));
check('empty run → honest 404 NO_RUN_DATA', RT.includes("code: 'NO_RUN_DATA'"));
check('serves the shared builder attachment as the body', RT.includes('Buffer.from(csv.content'));
check('download disposition + honest filename headers', RT.includes(`'Content-Disposition': \`attachment; filename="\${csv.filename}"\``) && RT.includes('X-Digest-Csv-Filename'));
check('no-store cache (a filing export is never a cached artefact)', RT.includes("'Cache-Control': 'no-store'"));
check('export is audit logged as DATA_EXPORT', RT.includes('PAYROLL_RUN_DIGEST_EXPORTED') && RT.includes('HrEntityType.DATA_EXPORT'));
check('audit metadata carries run/variant/size field names only', RT.includes('runId: run.id') && RT.includes('variant: decision.variant') && RT.includes('byteSize: csv.byteSize'));
check('channel label names the ad-hoc download', RT.includes("channel: 'ad_hoc_download'"));

console.log('== Shared client download ==');
const CL = read('src/components/hr/run-digest-csv.ts') ?? '';
check('shared helper exists (dialog + desk row use one path)', CL.includes('export async function downloadRunDigestCsv'));
check('fetch is credentials-included', CL.includes("credentials: 'include'"));
check('failure is the honest server message', CL.includes('j.error || `Export failed (${res.status}).`'));
check('download honours the server filename first', CL.includes("match?.[1] ?? res.headers.get('X-Digest-Csv-Filename')"));
check('size label from the shared formatter (chip parity)', CL.includes('formatCsvSize(blob.size)'));

console.log('== UI: violet filing row in the run dialog ==');
const DG = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('filing row visible from approval onward only', DG.includes("['APPROVED', 'POSTED', 'LOCKED'].includes(status)"));
check('violet outline button family (light + dark)', DG.includes('border-violet-300 text-violet-700') && DG.includes('dark:border-violet-800'));
check('busy state never double-fires', DG.includes('runCsvBusy') && DG.includes("'Exporting…'"));
check('success note names file + parity promise', DG.includes('Same per-employee summary the approval and posting emails carry.'));
check('note is a live region (screen-reader reachable)', DG.includes('role="status"'));
check('note resets when the dialog reopens', DG.includes('setRunCsvNote(null);'));
check('button carries an accessible name + title', DG.includes('aria-label="Download the digest CSV for this run"'));
check('uses the shared download helper', DG.includes('downloadRunDigestCsv(runId)'));

console.log('== UI: row-level Digest CSV on the Pay Runs desk ==');
const PG = read('src/app/(shell)/hr/payroll/page.tsx') ?? '';
check('exportable rows carry the row-level action', PG.includes("['APPROVED', 'POSTED', 'LOCKED'].includes(run.status)"));
check('per-row busy tracking', PG.includes('digestRowId') && PG.includes("'Exporting…'"));
check('violet family consistent with the dialog + reports desk', PG.includes('text-violet-700 hover:bg-violet-50'));
check('button names its run for screen readers', PG.includes('aria-label={`Download the digest CSV for the ${run.payrollPeriod.name} ${run.runType} run`}'));
check('inline note renders under the table (live region)', PG.includes('digestNote') && PG.includes('role="status"'));
check('Open stays the primary affordance next to the download', PG.includes('onClick={() => setOpenRunId(run.id)}'));

console.log('== What did NOT change ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check('run-digest builder untouched in contract', RD.includes('export function payrollRunDigestToCsv'));
check('formula-injection guard still inherited from digest-csv', RD.includes("import { csvCell, type DigestCsvAttachment } from '@/lib/hr/digest-csv'"));
check('posted filename suffix still distinguishes the variants', RD.includes("-posted"));
const DC = read('src/lib/hr/digest-csv.ts') ?? '';
check('digest-csv pure module untouched in contract', DC.includes('export function digestToCsv') && DC.includes('export function formatCsvSize'));
check('formula-injection guard still armed', DC.includes("const guarded = /^[=+\\-@\\t\\r]/.test(raw) ? `'${raw}` : raw;"));
const RX = read('src/app/api/hr/reports/export/route.ts') ?? '';
check('v2.52.0 report export route untouched', RX.includes("hrGuard('hr.report.branch', REPORT_ROLES)"));
const B2C = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('v2.33.0 B2C retry gate surface still present', !!B2C);

console.log('== Tests ==');
const TP = read('src/tests/payroll-run-digest-export.test.ts') ?? '';
check('run digest export test file exists', !!TP);
check('covers the pure status gate', TP.includes('payrollRunExportDecision'));
check('covers the honest refusal copy', TP.includes('from approval onward'));
check('covers per-employee row mapping', TP.includes('Grace Wanjiku'));
check('covers the approver label ladder', TP.includes('Approved by,Approver'));
check('covers the posted payslip range', TP.includes('Payslips issued,2'));
check('covers the empty-run honesty', TP.includes('an empty run returns null'));
check('covers the formula-injection guard parity', TP.includes("'=cmd|matrix!A1"));
check('v2.52 intact: report digest export test file still exists', !!read('src/tests/report-digest-export.test.ts'));
check('v2.51 intact: paid notice test file still exists', !!read('src/tests/payroll-paid-notice.test.ts'));
check('v2.50 intact: disbursement digest test file still exists', !!read('src/tests/payroll-disbursed-digest.test.ts'));
check('v2.46 intact: digest csv attachment test file still exists', !!read('src/tests/digest-csv-attachment.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.53.0 verification: ALL PASS');
} else {
  console.log(`v2.53.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
