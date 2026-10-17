#!/usr/bin/env node
// v2.86.0 verification — "the handover names its waiter".
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
const WN = read('src/lib/whats-new.ts');
const LIST_ROUTE = read('src/app/api/payroll/runs/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const DIALOG = read('src/components/hr/payroll-run-dialog.tsx');
const BUILDER = read('src/lib/hr/payroll/run-history.ts');
const SERVICE = read('src/lib/hr/payroll/run-service.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.86.0', () => {
  assert(atLeast(PKG.version, '2.86.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.86.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.86.0'), 'baseVersion');
});

// ── 2. What's-New 2.86.0 leads the feed ─────────────────────────────────────
check("What's-New 2.86.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.86.0'");
  assert(at > -1, '2.86.0 entry missing');
  assert(at < WN.indexOf("version: '2.85.0'"), '2.86.0 does not lead');
  assert(/names its waiter/.test(WN), 'title missing');
  assert(/waiting on/i.test(WN), 'waiting-on bullet missing');
  assert(/waiting since/.test(WN), 'waiting-since bullet missing');
});

// ── 3. List route: additive handover stamps ─────────────────────────────────
check('list route exposes submittedAt/submittedById additively', () => {
  assert(LIST_ROUTE.includes('submittedAt: r.submittedAt?.toISOString() ?? null,'), 'submittedAt missing');
  assert(LIST_ROUTE.includes('submittedById: r.submittedById,'), 'submittedById missing');
  assert(LIST_ROUTE.includes('return Response.json({ success: true, data });'), 'response shape changed');
  assert(LIST_ROUTE.includes('v2.86.0'), 'comment missing');
});

// ── 4. Runs table: waiting-since microcopy ──────────────────────────────────
check('runs table wears the waiting-since EAT on waiting rows', () => {
  assert(PAGE.includes("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';"), 'EAT import missing');
  assert(PAGE.includes("run.status === 'PENDING_APPROVAL' && run.submittedAt && ("), 'gate missing');
  assert(PAGE.includes('waiting since {formatEatStamp(new Date(run.submittedAt))}'), 'microcopy missing');
  assert(PAGE.includes('data-testid="payroll-run-waiting-since"'), 'testid missing');
  assert(PAGE.includes('submittedAt: string | null;') && PAGE.includes('submittedById: string | null;'), 'Dto fields missing');
  // Honest: non-waiting rows stay untouched (gate is PENDING_APPROVAL-only).
  assert(!/status === 'POSTED'[\s\S]{0,80}waiting-since/.test(PAGE), 'microcopy leaks past PENDING_APPROVAL');
});

// ── 5. Dialog: the who's-next strip ─────────────────────────────────────────
check('dialog strip sits between the actions and the filing row', () => {
  const stripAt = DIALOG.indexOf('data-testid="payroll-run-waiting-on"');
  const actionsAt = DIALOG.indexOf("void act('void')");
  const filingAt = DIALOG.indexOf('v2.53.0: filing row');
  assert(stripAt > -1, 'strip missing');
  assert(stripAt > actionsAt, 'strip not after actions');
  assert(stripAt < filingAt, 'strip not before filing row');
});

check('strip reads the three seats from the history facts', () => {
  assert(DIALOG.includes("const submittedEvent = history.find((e) => e.key === 'submitted');"), 'derivation missing');
  assert(DIALOG.includes('const canWaitOnYou = Boolean(can?.approve && !can?.isPreparer);'), 'seat logic missing');
  assert(DIALOG.includes('Waiting on <span className="font-semibold">you</span>{handedPhrase}'), 'eligible-checker copy missing');
  assert(DIALOG.includes('Maker-checker: you prepared or submitted this run, so approval must come from a different user{handedPhrase}.'), 'bound-maker copy missing');
  assert(DIALOG.includes('Waiting on an approver{handedPhrase}.'), 'spectator copy missing');
  assert(DIALOG.includes('` — handed over by ${submittedBy}${submittedWhen}`'), 'handed-by phrase missing');
});

check('strip styling: indigo / amber / muted, light and dark', () => {
  assert(DIALOG.includes('border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300'), 'indigo family missing');
  assert(DIALOG.includes('border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'), 'amber family missing');
  assert(DIALOG.includes("'border-border bg-muted/40 text-muted-foreground'"), 'muted family missing');
  assert(DIALOG.includes('<Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />'), 'icon missing');
});

check('strip never invents a wait; the old standalone note is superseded', () => {
  assert(DIALOG.includes("status === 'PENDING_APPROVAL' && submittedEvent && ("), 'gate missing');
  assert(!DIALOG.includes('so approval must come from a\n                  different user'), 'old note still present');
  assert(DIALOG.includes("submittedEvent?.actorLabel && submittedEvent.actorLabel !== '—' ? submittedEvent.actorLabel : null"), 'actor floor missing');
});

// ── 6. Prior anchors (the released surfaces stay put) ───────────────────────
check('v2.85.0 handover: indigo dot, count chip, maker-checker either-stamp', () => {
  assert(DIALOG.includes("submitted: 'bg-indigo-500 dark:bg-indigo-400',"), 'handover dot drifted');
  assert(DIALOG.includes('data-testid="payroll-run-history-count"'), 'count chip drifted');
  assert(SERVICE.includes('run.submittedById === ctx.actorId'), 'maker-checker submitter bound drifted');
  assert(BUILDER.includes("label: 'Submitted for approval'"), 'builder event drifted');
});

check('v2.84.0 history door: EAT clock, placement, connector intact', () => {
  assert(DIALOG.includes("event.atIso ? formatEatStamp(new Date(event.atIso)) : 'no timestamp recorded'"), 'EAT clock drifted');
  const historyAt = DIALOG.indexOf('data-testid="payroll-run-history"');
  const gateAt = DIALOG.indexOf('{/* Gate issues */}');
  assert(historyAt > -1 && gateAt > historyAt, 'placement drifted');
  assert(DIALOG.includes('{i < history.length - 1 && ('), 'connector drifted');
});

check('v2.83.0 bundle door stays beside the digest CSV', () => {
  assert(DIALOG.includes("import { downloadPayrollBundle } from '@/components/hr/payslip-bundle-download';"), 'bundle door drifted');
  assert(DIALOG.includes('One zip, every payslip in this run'), 'bundle note drifted');
});

check('desk-report family stays archived (v2.82 anchors)', () => {
  const LEDGER = read('src/lib/hr/desk-report.ts');
  assert(LEDGER.includes('deskReportRequestLedger'), 'ledger builder missing');
});

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nv2.86.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
