#!/usr/bin/env node
// v2.179.0 verification — "the matrix reads the week".
// Fresh-written (lesson 25). Pins the Store Intelligence Matrix's week
// release: the PURE CSV lib (the one writer of the bytes) with the week
// inline after Revenue, the SAME weekDelta classifier the chips speak, the
// honesty rule (missing entry / undefined / zero / negative prior → EMPTY
// Change cell), the note gate (present AND non-empty), the Week 7d column
// (spark + total + chip, the tolerant trend prop, the header hint, the calm
// dash), the workspace dialog's week row, the no-second-fetch page wiring,
// the docs rows, and the release surfaces.
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

check("version: package.json leads 2.179.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.179.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.179.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.179.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-179-0"], "verify:v2-179-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.179.0] The matrix reads the week"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.179.0'"), "whats-new head missing");
  assert(feed.indexOf("2.179.0") < feed.indexOf("2.178.0"), "2.179.0 is not the feed head");
});

check("lib: the matrix CSV is a PURE module with the tolerant trend parameter", () => {
  const lib = read("src/lib/org/store-matrix-csv.ts");
  assert(lib.includes("export function buildStoreMatrixCsv("), "builder missing");
  assert(lib.includes("  trend?: readonly StoreMatrixTrendCsvRow[] | null,"), "trend param missing/not tolerant");
  assert(lib.includes("export interface StoreMatrixCsvStoreRow {"), "store row shape missing");
  assert(lib.includes("export interface StoreMatrixTrendCsvRow {"), "trend row shape missing");
  assert(lib.includes("  priorWeekTotal?: number;"), "optional prior missing");
  assert(!lib.includes("prisma") && !lib.includes("fetch(") && !lib.includes("Blob"), "lib is not pure");
});

check("lib: the week rides inline after Revenue under the matrix's own reading order", () => {
  const lib = read("src/lib/org/store-matrix-csv.ts");
  assert(lib.includes("export const STORE_MATRIX_CSV_COLUMNS = ["), "columns const missing");
  const cols = lib.slice(lib.indexOf("export const STORE_MATRIX_CSV_COLUMNS"), lib.indexOf("] as const;"));
  for (const c of ["'Store'", "'Status'", "'Revenue'", "'Week 7d (KES)'", "'Prior week (KES)'", "'Change (%)'", "'Txns'", "'M-Pesa Pending'"]) {
    assert(cols.includes(c), `column ${c} missing`);
  }
  assert(cols.indexOf("'Revenue'") < cols.indexOf("'Week 7d (KES)'"), "week not after Revenue");
});

check("lib: the Change cell speaks the SAME weekDelta classifier with the EMPTY honest absence", () => {
  const lib = read("src/lib/org/store-matrix-csv.ts");
  assert(lib.includes("import { weekDelta } from '@/lib/org/summary-trend';"), "weekDelta import missing");
  assert(lib.includes("t.priorWeekTotal === undefined ? null : weekDelta(t.weekTotal, t.priorWeekTotal)"), "weekDelta call missing");
  assert(lib.includes("d ? String(d.pct) : ''"), "signed pct cell missing");
  assert(lib.includes("t && t.priorWeekTotal !== undefined ? t.priorWeekTotal : ''"), "prior cell absence missing");
});

check("lib: the join is by storeId and the note gate is honest (present AND non-empty)", () => {
  const lib = read("src/lib/org/store-matrix-csv.ts");
  assert(lib.includes("new Map((trend ?? []).map((t) => [t.storeId, t]))"), "storeId join missing");
  assert(lib.includes("if (trend && trend.length > 0) lines.push(STORE_MATRIX_TREND_NOTE);"), "note gate missing");
  assert(lib.includes("Store week shapes are gross revenue"), "gross-vs-net note missing");
  assert(lib.includes("function csvField(") && lib.includes('/[",\\n\\r]/'), "RFC-4180 quoting missing");
});

check("component: the Week 7d column joins by storeId and degrades honestly", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("{ key: 'week', label: 'Week 7d', hint: '7-day gross revenue, week ending today'"), "week column missing");
  assert(c.includes("<MatrixWeekCell entry={trendById.get(s.id) ?? null} />"), "week cell not joined by id");
  assert(c.includes("new Map((trend ?? []).map((t) => [t.storeId, t]))"), "Map join missing");
  assert(c.includes("export type StoreMatrixTrendEntry = {"), "trend entry type missing");
  assert(c.includes("  trend?: StoreMatrixTrendEntry[] | null;"), "trend prop not tolerant");
  assert(c.includes('aria-hidden="true"'), "honest dash not aria-hidden");
});

