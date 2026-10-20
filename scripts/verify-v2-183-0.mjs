#!/usr/bin/env node
// v2.183.0 verification — "the drill-down remembers".
// Fresh-written (lesson 25). Pins the HR drill-down's comparator sibling
// (hr-drilldown-sort: numeric loudest-first, text A->Z, payroll through the
// latestPayroll join with no-run LAST in both directions), the prefs spine
// twin (its OWN key + v:1 + FOUR fields by the documented restraint,
// corrupt-tolerant parse, injected storage, silent refused saves, honest
// stock-clear), the legal-tree header (controls as SIBLINGS of the door
// button), the driven HR_DRILLDOWN_COLS spec, the shared BranchSortGlyph,
// the Compact toggle (aria-pressed + orange pressed + the dense table
// override), the conditional Reset + the polite hr note, the CSV-sorted-
// rows wiring, the docs rows, and the release surfaces.
// Comment-strip per lesson 49; comment-text pins trimmed to survive
// line-wraps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.183.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.183.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.183.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.183.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-183-0"], "verify:v2-183-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.183.0] The drill-down remembers"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.183.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The drill-down remembers'"), "whats-new title missing");
  assert(feed.indexOf("2.183.0") < feed.indexOf("2.182.0"), "2.183.0 is not the feed head");
});

check("lib: the comparator sibling is a PURE module with the matrix semantics", () => {
  const lib = read("src/lib/org/hr-drilldown-sort.ts");
  assert(lib.includes("export const HR_DRILL_NUMERIC_COLUMNS = ['headcount', 'cost', 'absence', 'alerts'] as const;"), "numeric columns missing");
  assert(lib.includes("export const HR_DRILL_TEXT_COLUMNS = ['branch', 'payroll'] as const;"), "text columns missing");
  assert(lib.includes("export function sortHrDrillRows<T extends HrDrillSortRow>("), "sort entry missing");
  assert(lib.includes("if (missingA) return 1;"), "absence-LAST rule missing");
  assert(!lib.includes("window."), "lib leaks window (purity)");
  assert(!lib.includes("document."), "lib leaks document (purity)");
  assert(!lib.includes("Date.now"), "lib leaks the clock (purity)");
});

check("lib: the prefs spine twin is a PURE module with its OWN key, version and FOUR fields", () => {
  const lib = read("src/lib/org/hr-drilldown-prefs.ts");
  assert(lib.includes("export const HR_DRILLDOWN_PREFS_KEY = 'mbumah.hr-drilldown.prefs';"), "key missing");
  assert(lib.includes("export const HR_DRILLDOWN_PREFS_VERSION = 1"), "version missing");
  assert(lib.includes("open: boolean;"), "open field missing");
  assert(lib.includes("sort: HrDrillSortState | null;"), "sort field missing");
  assert(lib.includes("dense: boolean;"), "dense field missing");
  assert(!lib.includes("widths:"), "spine grew a widths field (restraint broken)");
  assert(lib.includes("THE HONEST RESTRAINT"), "restraint not documented");
  assert(!lib.includes("window."), "lib leaks window (purity)");
  assert(!lib.includes("Date.now"), "lib leaks the clock (purity)");
});

check("lib: corrupt-tolerant parse + bounded sort key", () => {
  const lib = read("src/lib/org/hr-drilldown-prefs.ts");
  assert(lib.includes("if (parsed.v !== HR_DRILLDOWN_PREFS_VERSION) return emptyHrDrilldownPrefs();"), "version gate missing");
  assert(lib.includes("if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;"), "key cap missing");
  assert(lib.includes("open: parsed.open === true,"), "open sanitization missing");
  assert(lib.includes("catch {"), "catch-tolerance missing");
});

check("component: the ONE spec drives a legal, sortable header", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const HR_DRILLDOWN_COLS: HrDrillColDef[] = ["), "spec missing");
  assert(comp.includes("{ key: 'branch', label: 'Branch', pad: 'px-3.5', sortable: true },"), "branch col missing");
  assert(comp.includes("{ key: 'alerts', label: 'Expiry alerts', align: 'right', pad: 'px-3', sortable: true },"), "alerts col missing");
  assert(comp.includes("{HR_DRILLDOWN_COLS.map((c) => ("), "driven header missing");
  assert(comp.includes("aria-sort={hrAriaSortOf(c.key)}"), "aria-sort missing");
  assert(comp.includes("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />"), "glyph reuse missing");
  assert(comp.includes('<div className="flex items-stretch justify-between gap-2 bg-muted/40">'), "legal-tree header missing");
  assert(comp.includes("· layout saves to this browser"), "header hint missing");
});

