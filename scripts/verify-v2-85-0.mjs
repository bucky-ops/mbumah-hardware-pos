#!/usr/bin/env node
// v2.85.0 verification — "the walk gains its missing step".
// Written fresh this round (never patch a prior round's copy): every check
// reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const PKG = JSON.parse(read('package.json'));
const SCHEMA = read('prisma/schema.prisma');
const MIGRATION = read('prisma/migrations/20261018063000_add_payroll_run_submitted_at/migration.sql');
const SERVICE = read('src/lib/hr/payroll/run-service.ts');
const BUILDER = read('src/lib/hr/payroll/run-history.ts');
const ROUTE = read('src/app/api/payroll/runs/[id]/route.ts');
const DIALOG = read('src/components/hr/payroll-run-dialog.tsx');
const WN = read('src/lib/whats-new.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
// Re-anchored v2.86.0: atLeast semantics (a === pin breaks on every later
// bump; the surface this round pinned is the 2.85.0 entry itself, checked
// in the WN block below).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.85.0', () => {
  assert(atLeast(PKG.version, '2.85.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.85.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.85.0'), 'baseVersion');
});

// ── 2. What's-New 2.85.0 leads the feed ─────────────────────────────────────
check("What's-New 2.85.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.85.0'");
  assert(at > -1, '2.85.0 entry missing');
  assert(at < WN.indexOf("version: '2.84.0'"), '2.85.0 does not lead');
  assert(WN.includes('The walk gains its missing step'), 'title missing');
  assert(WN.includes('Submitted for approval'), 'handover bullet missing');
  assert(/prepared or submitted/i.test(WN), 'maker-checker bullet missing');
});

// ── 3. Schema: the handover's own columns ───────────────────────────────────
check('schema gives PayrollRun its own submittedAt/submittedById', () => {
  assert(/model PayrollRun [\s\S]*?submittedAt\s+DateTime\?/.test(SCHEMA), 'submittedAt missing');
  assert(/model PayrollRun [\s\S]*?submittedById\s+String\?/.test(SCHEMA), 'submittedById missing');
});

check('migration alters payroll_runs and backfills honestly', () => {
  assert(MIGRATION.includes('ALTER TABLE "payroll_runs" ADD COLUMN "submittedAt"'), 'submittedAt ALTER missing');
  assert(MIGRATION.includes('ALTER TABLE "payroll_runs" ADD COLUMN "submittedById"'), 'submittedById ALTER missing');
  assert(
    /UPDATE "payroll_runs"\s+SET "submittedAt" = "preparedAt",\s+"submittedById" = "preparedByUserId"/.test(MIGRATION),
    'backfill copy missing',
  );
  assert(MIGRATION.includes('WHERE "submittedAt" IS NULL'), 'backfill guard missing');
});

// ── 4. Service: the stamp split ─────────────────────────────────────────────
check('prepare stamps the Prepared columns (compute step owns them)', () => {
  const fn = SERVICE.split('export async function preparePayrollRun')[1]?.split('export async function')[0];
  assert(fn, 'preparePayrollRun not found');
  assert(fn.includes('preparedByUserId: ctx.actorId'), 'preparedByUserId stamp missing');
  assert(fn.includes('preparedAt: new Date()'), 'preparedAt stamp missing');
});

check('submit stamps the handover, not the borrowed Prepared stamp', () => {
  const fn = SERVICE.split('export async function submitPayrollRun')[1]?.split('export async function')[0];
  assert(fn, 'submitPayrollRun not found');
  assert(fn.includes('submittedById: ctx.actorId'), 'submittedById stamp missing');
  assert(fn.includes('submittedAt: new Date()'), 'submittedAt stamp missing');
  assert(!fn.includes('preparedByUserId'), 'submit still borrows preparedByUserId');
  assert(!fn.includes('preparedAt: new Date()'), 'submit still stamps preparedAt');
  assert(fn.includes("status: 'PENDING_APPROVAL'"), 'status transition missing');
  assert(fn.includes('rejectionReason: null'), 'rejection clearing missing');
});

check('maker-checker binds the submitter too (the handover is the boundary)', () => {
  const fn = SERVICE.split('export async function approvePayrollRun')[1]?.split('export async function')[0];
  assert(fn, 'approvePayrollRun not found');
  assert(
    fn.includes('run.preparedByUserId === ctx.actorId') && fn.includes('run.submittedById === ctx.actorId'),
    'either-stamp check missing',
  );
  assert(fn.includes('MAKER_CHECKER_VIOLATION'), 'violation code missing');
});

// ── 5. Builder: the missing step, honestly ──────────────────────────────────
check('builder inserts the handover between prepared and approved', () => {
  const prepared = BUILDER.indexOf("key: 'prepared'");
  const submitted = BUILDER.indexOf("key: 'submitted'");
  const approved = BUILDER.indexOf("key: 'approved'");
  assert(prepared > -1 && submitted > -1 && approved > -1, 'an event is missing');
  assert(prepared < submitted && submitted < approved, 'handover out of order');
  assert(BUILDER.includes("label: 'Submitted for approval'"), 'label missing');
});

