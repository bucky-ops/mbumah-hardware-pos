#!/usr/bin/env node
// v2.181.0 verification — "the matrix remembers".
// Fresh-written (lesson 25). Pins the ONE versioned localStorage spine
// (key + v:1, corrupt-tolerant parse, clamped widths, injected storage,
// silent refused saves, honest stock-clear), the restore-after-hydration
// wiring (the restored ref gate, the debounced write-back, stock clears /
// otherwise saves), the Compact toggle (aria-pressed + orange pressed +
// dense Table override), the Columns-menu hint + Reset layout item, the
// docs rows, and the release surfaces.
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

check("version: package.json leads 2.181.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.181.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.181.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.181.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-181-0"], "verify:v2-181-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.181.0] The matrix remembers"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.181.0'"), "whats-new head missing");
  assert(feed.indexOf("2.181.0") < feed.indexOf("2.180.0"), "2.181.0 is not the feed head");
});

check("lib: the spine is a PURE module with the ONE key and version", () => {
  const lib = read("src/lib/org/store-matrix-prefs.ts");
  assert(lib.includes("export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';"), "key missing");
  assert(lib.includes("export const MATRIX_PREFS_VERSION = 1 as const;"), "version missing");
  assert(lib.includes("export function loadMatrixPrefs"), "load missing");
  assert(lib.includes("export function saveMatrixPrefs"), "save missing");
  assert(lib.includes("export function clearMatrixPrefs"), "clear missing");
  assert(lib.includes("export function parseMatrixPrefs"), "parse missing");
  assert(lib.includes("export function serializeMatrixPrefs"), "serialize missing");
  assert(!lib.includes("window."), "lib must stay storage-injected (no window)");
  assert(!lib.includes("document."), "lib is not pure");
});

check("lib: corrupt tolerance — unknown version, garbage, non-object all degrade", () => {
  const lib = read("src/lib/org/store-matrix-prefs.ts");
  assert(lib.includes("if (parsed.v !== MATRIX_PREFS_VERSION) return emptyPanelPrefs();"), "unknown-version discard missing");
  assert(lib.includes("return emptyPanelPrefs();"), "empty degrade missing");
  assert(lib.includes("} catch {"), "tolerant catches missing");
});

check("lib: widths clamp into the band, entries capped", () => {
  const lib = read("src/lib/org/store-matrix-prefs.ts");
  assert(lib.includes("export const MATRIX_PREFS_MIN_WIDTH = 40;"), "min width missing");
  assert(lib.includes("export const MATRIX_PREFS_MAX_WIDTH = 2000;"), "max width missing");
  assert(lib.includes("Math.min(MATRIX_PREFS_MAX_WIDTH, Math.max(MATRIX_PREFS_MIN_WIDTH, Math.round(value)))"), "clamp missing");
});

check("lib: sort sanitizer accepts only the exact shape", () => {
  const lib = read("src/lib/org/store-matrix-prefs.ts");
  assert(lib.includes("if (dir !== 'asc' && dir !== 'desc') return null;"), "dir gate missing");
  assert(lib.includes("if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;"), "key gate missing");
});

check("component: restore runs after hydration, gated by the restored ref", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("const restored = useRef(false);"), "restored ref missing");
  assert(c.includes("const prefs = loadMatrixPrefs(storage);"), "restore load missing");
  assert(c.includes("restored.current = true;"), "gate flip missing");
  assert(c.indexOf("const prefs = loadMatrixPrefs(storage);") < c.indexOf("restored.current = true;"), "restore must flip the gate AFTER loading");
});

check("component: the write-back is debounced and forks stock-clear vs save", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("if (!restored.current) return;"), "gate check missing");
  assert(c.includes("setTimeout(() => {"), "debounce missing");
  assert(c.includes("}, 250);"), "250ms debounce missing");
  assert(c.includes("if (stock) clearMatrixPrefs(storage);"), "stock-clear fork missing");
  assert(c.includes("else saveMatrixPrefs(storage, { v: MATRIX_PREFS_VERSION, widths, visible, sort: sortState, dense });"), "save fork missing");
  assert(c.includes("}, [widths, visible, sortState, dense]);"), "write-back deps missing");
});

check("component: the storage is guarded for SSR", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("typeof window === 'undefined' ? null : window.localStorage"), "SSR guard missing");
});

check("component: the Compact toggle speaks aria-pressed + the orange pressed state", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("aria-pressed={dense}"), "aria-pressed missing");
  assert(c.includes("${dense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}"), "pressed styling missing");
  assert(c.includes("onClick={() => setDense((d) => !d)}"), "density toggle click missing");
  assert(c.includes("<Rows3 className=\"mr-1 h-3 w-3\" /> Compact"), "Rows3 icon missing");
});

check("component: dense rows tighten the table (th band + td padding)", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("<Table className={dense ? '[&_td]:px-2 [&_td]:py-1 [&_th]:h-8 [&_th]:py-1' : undefined}>"), "dense override missing");
});

check("component: the Columns menu carries the hint and the Reset layout item", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("Widths, hidden columns, sort and density save to this browser automatically."), "hint missing");
  assert(c.includes("onSelect={resetLayout}"), "reset wiring missing");
  assert(c.includes("<RotateCcw className=\"mr-2 h-3 w-3\" /> Reset layout"), "reset item missing");
  assert(c.includes("onToast('Matrix layout reset to defaults');"), "reset toast missing");
  assert(c.includes("import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';"), "dropdown imports missing");
});

check("component: the prefs lib is imported from the ONE module", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("} from '@/lib/org/store-matrix-prefs';"), "prefs import missing");
  assert(c.includes("clearMatrixPrefs,"), "clear import missing");
  assert(c.includes("loadMatrixPrefs,"), "load import missing");
  assert(c.includes("saveMatrixPrefs,"), "save import missing");
  assert(c.includes("MATRIX_PREFS_VERSION,"), "version import missing");
});

check("docs: the matrix-remembers bullet and the KPI row", () => {
  const d = read("docs/multi-store-workspaces.md");
  assert(d.includes("- The matrix remembers (v2.181.0):"), "bullet missing");
  assert(d.includes("| Matrix · layout memory | v2.181.0 —"), "KPI row missing");
});

check("tests: the new suite executes the spine and pins the tolerance", () => {
  const t = read("src/tests/store-matrix-prefs-v2181.test.ts");
  assert(t.includes("from '../lib/org/store-matrix-prefs'"), "lib import missing");
  assert(t.includes("expect(parsed).toEqual(prefs);"), "round-trip pin missing");
  assert(t.includes("expect(p2.widths).toEqual({});"), "corrupt-degrade pin missing");
  assert(t.includes("expect(saved).toBe(true);"), "save-true pin missing");
  assert(t.includes(")).toBe(false);"), "save-false pin missing");
});

check("tests: the prior-round suites evolved their pkg pins to 2.181.0", () => {
  for (const f of [
    "src/tests/trend-names-mover-v2174.test.ts",
    "src/tests/trend-doors-v2175.test.ts",
    "src/tests/expert-week-v2176.test.ts",
    "src/tests/branch-variance-v2177.test.ts",
    "src/tests/branches-csv-week-v2178.test.ts",
    "src/tests/store-matrix-week-v2179.test.ts",
    "src/tests/store-matrix-sort-v2180.test.ts",
  ]) {
    assert(read(f).includes("expect(pkg.version).toBe('2.181.0');"), `${f} not evolved`);
  }
});

console.log(`\nverify-v2-181-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
