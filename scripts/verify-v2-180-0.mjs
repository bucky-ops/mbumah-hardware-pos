#!/usr/bin/env node
// v2.180.0 verification — "the matrix learns to sort".
// Fresh-written (lesson 25). Pins the ONE pure comparator (numeric
// loudest-first, text A→Z, week by the weekTotal join with absence LAST in
// both directions, stable ties, null state → copied arrival order), the
// sortable headers (real buttons excluding Actions, glyph vocabulary,
// aria-sort real values, the separator outside the button), the export
// reading the SAME sorted memo as the body, the docs rows, and the release
// surfaces.
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

check("version: package.json leads 2.180.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.180.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.180.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.180.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-180-0"], "verify:v2-180-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.180.0] The matrix learns to sort"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.180.0'"), "whats-new head missing");
  assert(feed.indexOf("2.180.0") < feed.indexOf("2.179.0"), "2.180.0 is not the feed head");
});

check("lib: the comparator is a PURE module with the honest defaults", () => {
  const lib = read("src/lib/org/store-matrix-sort.ts");
  assert(lib.includes("export function sortMatrixRows"), "comparator missing");
  assert(lib.includes("export function nextSortState"), "nextSortState missing");
  assert(lib.includes("export function defaultDirFor"), "defaultDirFor missing");
  assert(lib.includes("export function toggledDir"), "toggledDir missing");
  assert(lib.includes("export const MATRIX_NUMERIC_COLUMNS = ["), "numeric columns missing");
  assert(lib.includes("export const MATRIX_TEXT_COLUMNS = ['store', 'status'] as const;"), "text columns missing");
  assert(!lib.includes("useState") && !lib.includes("document.") && !lib.includes("new Date"), "lib is not pure");
});

check("lib: numeric reads desc, text reads asc, unknown reads as text", () => {
  const lib = read("src/lib/org/store-matrix-sort.ts");
  assert(lib.includes("(MATRIX_NUMERIC_COLUMNS as readonly string[]).includes(key) ? 'desc' : 'asc'"), "default direction rule missing");
});

check("lib: the week honesty rule — absence sorts LAST in BOTH directions", () => {
  const lib = read("src/lib/org/store-matrix-sort.ts");
  assert(lib.includes("if (key === 'week') {"), "week branch missing");
  assert(lib.includes("if (missingA) return 1;"), "absence-last rule missing");
  assert(lib.includes("const missingA = wa === undefined;"), "undefined read missing");
  assert(lib.includes("weekOf?: (row: T) => number | undefined"), "weekOf callback missing");
});

check("lib: null state copies arrival order and unknown keys never guess", () => {
  const lib = read("src/lib/org/store-matrix-sort.ts");
  assert(lib.includes("if (!state) return [...rows];"), "null-state copy missing");
  assert(lib.includes("if (!get) return [...rows];"), "unknown-key guard missing");
});

check("component: ONE comparator feeds BOTH the table body and the export", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';"), "lib import missing");
  assert(c.includes("const [sortState, setSortState] = useState<MatrixSortState | null>(null);"), "sort state missing");
  assert(c.includes("() => sortMatrixRows(stores, sortState, (s) => trendById.get(s.id)?.weekTotal),"), "sorted memo missing");
  assert(c.includes("{sortedStores.map((s, i) => ("), "body does not read the sorted rows");
  assert(c.includes("sortedStores.map((s) => ({"), "export does not read the sorted rows");
});

check("component: every data column sorts, Actions stays a span", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("{c.key === 'actions' && <span className=\"whitespace-nowrap\">{c.label}</span>}"), "Actions span missing");
  assert(c.includes("onClick={() => onSort(c.key)}"), "sort click missing");
  assert(c.includes("const onSort = (key: string) => setSortState((prev) => nextSortState(prev, key));"), "handler must delegate to the lib");
});

check("component: the accessible state rides aria-sort with REAL values", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("const ariaSortOf = (key: string): 'ascending' | 'descending' | 'none' =>"), "aria values not real ARIA words");
  assert(c.includes("aria-sort={ariaSortOf(c.key)}"), "aria-sort not wired to the th");
});

check("component: the glyph vocabulary and the active label", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("function SortGlyph({ state }: { state: 'asc' | 'desc' | 'none' })"), "SortGlyph missing");
  assert(c.includes('<ArrowUp className="h-3 w-3 text-orange-500" aria-hidden="true" />'), "asc glyph missing");
  assert(c.includes('<ArrowDown className="h-3 w-3 text-orange-500" aria-hidden="true" />'), "desc glyph missing");
  assert(c.includes("group-hover:opacity-100 group-focus-visible:opacity-100"), "hover/focus reveal missing");
  assert(c.includes("sortState?.key === c.key ? 'font-semibold text-slate-900' : ''"), "active label missing");
});

check("component: the resize separator stays outside the button", () => {
  const c = read("src/components/org/store-matrix.tsx");
  const header = c.slice(c.indexOf("<TableHeader"), c.indexOf("</TableHeader>"));
  assert(header.includes("onMouseDown={(e) => onDown(c.key, e)}"), "resize handle missing");
  assert(header.indexOf("<button") < header.indexOf("onMouseDown="), "separator ordering broken");
});

check("docs: the matrix-sort bullet and the KPI row", () => {
  const d = read("docs/multi-store-workspaces.md");
  assert(d.includes("- The matrix learns to sort (v2.180.0):"), "bullet missing");
  assert(d.includes("| Matrix · sort | v2.180.0 —"), "KPI row missing");
});

check("tests: the new suite executes the comparator and pins the honesty rule", () => {
  const t = read("src/tests/store-matrix-sort-v2180.test.ts");
  assert(t.includes("from '../lib/org/store-matrix-sort'"), "lib import missing");
  assert(t.includes("expect(desc[desc.length - 1]?.id).toBe('ghost');"), "absence-last pin missing");
  assert(t.includes("expect(asc[asc.length - 1]?.id).toBe('ghost');"), "absence-last-on-asc pin missing");
  assert(t.includes("expect(out).not.toBe(rows);"), "copy pin missing");
  assert(t.includes("expect(sortMatrixRows(rows, { key: 'mystery', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'b']);"), "unknown-key pin missing");
});

check("tests: the prior-round suites evolved their pkg pins to 2.180.0", () => {
  for (const f of [
    "src/tests/trend-names-mover-v2174.test.ts",
    "src/tests/trend-doors-v2175.test.ts",
    "src/tests/expert-week-v2176.test.ts",
    "src/tests/branch-variance-v2177.test.ts",
    "src/tests/branches-csv-week-v2178.test.ts",
    "src/tests/store-matrix-week-v2179.test.ts",
  ]) {
    assert(read(f).includes("expect(pkg.version).toBe('2.180.0');"), `${f} not evolved`);
  }
});

console.log(`\nverify-v2-180-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