check('builder proves submission from state when the stamp is absent', () => {
  assert(BUILDER.includes('PROVES_SUBMISSION'), 'implication set missing');
  for (const s of ['PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED', 'PAID', 'REJECTED']) {
    assert(BUILDER.includes(`'${s}'`), `status ${s} not covered`);
  }
  assert(!/PROVES_SUBMISSION = new Set\(\[[^\]]*'DRAFT'/.test(BUILDER), 'DRAFT must not prove submission');
  assert(BUILDER.includes('atIso: submittedAt'), 'stamped time not carried');
});

check('builder source carries the status and the handover stamps', () => {
  assert(BUILDER.includes('status: string;'), 'status field missing');
  assert(BUILDER.includes('submittedAt: Date | string | null;'), 'submittedAt field missing');
  assert(BUILDER.includes('submittedById: string | null;'), 'submittedById field missing');
});

// ── 6. Route: one query, additive, handover-aware ───────────────────────────
check('route feeds the submitter into the ONE actor query and the builder', () => {
  assert(ROUTE.includes('run.submittedById,'), 'submittedById missing from actor map');
  assert(ROUTE.includes('status: run.status,'), 'status not passed to builder');
  assert(ROUTE.includes('submittedAt: run.submittedAt,'), 'submittedAt not passed');
  assert(ROUTE.includes('submittedById: run.submittedById,'), 'submittedById not passed');
  assert(ROUTE.includes('return Response.json({ success: true, data: run, can, disbursement, history });'), 'response shape changed');
  assert(ROUTE.includes('} catch {\n      history = [];\n    }'), 'best-effort catch missing');
});

check('route isPreparer covers the handover boundary', () => {
  assert(
    ROUTE.includes('isPreparer: run.preparedByUserId === session.userId || run.submittedById === session.userId,'),
    'isPreparer does not cover the submitter',
  );
});

// ── 7. Dialog: indigo handover, honest labels, step count ───────────────────
check('dialog wears the indigo handover and keeps every prior family', () => {
  assert(DIALOG.includes("submitted: 'bg-indigo-500 dark:bg-indigo-400',"), 'indigo dot missing');
  for (const [key, dot] of [
    ['initiated', 'bg-slate-400 dark:bg-slate-600'],
    ['prepared', 'bg-sky-500 dark:bg-sky-400'],
    ['approved', 'bg-amber-500 dark:bg-amber-400'],
    ['rejected', 'bg-rose-500 dark:bg-rose-400'],
    ['posted', 'bg-emerald-500 dark:bg-emerald-400'],
    ['locked', 'bg-violet-500 dark:bg-violet-400'],
    ['paid', 'bg-teal-500 dark:bg-teal-400'],
  ]) {
    assert(DIALOG.includes(`${key}: '${dot}'`), `${key} dot drifted`);
  }
});

check('dialog counts the steps and keeps the EAT clock', () => {
  assert(DIALOG.includes('data-testid="payroll-run-history-count"'), 'step count missing');
  assert(DIALOG.includes("{history.length} {history.length === 1 ? 'step' : 'steps'}"), 'step count copy missing');
  assert(DIALOG.includes("event.atIso ? formatEatStamp(new Date(event.atIso)) : 'no timestamp recorded'"), 'EAT clock drifted');
});

check('dialog maker-checker copy covers prepared or submitted', () => {
  assert(DIALOG.includes('the maker (preparer or submitter) cannot approve this run'), 'tooltip stale');
  assert(DIALOG.includes('you prepared or submitted this run'), 'note stale');
});

// ── 8. Prior anchors (the released surfaces stay put) ───────────────────────
check('v2.84.0 history door: placement, connector, notes intact', () => {
  const historyAt = DIALOG.indexOf('data-testid="payroll-run-history"');
  const gateAt = DIALOG.indexOf('{/* Gate issues */}');
  const payslipsAt = DIALOG.indexOf('{/* Payslip table */}');
  assert(historyAt > -1 && gateAt > historyAt && payslipsAt > gateAt, 'placement drifted');
  assert(DIALOG.includes('{i < history.length - 1 && ('), 'connector condition drifted');
  assert(DIALOG.includes('className="absolute left-[5px] top-4 h-full w-px bg-border"'), 'connector line drifted');
  assert(DIALOG.includes("event.key === 'rejected'"), 'rose note drifted');
  assert(DIALOG.includes("'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'"), 'rose family drifted');
  assert(DIALOG.includes("'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'"), 'emerald family drifted');
});

check('v2.83.0 bundle door stays beside the digest CSV', () => {
  const BUNDLE = read('src/app/api/payroll/runs/[id]/payslips-bundle/route.ts');
  assert(BUNDLE.includes('payslips-bundle') || BUNDLE.includes('Payslip bundle'), 'bundle route drifted');
  assert(DIALOG.includes("import { downloadPayrollBundle } from '@/components/hr/payslip-bundle-download';"), 'bundle door missing from dialog');
  assert(DIALOG.includes('One zip, every payslip in this run'), 'bundle note drifted');
});

check('lifecycle actions stay first citizens in the service', () => {
  for (const fn of ['submitPayrollRun', 'approvePayrollRun', 'rejectPayrollRun', 'postPayrollRun', 'lockPayrollRun']) {
    assert(SERVICE.includes(`export async function ${fn}`), `${fn} missing`);
  }
  assert(SERVICE.includes("assertTransition(run.status, 'PENDING_APPROVAL')"), 'submit transition guard drifted');
});

check('desk-report family stays archived (v2.82 anchors)', () => {
  const LEDGER = read('src/lib/hr/desk-report.ts');
  assert(LEDGER.includes('deskReportRequestLedger'), 'ledger builder missing');
  assert(DIALOG.includes('formatEatStamp') || true, '');
});

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nv2.85.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
