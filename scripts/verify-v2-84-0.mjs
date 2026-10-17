#!/usr/bin/env node
// verify-v2-84-0.mjs — release gate for "the run remembers its own steps".
//
// Contracts locked:
//   1. Version slots: package.json 2.84.0 (3 slots) + verify script
//      registered; What's-New 2.84.0 leads the feed.
//   2. The pure builder: lifecycle-ordered events, stamped-facts-only
//      honesty (rejection exception), actor ladder floor, garbage-timestamp
//      tolerance.
//   3. The route: ONE actor query, all six actor fields, journal entry
//      number handed over, additive response shape, best-effort catch.
//   4. The view: the timeline sits between the action bar and the payslips,
//      EAT stamps via the shared builder, per-event family dots, connector
//      lines only between events, rose rejection note / emerald journal
//      note, null-safe + hidden-when-empty.
//   5. Prior anchors: v2.83.0 bundle surfaces untouched; the lifecycle
//      actions stay the dialog's first citizens.

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
check('package.json version is >= 2.84.0', atLeast(PKG.version, '2.84.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.84.0', atLeast(PKG.mbumah?.releaseVersion, '2.84.0'));
check('mbumah.baseVersion is >= 2.84.0', atLeast(PKG.mbumah?.baseVersion, '2.84.0'));
check('verify:v2-84-0 script registered', PKG.scripts?.['verify:v2-84-0'] === 'node scripts/verify-v2-84-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.84.0 entry first', WN.includes("version: '2.84.0'") && WN.indexOf("version: '2.84.0'") < WN.indexOf("version: '2.83.0'"));
check('whats-new leads with the run-history story', WN.includes('The run remembers its own steps') && WN.includes('no timestamp recorded'));
check('whats-new feed has grown to 84+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 84);

console.log('== Pure builder ==');
const HIST = read('src/lib/hr/payroll/run-history.ts') ?? '';
check('builder exists and is pure', HIST.includes('export function buildRunHistory(run: RunHistorySource, actors: Record<string, string>)'));
check('lifecycle order: initiated → prepared → approved → rejected → posted → locked → paid', HIST.indexOf("'initiated'") < HIST.indexOf("'prepared'") && HIST.indexOf("'prepared'") < HIST.indexOf("'approved'") && HIST.indexOf("'approved'") < HIST.indexOf("'rejected'") && HIST.indexOf("'rejected'") < HIST.indexOf("'posted'") && HIST.indexOf("'posted'") < HIST.indexOf("'locked'") && HIST.indexOf("'locked'") < HIST.indexOf("'paid'"));
check('stamped facts only: unstamped steps are left out', HIST.includes('const postedAt = iso(run.postedAt);\n  if (postedAt)'));
check('the rejection rides with who + why and an explicit null stamp', HIST.includes('atIso: null, // the schema stamps who and why, never when') && HIST.includes('Reason: ${run.rejectionReason}'));
check('the actor ladder floors at Unknown user', HIST.includes("'Unknown user'"));
check('garbage timestamps are dropped, not thrown', HIST.includes('Number.isNaN(d.getTime()) ? null : d.toISOString()'));
check('the posted step names its journal entry', HIST.includes('Journal entry ${run.journalEntryNumber}'));

console.log('== Route ==');
const ROUTE = read('src/app/api/payroll/runs/[id]/route.ts') ?? '';
check('the detail route imports the pure builder', ROUTE.includes("import { buildRunHistory } from '@/lib/hr/payroll/run-history';"));
check('ONE actor query feeds the map', ROUTE.includes('db.user.findMany({') && ROUTE.includes('where: { id: { in: actorIds } }') && (ROUTE.match(/db\.user\.findMany/g) || []).length === 1);
check('all six lifecycle actor fields feed the map', ['initiatedBy', 'preparedByUserId', 'approvedByUserId', 'rejectedByUserId', 'postedByUserId', 'lockedByUserId'].every((f) => ROUTE.includes(`run.${f}`)));
check('the journal entry number rides to the builder', ROUTE.includes('journalEntryNumber: run.journalEntry?.entryNumber ?? null'));
check('the response stays additive', ROUTE.includes('return Response.json({ success: true, data: run, can, disbursement, history });'));
check('best-effort: a history failure never degrades the run view', ROUTE.includes('} catch {\n      history = [];\n    }'));
check('no new visibility: the guard and roles are untouched', ROUTE.includes("hrGuard('hr.payroll.read.all'") && ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const"));

console.log('== View (timeline) ==');
const DIALOG = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('the dialog types the additive history block', DIALOG.includes('history?: RunHistoryEvent[]'));
check('the timeline sits between the action bar and the payslips', DIALOG.indexOf('data-testid="payroll-run-history"') > -1 && DIALOG.indexOf('data-testid="payroll-run-history"') < DIALOG.indexOf('{/* Gate issues */}'));
check('the heading is "Run history" with the History icon', DIALOG.includes('<History className="h-3.5 w-3.5" /> Run history'));
check('every stamp is EAT via the shared builder', DIALOG.includes("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';") && DIALOG.includes("event.atIso ? formatEatStamp(new Date(event.atIso)) : 'no timestamp recorded'"));
check('per-event family dots (rose rejection, violet lock, emerald post)', DIALOG.includes('HISTORY_DOT_STYLES[event.key]') && DIALOG.includes('bg-rose-500 dark:bg-rose-400') && DIALOG.includes('bg-violet-500 dark:bg-violet-400') && DIALOG.includes('bg-emerald-500 dark:bg-emerald-400'));
check('the connector line renders only between events', DIALOG.includes('{i < history.length - 1 && ('));
check('the rejection note wears the rose family', DIALOG.includes("event.key === 'rejected'") && DIALOG.includes("'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'"));
check('the timeline is null-safe and hides when empty', DIALOG.includes('const history = detail?.history ?? [];') && DIALOG.includes('{history.length > 0 && ('));

console.log('== Prior anchors ==');
check('the v2.83.0 bundle door is untouched', DIALOG.includes('`Payslip bundle (${payslips?.length ?? 0})`') && DIALOG.includes('downloadPayrollBundle'));
check('the lifecycle actions stay first citizens', DIALOG.includes('Prepare payslips') && DIALOG.includes('Post journal') && DIALOG.includes('Disburse via M-Pesa'));
check('the v2.83.0 route surfaces are untouched', (read('src/app/api/payroll/runs/[id]/payslips-bundle/route.ts') ?? '').includes("code: 'NO_PAYSLIPS'"));
check('the desk-report family stays archived (v2.82 anchors)', (read('src/lib/hr/desk-report.ts') ?? '').includes('deskReportFileStamp'));

console.log(`\nv2.84.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILED'} (${pass} pass, ${fail} fail)`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
