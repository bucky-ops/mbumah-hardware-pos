#!/usr/bin/env node
// v2.149.0 verification — "the console fits the phone".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the unified-console acceptance sweep: the 390px width contract restored at
// the shell (main w-full min-w-0 — the measured 1012px fit-content failure),
// the scroll wrappers that contain their tables AND the keyboard, the amber
// family passing at cell size, the Expert Console's named filter triggers,
// the slate-500 light-surface sweep, the branches CSV export, and the
// Welcome banner's darker light end. Comment-stripping before code searches
// (lesson 49); double-quoted strings throughout (lesson 61 amendment).

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
/** Strip line comments so a quoted example in prose never satisfies a code pin. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const SHELL = "src/components/console/unified-console.tsx";
const ORG = "src/components/workspace/org-console.tsx";
const CONSOLE_PAGE = "src/app/(shell)/console/page.tsx";
const PANELS = "src/components/org/panels.tsx";
const KPI = "src/components/org/kpi-row.tsx";
const MATRIX = "src/components/org/store-matrix.tsx";
const DASH = "src/app/(shell)/tabs/dashboard-tab.tsx";
const CSVLIB = "src/lib/org/branches-csv.ts";
const DOC = "docs/payroll-run-lifecycle.md";
const CHANGELOG = "CHANGELOG.md";
const FEED = "src/lib/whats-new.ts";
const TEST = "src/tests/console-org-v2149.test.ts";

// ── version + release discipline ───────────────────────────────────────────
check("version: package.json leads 2.149.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.149.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.149.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.149.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-149-0"], "verify:v2-149-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read(CHANGELOG).includes("## [2.149.0] The console fits the phone"), "CHANGELOG head missing");
  const feed = read(FEED);
  assert(feed.includes("version: '2.149.0'"), "whats-new head missing");
  assert(feed.indexOf("2.149.0") < feed.indexOf("2.148.0"), "2.149.0 is not the feed head");
});

check("the changelog test re-anchors the counter for the new head", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(38)"), "2.110.0 anchor not 38");
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(71)"), "2.77.0 anchor not 71");
});

// ── the width contract ─────────────────────────────────────────────────────
check("shell: main carries w-full min-w-0 (the fit-content failure is dead)", () => {
  const shell = stripComments(read(SHELL));
  assert(shell.includes("w-full min-w-0 flex-1"), "main lacks w-full min-w-0");
  assert(shell.includes('id="unified-console-main"'), "main landmark moved");
});

check("org console: branches wrapper = min-w-0 + overflow-x-auto + focusable + named", () => {
  const org = stripComments(read(ORG));
  assert(org.includes("min-w-0 overflow-x-auto focus-visible:outline-none"), "branches wrapper lacks min-w-0/ring");
  assert(org.includes('aria-label="Branches, scrollable table"'), "branches wrapper unnamed");
  assert(org.includes("tabIndex={0}"), "no focusable scroller");
});

check("org console: drill-down wrapper scrolls BOTH ways + focusable (carried defect)", () => {
  const org = stripComments(read(ORG));
  assert(org.includes("max-h-96 min-w-0 overflow-x-auto overflow-y-auto"), "drill-down not both-axis");
  assert(org.includes('aria-label="People and payroll by branch, scrollable table"'), "drill-down unnamed");
  const yOnly = org.match(/overflow-y-auto(?![\w-])/g)?.length ?? 0;
  assert(yOnly >= 1, "overflow-y-auto vanished entirely (unexpected)");
});

check("org console: grid tracks keep Tailwind's minmax(0,1fr) contract", () => {
  const org = stripComments(read(ORG));
  assert(org.includes("grid-cols-2 md:grid-cols-3 xl:grid-cols-6"), "KPI grid contract moved");
});

// ── the contrast contract ──────────────────────────────────────────────────
check("org console: zero bare amber-600; amber-700 mounts with dark kept", () => {
  const org = stripComments(read(ORG));
  const bare = org.match(/text-amber-600/g)?.length ?? 0;
  assert(bare === 0, `${bare} bare text-amber-600 left`);
  // six dark-paired mounts total: four from this round (KPI icon, KPI value,
  // absence cell, expiry cell) + two that predate it (diagnostics banner chip,
  // missing-columns line); the low-stock cell words its classes differently.
  assert((org.match(/text-amber-700 dark:text-amber-400/g)?.length ?? 0) === 6, "warn-pair mounts wrong");
  assert(org.includes("text-amber-700 font-medium dark:text-amber-400"), "low-stock mount wrong");
  assert(org.includes("tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'"), "KPI mount wrong");
});

check("console page: ACTIVE chip emerald-700, inactive + meta slate-500", () => {
  const page = stripComments(read(CONSOLE_PAGE));
  assert(page.includes("s.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'"), "chip ternary wrong");
  assert(page.includes('<p className="text-[10px] text-slate-500">{kes(s.todayRevenue)}'), "meta line wrong");
  const bad600 = page.match(/text-emerald-600/g)?.length ?? 0;
  assert(bad600 === 0, `console page still has ${bad600} text-emerald-600`);
  const bad400 = page.match(/text-slate-400/g)?.length ?? 0;
  assert(bad400 === 0, `console page still has ${bad400} text-slate-400`);
});

check("panels: both filter triggers named on the TRIGGER", () => {
  const panels = stripComments(read(PANELS));
  assert(panels.includes('aria-label="Filter timeline by action"'), "action trigger unnamed");
  assert(panels.includes('aria-label="Filter timeline by role"'), "role trigger unnamed");
});

check("panels + experts + kpi-row: no emerald-600/amber-600 left in the light family", () => {
  const panels = stripComments(read(PANELS));
  assert((panels.match(/text-emerald-600/g)?.length ?? 0) === 0, "panels still has text-emerald-600");
  assert((panels.match(/text-amber-600/g)?.length ?? 0) === 0, "panels still has text-amber-600");
  assert((panels.match(/text-emerald-700 dark:text-emerald-400/g)?.length ?? 0) === 2, "dark pair mount wrong");
  for (const f of [KPI, MATRIX, "src/components/org/experts.tsx", "src/components/org/desk-report-view.tsx"]) {
    const src = stripComments(read(f));
    for (const tok of ["text-emerald-600", "text-amber-600"]) {
      const n = src.match(new RegExp(`(^|[^:-])${tok}`, "g"))?.length ?? 0;
      assert(n === 0, `${f} still carries ${n} bare ${tok}`);
    }
  }
});

check("light-surface sweep: no bare text-slate-400 in panels/kpi-row/matrix", () => {
  for (const f of [PANELS, KPI, MATRIX]) {
    const src = stripComments(read(f));
    const bare = src.match(/(^|[^:-])text-slate-400/g)?.length ?? 0;
    assert(bare === 0, `${f} still carries ${bare} bare text-slate-400`);
  }
  assert((stripComments(read(PANELS)).match(/dark:text-slate-400/g)?.length ?? 0) === 8, "panels dark pairs drifted");
});

check("matrix: data zeros pass (slate-300 placeholders gone)", () => {
  const matrix = stripComments(read(MATRIX));
  assert(!matrix.includes('<span className="text-slate-300">0</span>'), "slate-300 zero remains");
  assert((matrix.match(/<span className="text-slate-500">0<\/span>/g)?.length ?? 0) === 3, "zero mounts wrong");
});

check("welcome banner: light end is #047857 (worst corner clears 4.5:1)", () => {
  const dash = stripComments(read(DASH));
  assert(dash.includes("from-[#059669] to-[#047857]"), "gradient not darkened");
  assert(!dash.includes("to-[#10b981]"), "old light end remains");
});

// ── the CSV export ─────────────────────────────────────────────────────────
check("branches-csv: pure module with documented columns + RFC-4180 quoting", () => {
  const lib = read(CSVLIB);
  assert(lib.includes("export function buildBranchesCsv"), "builder missing");
  assert(lib.includes("Organization Console branches (generated"), "stamp line missing");
  // pure: no db, no network. The generatedAt default param (new Date()) is
  // the caller's clock, injected — tests pass a fixed Date.
  assert(!lib.includes("from '@/lib/db'") && !lib.includes("fetch("), "module is not pure (db import or network)");
  assert(lib.includes('replace(/"/g'), "quote doubling missing");
});

check("org console: export button + polite note wired", () => {
  const org = stripComments(read(ORG));
  assert(org.includes('data-testid="org-console-export-csv"'), "button testid missing");
  assert(org.includes('data-testid="org-console-export-note"'), "note testid missing");
  assert(org.includes("buildBranchesCsv("), "builder not called");
  assert(org.includes('a.download = filename'), "download not wired");
});

// ── the docs + tests ───────────────────────────────────────────────────────
check("docs/payroll-run-lifecycle.md seeds the four shipped contracts", () => {
  const doc = read(DOC);
  for (const section of ["## The gate contract", "## The accessibility contract", "## The shell contract", "## The width contract", "## The contrast contract"]) {
    assert(doc.includes(section), `missing ${section}`);
  }
  assert(doc.includes("w-full min-w-0"), "width contract does not name the shell fix");
});

check("the round's test suite exists and pins the contract", () => {
  const t = read(TEST);
  assert(t.includes("v2.149.0"), "test file does not speak the version");
  assert(t.includes("buildBranchesCsv"), "CSV builder unpinned");
  assert(t.includes("w-full min-w-0 flex-1"), "shell fix unpinned");
});

console.log(`\nverify-v2-149-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