check("component: the cell carries the branches table's exact vocabulary", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes('<Sparkline data={entry.spark} stroke="#64748b" width={64} height={18} />'), "muted spark missing");
  assert(c.includes("<WeekDeltaChip current={entry.weekTotal} prior={entry.priorWeekTotal ?? 0} />"), "verdict chip missing");
  assert(c.includes('7-day revenue ${kes(entry.weekTotal)} (gross)'), "tooltip composition missing");
  assert(c.includes('const words = weekDeltaWords(entry.weekTotal, entry.priorWeekTotal ?? 0);'), "sr-only words missing");
  assert(c.includes('<span className="sr-only">7-day revenue {kes(entry.weekTotal)}</span>'), "base sr-only clause missing");
});

check("component: the workspace dialog speaks the week at the top", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("const wsTrend = wsStore ? trendById.get(wsStore.id) ?? null : null;"), "dialog week join missing");
  assert(c.includes("7-day revenue (gross)"), "dialog week label missing");
  assert(c.includes("border-orange-100 bg-orange-50/60 p-3 dark:border-orange-900/40 dark:bg-orange-950/20"), "dialog week styling missing");
  assert(c.includes("<Sparkline data={wsTrend.spark} stroke=\"#64748b\" width={72} height={20} />"), "dialog spark missing");
});

check("component: the lib is the ONE writer of the CSV bytes and the toast counts the week", () => {
  const c = read("src/components/org/store-matrix.tsx");
  assert(c.includes("import { buildStoreMatrixCsv } from '@/lib/org/store-matrix-csv';"), "lib import missing");
  assert(c.includes("buildStoreMatrixCsv("), "lib call missing");
  assert(!c.includes("export: (s)"), "the second export path survived — the lib must be the only writer");
  assert(!c.includes("new Blob([`Store Intelligence"), "inline byte assembly survived");
  assert(c.includes("Exported store_intelligence.csv · week by store"), "week-counting toast missing");
  assert(c.includes("'Exported store_intelligence.csv'"), "plain toast missing");
});

check("page: the console passes the block through — no second fetch", () => {
  const p = read("src/app/(shell)/console/page.tsx");
  assert(p.includes("<StoreMatrix stores={summary.stores} trend={summary.perStoreTrend} onToast={onToast} />"), "trend not passed");
  assert(p.includes("no second"), "no-second-fetch note missing");
});

check("docs: the matrix-week bullet and the KPI row", () => {
  const d = read("docs/multi-store-workspaces.md");
  assert(d.includes("- The matrix reads the week (v2.179.0):"), "bullet missing");
  assert(d.includes("| Matrix · week by store | v2.179.0 —"), "KPI row missing");
});

check("tests: the new suite executes the lib and pins the honesty rule", () => {
  const t = read("src/tests/store-matrix-week-v2179.test.ts");
  assert(t.includes("from '../lib/org/store-matrix-csv'"), "lib import missing");
  assert(t.includes("expect(weekDelta(123_992, 9_048)?.pct).toBe(1270.38);"), "weekDelta parity missing");
  assert(t.includes("JUJ,ACTIVE,0,217400,0,,0,0,0,0,0,0"), "zero-prior honesty pin missing");
  assert(t.includes("JUJ,ACTIVE,0,300,300,0,0,0,0,0,0"), "flat pin missing");
  assert(t.includes("Note,Store week shapes are gross revenue"), "note pin missing");
});

check("tests: the prior-round suites evolved their pkg pins to 2.179.0", () => {
  for (const f of [
    "src/tests/trend-names-mover-v2174.test.ts",
    "src/tests/trend-doors-v2175.test.ts",
    "src/tests/expert-week-v2176.test.ts",
    "src/tests/branch-variance-v2177.test.ts",
    "src/tests/branches-csv-week-v2178.test.ts",
  ]) {
    assert(read(f).includes("expect(pkg.version).toBe('2.179.0');"), `${f} not evolved`);
  }
});

console.log(`\nverify-v2-179-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