check("component: the spine wiring - restore, debounce, stock-clear", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const prefs = loadHrDrilldownPrefs(storage);"), "restore missing");
  assert(comp.includes("setHrPerStoreOpen(prefs.open);"), "open restore missing");
  assert(comp.includes("const hrRestored = useRef(false);"), "restore gate missing");
  assert(comp.includes("if (!hrRestored.current) return;"), "write-back gate missing");
  assert(comp.includes("const stock = !hrPerStoreOpen && hrSort === null && hrDense === false;"), "stock fork missing");
  assert(comp.includes("if (stock) clearHrDrilldownPrefs(storage);"), "stock-clear missing");
  assert(comp.includes("open: hrPerStoreOpen,"), "open save missing");
  assert(comp.includes("}, [hrPerStoreOpen, hrSort, hrDense]);"), "deps array missing");
  const guards = comp.split("typeof window === 'undefined' ? null : window.localStorage").length - 1;
  assert(guards >= 4, `SSR guards = ${guards}, want >= 4`);
});

check("component: Compact toggle + conditional Reset + the polite note", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("aria-pressed={hrDense}"), "aria-pressed missing");
  assert(comp.includes("${hrDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}"), "orange pressed missing");
  assert(comp.includes("<table className={`w-full text-sm${hrDense ? ' [&_td]:px-2 [&_td]:py-1 [&_th]:py-1' : ''}`}>"), "dense override missing");
  assert(comp.includes("{hrSort !== null || hrDense ? ("), "conditional Reset missing");
  assert(comp.includes("onClick={resetHrDrillLayout}"), "Reset handler missing");
  assert(comp.includes('data-testid="org-console-hr-note"'), "note testid missing");
  assert(comp.includes("setHrLayoutNote('Drill-down layout reset to defaults');"), "note text missing");
});

check("component: ONE comparator, ONE order for the body AND the CSV", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),"), "hrRows memo missing");
  assert(comp.includes("const onHrSort = (key: string) => setHrSort((prev) => nextHrSortState(prev, key));"), "sort handler missing");
  assert(comp.includes("{hrRows.map((row) => {"), "tbody does not read hrRows");
  const call = comp.indexOf("hrRows.map((r) => ({");
  assert(call > comp.indexOf("const csv = buildBranchesCsv("), "CSV section does not read hrRows");
});

check("the three tables never share bytes - three libs, three keys, zero inline keys", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(!comp.includes("mbumah.store-matrix.prefs"), "org-console touches the matrix key");
  assert(!comp.includes("mbumah.branches-table.prefs"), "org-console touches the branches key");
  assert(!comp.includes("mbumah.hr-drilldown.prefs"), "org-console touches the drill-down key");
  assert(read("src/lib/org/store-matrix-prefs.ts").includes("export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';"), "matrix key drifted");
  assert(read("src/lib/org/branches-table-prefs.ts").includes("export const BRANCHES_TABLE_PREFS_KEY = 'mbumah.branches-table.prefs';"), "branches key drifted");
});

check("docs: multi-store-workspaces.md carries the bullet and the KPI row", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("- The drill-down remembers (v2.183.0):"), "bullet missing");
  assert(doc.includes("| HR drill-down · layout memory | v2.183.0 —"), "KPI row missing");
});

check("tests: the v2183 suite exists and the v2152 pin evolved deliberately", () => {
  const suite = read("src/tests/hr-drilldown-prefs-v2183.test.ts");
  assert(suite.includes("the drill-down remembers"), "suite header missing");
  const v2152 = read("src/tests/console-org-v2152.test.ts");
  assert(v2152.includes("v2.183.0 pin evolution (deliberate)"), "pin evolution comment missing");
  assert(v2152.includes("hrRows.map((r) => ({"), "evolved pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
