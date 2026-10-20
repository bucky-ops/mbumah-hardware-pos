#!/usr/bin/env node
// v2.182.0 verification — "the branches table remembers".
// Fresh-written (lesson 25). Pins the branches table's spine twin (its OWN
// key + v:1, corrupt-tolerant parse, clamped widths, injected storage,
// silent refused saves, honest stock-clear), the restore-after-hydration
// wiring (the branchRestored ref gate, the debounced write-back, stock
// clears / otherwise saves), the matrix comparator REUSE (one sort
// vocabulary across both dense tables), the driven BRANCH_TABLE_COLS spec,
// the Compact toggle (aria-pressed + orange pressed + the dense table
// override), the Columns-menu hint + Reset layout item, the CSV-sorted-
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

check("version: package.json leads 2.182.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.182.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.182.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.182.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-182-0"], "verify:v2-182-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.182.0] The branches table remembers"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.182.0'"), "whats-new head missing");
  assert(feed.indexOf("2.182.0") < feed.indexOf("2.181.0"), "2.182.0 is not the feed head");
});

check("lib: the spine twin is a PURE module with its OWN key and version", () => {
  const lib = read("src/lib/org/branches-table-prefs.ts");
  assert(lib.includes("export const BRANCHES_TABLE_PREFS_KEY = 'mbumah.branches-table.prefs';"), "key missing");
  assert(lib.includes("export const BRANCHES_TABLE_PREFS_VERSION = 1"), "version missing");
  assert(!lib.includes("window."), "lib leaks window (purity)");
  assert(!lib.includes("document."), "lib leaks document (purity)");
  assert(!lib.includes("Date.now"), "lib leaks the clock (purity)");
});

check("lib: corrupt-tolerant parse + clamped widths + bounded entries", () => {
  const lib = read("src/lib/org/branches-table-prefs.ts");
  assert(lib.includes("BRANCHES_TABLE_MIN_WIDTH = 40"), "min width missing");
  assert(lib.includes("BRANCHES_TABLE_MAX_WIDTH = 2000"), "max width missing");
  assert(lib.includes("MAX_WIDTH_ENTRIES = 32"), "width cap missing");
  assert(lib.includes("if (parsed.v !== BRANCHES_TABLE_PREFS_VERSION) return emptyBranchesTablePrefs();"), "unknown-version discard missing");
  assert(lib.includes("if (typeof storage.removeItem === 'function') {"), "removeItem branch missing");
});

check("component: the spine is imported from the ONE module", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("} from '@/lib/org/branches-table-prefs';"), "spine import missing");
  for (const fn of ["clearBranchesTablePrefs,", "loadBranchesTablePrefs,", "saveBranchesTablePrefs,", "BRANCHES_TABLE_PREFS_VERSION,"]) {
    assert(comp.includes(fn), `import missing: ${fn}`);
  }
});

check("component: restore after hydration, gated write-back, debounced 250ms", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const prefs = loadBranchesTablePrefs(storage);"), "restore load missing");
  assert(comp.includes("setBranchWidths(prefs.widths);"), "widths restore missing");
  assert(comp.includes("setBranchVisible(prefs.visible);"), "visible restore missing");
  assert(comp.includes("setBranchSort(prefs.sort);"), "sort restore missing");
  assert(comp.includes("setBranchDense(prefs.dense);"), "dense restore missing");
  assert(comp.includes("branchRestored.current = true;"), "restore gate flag missing");
  assert(comp.includes("if (!branchRestored.current) return;"), "write-back gate missing");
  assert(comp.includes("}, 250);"), "debounce missing");
  assert(comp.includes("}, [branchWidths, branchVisible, branchSort, branchDense]);"), "deps missing");
  assert(comp.includes("if (stock) clearBranchesTablePrefs(storage);"), "stock-clear fork missing");
  assert((comp.match(/typeof window === 'undefined' \? null : window.localStorage/g) || []).length >= 2, "SSR guards missing");
});

check("component: ONE comparator reused — the matrix's sort lib, verbatim", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';"), "comparator import missing");
  assert(comp.includes("sortMatrixRows(summary.stores, branchSort, (s) => branchTrendById.get(s.id)?.weekTotal)"), "sorted rows memo missing");
  assert(comp.includes("const onBranchSort = (key: string) => setBranchSort((prev) => nextSortState(prev, key));"), "sort handler missing");
  assert(comp.includes("aria-sort={branchAriaSortOf(c.key)}"), "aria-sort missing");
});

check("component: the CSV export reads the SORTED rows", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  const call = comp.indexOf("const csv = buildBranchesCsv(");
  const body = comp.slice(call, call + 400);
  assert(body.includes("branchRows.map((s) => ({"), "export does not read branchRows");
});

check("component: Compact toggle + dense override + Columns menu trio", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("aria-pressed={branchDense}"), "aria-pressed missing");
  assert(comp.includes("${branchDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}"), "orange pressed family missing");
  assert(comp.includes("<Rows3 className=\"mr-1 h-3 w-3\" aria-hidden=\"true\" /> Compact"), "compact button missing");
  assert(comp.includes("[&_td]:px-2 [&_td]:py-1 [&_th]:py-1"), "dense override missing");
  assert(comp.includes("Sort, hidden columns, widths and density save to this browser automatically."), "hint missing");
  assert(comp.includes("onSelect={resetBranchLayout}"), "reset wiring missing");
  assert(comp.includes("<RotateCcw className=\"mr-2 h-3 w-3\" aria-hidden=\"true\" /> Reset layout"), "reset item missing");
  assert(comp.includes("DropdownMenuSeparator"), "separator missing");
  assert(comp.includes('data-testid="org-console-layout-note"'), "layout note missing");
});

check("component: the ONE column spec drives header, menu and resize", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const BRANCH_TABLE_COLS: BranchColDef[] = ["), "spec missing");
  assert(comp.includes("{ key: 'workspace', label: 'Workspace', width: 250, min: 210, sortable: false },"), "workspace unsortable missing");
  assert(comp.includes("const branchShown = BRANCH_TABLE_COLS.filter((c) => branchVisible[c.key] !== false);"), "visibility filter missing");
  assert(comp.includes("const branchWidthOf = (c: BranchColDef) => branchWidths[c.key] ?? c.width;"), "width resolver missing");
  assert(comp.includes("onMouseDown={(e) => onBranchResizeDown(c.key, e)}"), "resize handle missing");
  assert(comp.includes("Math.max("), "min floor missing");
  let wraps = 0;
  for (const key of ["branch", "revenue", "week", "txns", "low", "overdue", "debt", "mpesa", "workspace"]) {
    if (comp.includes(`branchVisible.${key} !== false`)) wraps++;
  }
  assert(wraps === 9, `visibility wraps = ${wraps}, want 9`);
  assert(comp.includes("{branchRows.map((store) => {"), "tbody does not read branchRows");
});

check("docs: multi-store-workspaces.md carries the bullet and the KPI row", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("- The branches table remembers (v2.182.0):"), "bullet missing");
  assert(doc.includes("| Branches table · layout memory | v2.182.0 —"), "KPI row missing");
});

check("the matrix spine is untouched — two tables, two keys, zero shared bytes", () => {
  const matrixLib = read("src/lib/org/store-matrix-prefs.ts");
  assert(matrixLib.includes("export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';"), "matrix key drifted");
  const comp = read("src/components/workspace/org-console.tsx");
  assert(!comp.includes("mbumah.store-matrix.prefs"), "org-console touches the matrix key");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
