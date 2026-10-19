#!/usr/bin/env node
// v2.157.0 verification — "the last alphas go home".
// Fresh-written (lesson 25). Pins the zero-alpha muted invariant, the two
// emerald-700 fills, and the release surfaces.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const globLike = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|ts)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
};

check("version: package.json leads 2.157.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.157.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.157.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.157.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-157-0"], "verify:v2-157-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.157.0] The last alphas go home"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.157.0'"), "whats-new head missing");
  assert(feed.indexOf("2.157.0") < feed.indexOf("2.156.0"), "2.157.0 is not the feed head");
});

check("counters re-anchored (46/47/48/79)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(46)"), "2.110.0 anchor not 46");
  assert(t.includes("toBe(79)"), "2.77.0 anchor not 79");
});

check("the flagged alpha tiers (/60 /70 /80) are gone; icon tiers (/30-/50) exempt", () => {
  const files = globLike("src/app").concat(globLike("src/components"));
  let strays = 0;
  for (const p of files) {
    const s = read(p);
    // /60-/80 are the small-TEXT tiers the audits flagged (/60 2.51:1, /70
    // 3.07:1, /80 3.82:1). /30-/50 ride decorative aria-hidden icons and
    // arrow glyphs — the non-text 3:1 rule, not the 4.5:1 text bar.
    strays += (s.match(/text-muted-foreground\/[6-8]0/g) ?? []).length;
  }
  assert(strays === 0, `${strays} text-tier alpha strays remain`);
  const card = read("src/components/pos/product-card.tsx");
  assert(card.includes("text-muted-foreground"), "product-card label not full-strength");
});

check("the two emerald fills ride the -700 family", () => {
  const plans = read("src/app/(shell)/tabs/debt-plans-tab.tsx");
  assert(plans.includes("'bg-emerald-700 text-white border-emerald-700 shadow-sm'"), "debt-plan fill not deepened");
  const hist = read("src/components/data-exports/exports-history-table.tsx");
  assert(hist.includes("'bg-emerald-700 text-white border-emerald-700'"), "export-history fill not deepened");
  // the heatmap dark cell and the run-dialog dark hover stay untouched
  assert(read("src/components/analytics/hourly-heatmap.tsx").includes("dark:bg-emerald-600/60"), "heatmap dark token disturbed");
  assert(read("src/components/hr/payroll-run-dialog.tsx").includes("dark:hover:bg-emerald-600"), "run-dialog dark hover disturbed");
});

check("the lifecycle doc still carries the full family ledger", () => {
  const doc = read("docs/payroll-run-lifecycle.md");
  assert(doc.includes("## The B2C auto-recovery contract (v2.155.0)"), "recovery contract missing");
  assert(doc.includes("## The amber + muted-alpha families (v2.156.0)"), "amber contract missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
