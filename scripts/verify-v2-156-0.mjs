#!/usr/bin/env node
// v2.156.0 verification — "the amber family settles".
// Fresh-written (lesson 25). Pins the amber/muted-alpha token families from
// the lesson-64 re-audit, the restored forbidden-token pins, and the
// reanchor script's own contract.

import { readFileSync, readdirSync, statSync } from 'node:fs';
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
const globLike = (dir) => {
  // minimal recursive walk for the token census (no external deps)
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(tsx?|ts)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
};

check("version: package.json leads 2.156.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.156.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.156.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.156.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-156-0"], "verify:v2-156-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.156.0] The amber family settles"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.156.0'"), "whats-new head missing");
  assert(feed.indexOf("2.156.0") < feed.indexOf("2.155.0"), "2.156.0 is not the feed head");
});

check("counters re-anchored (45/46/47/78)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(45)"), "2.110.0 anchor not 45");
  assert(t.includes("toBe(78)"), "2.77.0 anchor not 78");
});

check("the amber family: zero light-mode amber-600 text tokens remain", () => {
  const files = globLike("src/app").concat(globLike("src/components"));
  let strays = 0;
  for (const p of files) {
    const s = read(p);
    const n = (s.match(/(^|[^:-])text-amber-600/g) ?? []).length;
    if (n) { strays += n; console.log(`       stray in ${p}: ${n}`); }
  }
  assert(strays === 0, `${strays} text-amber-600 strays remain`);
  // the flagged nodes' new tokens
  const txn = read("src/app/(shell)/tabs/transactions-tab.tsx");
  assert(txn.includes("text-amber-700 dark:text-amber-400"), "transactions amber pair missing");
  const gift = read("src/app/(shell)/tabs/gift-cards-tab.tsx");
  assert(!gift.includes("text-amber-600"), "gift-cards amber-600 remains");
});

check("the muted alphas: /60 and /70 helper lines are full-strength", () => {
  const files = globLike("src/app").concat(globLike("src/components"));
  let strays = 0;
  for (const p of files) {
    const s = read(p);
    strays += (s.match(/text-muted-foreground\/6[0]/g) ?? []).length;
    strays += (s.match(/text-muted-foreground\/7[0]/g) ?? []).length;
  }
  assert(strays === 0, `${strays} muted /60 //70 strays remain`);
  const plans = read("src/components/debt-plans/plans-stats-cards.tsx");
  assert(plans.includes('className="text-[10px] text-muted-foreground truncate"'), "plans card label not full-strength");
});

check("dark pairs survived (lesson 66)", () => {
  const heatmap = read("src/components/analytics/hourly-heatmap.tsx");
  assert(heatmap.includes("dark:bg-emerald-600/60"), "heatmap dark token disturbed");
  const dialog = read("src/components/hr/payroll-run-dialog.tsx");
  assert(dialog.includes("dark:hover:bg-emerald-600"), "run-dialog dark hover disturbed");
  // no doubled tokens in either order
  for (const p of ["src/app/(shell)/tabs/transactions-tab.tsx", "src/app/(shell)/tabs/gift-cards-tab.tsx"]) {
    const s = read(p);
    assert(!s.includes("dark:text-amber-700 dark:text-amber-400") && !s.includes("dark:text-amber-400 dark:text-amber-700"), `${p} doubled amber`);
  }
});

check("prior-round pins forbid the OLD tokens (restored, stronger)", () => {
  const v2149 = read("src/tests/console-org-v2149.test.ts");
  assert(v2149.includes("expect(org().match(/text-amber-600/g)?.length ?? 0).toBe(0);"), "v2149 amber pin not restored");
  const v2153 = read("src/tests/console-org-v2153.test.ts");
  assert(v2153.includes("(^|[^:-])text-amber-600"), "v2153 amber regex pin not restored");
  const v2154 = read("src/tests/console-org-v2154.test.ts");
  assert(v2154.includes("not.toContain('text-muted-foreground/70')"), "v2154 muted pin not restored");
});

check("the reanchor script is committed and speaks its contract", () => {
  const s = read("scripts/reanchor-head-pins.mjs");
  assert(s.includes("node scripts/reanchor-head-pins.mjs <newVersion> <oldVersion>"), "usage line missing");
  assert(s.includes("SUITES"), "suite list missing");
  assert(s.includes("console-changelog.test.ts"), "counter file not in contract");
});

check("the lifecycle doc carries the amber family contract", () => {
  const doc = read("docs/payroll-run-lifecycle.md");
  assert(doc.includes("## The amber + muted-alpha families (v2.156.0)"), "amber contract missing");
  assert(doc.includes("census-before-sweep"), "ritual not documented");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
