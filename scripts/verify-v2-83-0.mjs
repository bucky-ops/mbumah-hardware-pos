#!/usr/bin/env node
// verify-v2-83-0.mjs — release gate for "the run hands every slip over".
//
// Contracts locked:
//   1. Version slots: package.json 2.83.0 (3 slots) + verify script
//      registered; What's-New 2.83.0 leads the feed.
//   2. The zip writer: zero-dependency STORE writer with the IEEE CRC-32
//      table, DOS date/time packer, flat-ASCII name sanitizer, duplicate +
//      empty + oversize refusals, and an explicitly passed clock (no hidden
//      Date.now()).
//   3. The bundle module: EAT-wall filename stamp, manifest in the shared
//      csvCell voice, defensive entry-name dedupe.
//   4. The route: per-payslip PDF's guard/roles/masking pipeline, branch
//      scoping on run AND details, honest NO_PAYSLIPS refusal, manifest
//      first inside the zip, audit-logged export.
//   5. The view: the filing row carries the bundle door beside the digest
//      CSV door — violet family, count label, in-flight honesty, note
//      reset with the run.
//   6. Prior anchors: the desk report's filing surfaces untouched.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.83.0', atLeast(PKG.version, '2.83.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.83.0', atLeast(PKG.mbumah?.releaseVersion, '2.83.0'));
check('mbumah.baseVersion is >= 2.83.0', atLeast(PKG.mbumah?.baseVersion, '2.83.0'));
check('verify:v2-83-0 script registered', PKG.scripts?.['verify:v2-83-0'] === 'node scripts/verify-v2-83-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.83.0 entry first', WN.includes("version: '2.83.0'") && WN.indexOf("version: '2.83.0'") < WN.indexOf("version: '2.82.0'"));
check('whats-new leads with the bundle story', WN.includes('The run hands every slip over') && WN.includes('Payslip bundle (N)') && WN.includes('_MANIFEST.csv'));
check('whats-new feed has grown to 83+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 83);

console.log('== Zip writer (pure) ==');
const ZIP = read('src/lib/hr/payroll/zip-store.ts') ?? '';
check('crc32 table rides the IEEE polynomial', ZIP.includes('0xedb88320'));
check('the writer emits STORE (method 0) and no flags', ZIP.includes('view.setUint16(offset, 0, true); offset += 2;          // flags') && ZIP.includes('view.setUint16(offset, 0, true); offset += 2;          // method: STORE'));
check('the three signatures are written', ZIP.includes('0x04034b50') && ZIP.includes('0x02014b50') && ZIP.includes('0x06054b50'));
check('names are sanitized flat-ASCII', ZIP.includes('export function sanitizeZipEntryName') && ZIP.includes("[^\\x20-\\x7E]"));
check('the writer refuses empty archives and duplicate names', ZIP.includes('empty archive is never a useful download') && ZIP.includes('duplicate entry name'));
check('the clock is a parameter, never Date.now()', !ZIP.includes('Date.now()') && ZIP.includes('export function buildStoreZip(files: ZipEntryInput[], now: Date): Uint8Array'));
check('ZIP64 limits are guarded, not assumed', ZIP.includes('too many entries (ZIP64 required)') && ZIP.includes('exceeds the 4 GiB entry limit'));

console.log('== Bundle module (pure) ==');
const BUNDLE = read('src/lib/hr/payroll/payslip-bundle.ts') ?? '';
check('filename stamps period + run type + EAT wall day', BUNDLE.includes('mbumah-payslips-') && BUNDLE.includes('3 * 60 * 60 * 1000'));
check('the manifest rides the shared csvCell escaper', BUNDLE.includes("import { csvCell } from '@/lib/hr/digest-csv'"));
check('the manifest voice names the bundle', BUNDLE.includes("'Report'") && BUNDLE.includes("'Payslip bundle'") && BUNDLE.includes("'Net (KES)'"));
check('entry names dedupe defensively', BUNDLE.includes('bundleEntryFilenames') && BUNDLE.includes('-${count + 1}'));
check('CRLF framing ends the manifest honestly', BUNDLE.includes("lines.join('\\r\\n') + '\\r\\n'"));

console.log('== Route ==');
const ROUTE = read('src/app/api/payroll/runs/[id]/payslips-bundle/route.ts') ?? '';
check('route exists and is force-dynamic', ROUTE.length > 0 && ROUTE.includes("export const dynamic = 'force-dynamic';"));
check('same guard + roles as the PDF route', ROUTE.includes("hrGuard('hr.payroll.read.all'") && ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"));
check('branch-scoped on the run AND the details', (ROUTE.match(/storeId: session\.storeId \|\| ''/g) || []).length >= 2);
check('honest refusal when no payslips exist', ROUTE.includes("code: 'NO_PAYSLIPS'") && ROUTE.includes('This run has no payslips yet'));
check('every slip rides buildPayslipView → buildPayslipPdf', ROUTE.includes('buildPayslipView({') && ROUTE.includes('buildPayslipPdf(view)'));
check('PII masking decided server-side only', ROUTE.includes("hasHrPermission(session.role, 'hr.employee.unmask.pii')"));
check('the manifest is the first zip entry', ROUTE.indexOf("{ name: '_MANIFEST.csv'") > -1 && ROUTE.indexOf("{ name: '_MANIFEST.csv'") < ROUTE.indexOf('...entries.map'));
check('the export is audit-logged', ROUTE.includes("action: 'PAYROLL_RUN_BUNDLE_EXPORTED'") && ROUTE.includes('HrEntityType.DATA_EXPORT'));
check('download headers: zip attachment + honest filename header', ROUTE.includes("'Content-Type': 'application/zip'") && ROUTE.includes('X-Payroll-Bundle-Filename') && ROUTE.includes("'Cache-Control': 'no-store'"));
check('deterministic slip order (issued first, then id)', ROUTE.includes('.payslipNumber.localeCompare(') && ROUTE.includes('a.id.localeCompare(b.id)'));

console.log('== View (filing row) ==');
const DIALOG = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
const HELPER = read('src/components/hr/payslip-bundle-download.ts') ?? '';
check('the dialog imports the bundle helper and the archive icon', DIALOG.includes("import { downloadPayrollBundle } from '@/components/hr/payslip-bundle-download';") && DIALOG.includes('FileArchive'));
check('the bundle door sits beside the digest CSV door', DIALOG.indexOf('aria-label="Download the digest CSV for this run"') > -1 && DIALOG.indexOf('Download every payslip in this run as a zip bundle') > DIALOG.indexOf('aria-label="Download the digest CSV for this run"'));
check('the door wears the violet filing family with full dark variants', (DIALOG.match(/dark:hover:bg-violet-950\/40 dark:hover:text-violet-200/g) || []).length >= 2);
check('the count label names the slips it zips', DIALOG.includes('`Payslip bundle (${payslips?.length ?? 0})`'));
check('in-flight honesty: Zipping… with the spinner', DIALOG.includes("{bundleBusy ? <Loader2 className=\"h-3.5 w-3.5 animate-spin\" /> : <FileArchive className=\"h-3.5 w-3.5\" />}") && DIALOG.includes("bundleBusy ? 'Zipping…'"));
check('the door only renders when slips exist', DIALOG.includes('(payslips?.length ?? 0) > 0 && ('));
check('the note resets with the run and renders the violet family', DIALOG.includes('setBundleNote(null);\n      void load(runId);') && DIALOG.includes("bundleNote.tone === 'ok'") && DIALOG.includes("bundleNote.text"));
check('the client helper honours the server filename', HELPER.includes('X-Payroll-Bundle-Filename') && HELPER.includes("match(/filename=\"([^\"]+)\"/)"));

console.log('== Prior anchors ==');
const DESK_REPORT = read('src/lib/hr/desk-report.ts') ?? '';
const DESK_VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('desk report ledger filing untouched (v2.82 anchor)', DESK_REPORT.includes('deskReportLedgerToCsv') && DESK_REPORT.includes('deskReportFileStamp'));
check('desk view file-all door untouched (v2.82 anchor)', DESK_VIEW.includes('desk-report-file-all') && DESK_VIEW.includes('FileStack'));
check('run dialog lifecycle actions untouched', DIALOG.includes("<Play className=\"h-3.5 w-3.5\" />") && DIALOG.includes('Post journal') && DIALOG.includes('Disburse via M-Pesa'));

console.log(`\nv2.83.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILED'} (${pass} pass, ${fail} fail)`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
