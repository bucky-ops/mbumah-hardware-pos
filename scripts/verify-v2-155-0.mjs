#!/usr/bin/env node
// v2.155.0 verification — "recovery that never sleeps".
// Fresh-written (lesson 25). Pins the B2C auto-recovery sweep (service,
// route, dispatcher fold, dialog truth line), the tabs contrast sweep's
// token families, and the release surfaces.

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
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

check("version: package.json leads 2.155.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.155.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.155.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.155.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-155-0"], "verify:v2-155-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.155.0] Recovery that never sleeps"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.155.0'"), "whats-new head missing");
  assert(feed.indexOf("2.155.0") < feed.indexOf("2.154.0"), "2.155.0 is not the feed head");
});

check("counters re-anchored (44/45/46/77)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(44)"), "2.110.0 anchor not 44");
  assert(t.includes("toBe(77)"), "2.77.0 anchor not 77");
});

check("the sweep service: pure selection, sentinel actor, per-run isolation", () => {
  const src = stripComments(read("src/lib/hr/payroll/b2c-recovery.ts"));
  assert(src.includes("export const B2C_RECOVERY_ACTOR_ID = 'system:b2c-recovery'"), "sentinel actor missing");
  assert(src.includes("export const B2C_RECOVERY_MAX_RUNS_PER_TICK = 25"), "tick cap missing");
  assert(src.includes("status: { in: ['POSTED', 'LOCKED'] }"), "run statuses not pinned");
  assert(src.includes("paidAt: null"), "unsettled filter missing");
  assert(src.includes("details: { some: { paymentStatus: 'PENDING', netPay: { gt: 0 } } }"), "unpaid-payslip candidate filter missing");
  assert(src.includes("p.lastStatus === 'FAILED' && !p.retryBlocked"), "gate-allowed selection missing");
  assert(src.includes("summary.staleProcessing > 0"), "stale trigger missing");
  assert(src.includes("BENIGN_CODES"), "benign-code set missing");
  assert(src.includes("'NOTHING_TO_RETRY', 'B2C_NOT_CONFIGURED'"), "benign codes incomplete");
  // no fake humans: the sentinel is the only actor the sweep ever sends
  assert(!/actorId:\s*(?!B2C_RECOVERY_ACTOR_ID)['"`]/.test(src), "a non-sentinel actorId snuck in");
});

check("mock discipline: unconfigured production early-outs before the database", () => {
  const src = stripComments(read("src/lib/hr/payroll/b2c-recovery.ts"));
  assert(src.includes("MPESA_B2C_ALLOW_MOCK === 'true'"), "mock opt-in check missing");
  assert(src.indexOf("if (!b2cRecoveryConfigured())") < src.indexOf("db.payrollRun.findMany"), "early-out is not before the DB query");
  const route = stripComments(read("src/app/api/cron/b2c-recovery/route.ts"));
  assert(route.includes("sweepStalledPayrollB2C()"), "route does not call the sweep");
  assert(route.includes("maxDuration = 60"), "route maxDuration missing");
});

check("the cron secret gate matches the sibling pattern", () => {
  const route = stripComments(read("src/app/api/cron/b2c-recovery/route.ts"));
  assert(route.includes("request.headers.get('x-cron-secret')"), "secret header not read");
  assert(route.includes("Forbidden: invalid or missing x-cron-secret header."), "403 body missing");
  assert(route.includes("CRON_SECRET env var is not set"), "fail-open WARN missing");
});

check("the hourly dispatcher folds the sweep in", () => {
  const d = stripComments(read("src/app/api/cron/hourly/route.ts"));
  assert(d.includes("import { GET as b2cRecoveryGET } from '@/app/api/cron/b2c-recovery/route'"), "import missing");
  assert(d.includes("{ name: 'b2c-recovery', run: () => b2cRecoveryGET(request) }"), "sub-job missing");
  // the fold order: the four prior sub-jobs are untouched and the sweep joins last
  assert(d.indexOf("'b2c-recovery'") > d.indexOf("'debt-reminders'"), "fold order disturbed");
});

check("the run dialog carries the auto-recovery truth line", () => {
  const d = stripComments(read("src/components/hr/payroll-run-dialog.tsx"));
  assert(d.includes('data-testid="b2c-auto-recovery-note"'), "truth line testid missing");
  assert(d.includes("Auto-recovery is on"), "truth line copy missing");
  assert(d.includes("text-[11px] leading-snug text-muted-foreground"), "truth line tokens off-family");
  // rendered only where the sweep can act
  const noteAt = d.indexOf('data-testid="b2c-auto-recovery-note"');
  const guard = d.lastIndexOf("(status === 'POSTED' || status === 'LOCKED') && can?.disburse", noteAt);
  assert(guard > 0 && guard < noteAt, "truth line not guarded by posted/locked + disburse");
});

check("the tabs contrast sweep: the new families are the only ones left", () => {
  // dark pair protection verified per lesson 66 - no doubled tokens
  for (const p of [
    "src/components/pos/dashboard-stats.tsx",
    "src/app/(shell)/tabs/transactions-tab.tsx",
    "src/app/(shell)/tabs/reports-tab.tsx",
    "src/app/(shell)/tabs/financial-tab.tsx",
    "src/app/(shell)/tabs/rentals-tab.tsx",
    "src/app/(shell)/tabs/gift-cards-tab.tsx",
    "src/app/(shell)/tabs/debt-plans-tab.tsx",
  ]) {
    const s = read(p);
    assert(!s.includes("text-green-600"), `${p} still has text-green-600`);
    assert(!s.includes("text-emerald-600"), `${p} still has text-emerald-600`);
    assert(!s.includes("text-sky-600"), `${p} still has text-sky-600`);
    assert(!s.includes("dark:text-green-700 dark:text-green-400") && !s.includes("dark:text-green-400 dark:text-green-700"), `${p} doubled green tokens`);
  }
  const stats = read("src/components/pos/dashboard-stats.tsx");
  assert(stats.includes("text-green-700 dark:text-green-400"), "KPI trend family not on green-700");
  const dialog = read("src/components/hr/payroll-run-dialog.tsx");
  assert(dialog.includes("bg-emerald-700 text-white hover:bg-emerald-800"), "disburse fill not deepened");
  assert(dialog.includes("dark:bg-emerald-700 dark:hover:bg-emerald-600"), "dark hover semantics lost");
  const plans = read("src/app/(shell)/tabs/debt-plans-tab.tsx");
  assert(!plans.includes("text-muted-foreground/70"), "debt-plans /70 tokens remain");
  assert(plans.includes("from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"), "Create Plan gradient not deepened");
  const heatmap = read("src/components/analytics/hourly-heatmap.tsx");
  assert(heatmap.includes("dark:bg-emerald-600/60"), "heatmap dark cell token disturbed");
});

check("the lifecycle doc carries the new contracts", () => {
  const doc = read("docs/payroll-run-lifecycle.md");
  assert(doc.includes("## The B2C auto-recovery contract (v2.155.0)"), "recovery contract missing");
  assert(doc.includes("## The tabs contrast sweep (v2.155.0)"), "tabs sweep contract missing");
  assert(doc.includes("## The branches CSV contract (v2.152.0 + v2.154.0)"), "CSV contract missing");
  assert(doc.includes("system:b2c-recovery"), "sentinel not documented");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
