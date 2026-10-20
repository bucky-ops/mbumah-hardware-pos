#!/usr/bin/env node
// v2.178.0 verification — "the export carries the week".
// Fresh-written (lesson 25). Pins the fifth trend parameter (the offline
// twin of the branches table), the SAME weekDelta classifier the chips
// speak (chip and file can never disagree), the honesty rule (missing/
// zero/negative prior → EMPTY Change cell), the whole-block honest absence
// (nullish/empty → the exact v2.177.0 bytes), the caller contract (join by
// storeId, the 'Branch' fallback, no second fetch, the section-count note,
// the busy-state button), the docs rows, and the release surfaces.
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

check("version: package.json leads 2.178.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.178.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.178.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.178.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-178-0"], "verify:v2-178-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.178.0] The export carries the week"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.178.0'"), "whats-new head missing");
  assert(feed.indexOf("2.178.0") < feed.indexOf("2.177.0"), "2.178.0 is not the feed head");
});

check("lib: the fifth parameter is tolerant and the classifier is imported, never re-derived", () => {
  const lib = read("src/lib/org/branches-csv.ts");
  assert(lib.includes("import { weekDelta } from '@/lib/org/summary-trend';"), "weekDelta import missing");
  assert(lib.includes("  trend?: readonly BranchTrendCsvRow[] | null,"), "trend param missing/not tolerant");
  assert(lib.includes("export interface BranchTrendCsvRow {"), "BranchTrendCsvRow missing");
  assert(lib.includes("  priorWeekTotal?: number;"), "optional prior missing");
  assert(lib.includes("export const BRANCHES_TREND_CSV_COLUMNS = ["), "columns const missing");
});

check("lib: the section gate is honest (present AND non-empty) and loudest-first is spelled", () => {
  const lib = read("src/lib/org/branches-csv.ts");
  assert(lib.includes("if (trend && trend.length > 0) {"), "section gate not honest");
  assert(lib.includes("const ordered = [...trend].sort((a, b) => b.weekTotal - a.weekTotal);"), "loudest-first sort missing");
  assert(lib.includes("'The week by branch (7d)',"), "title line missing");
});

check("lib: the change cell speaks the signed pct with the EMPTY honest absence", () => {
  const lib = read("src/lib/org/branches-csv.ts");
  assert(lib.includes("t.priorWeekTotal === undefined ? null : weekDelta(t.weekTotal, t.priorWeekTotal);"), "weekDelta call missing");
  assert(lib.includes("d ? String(d.pct) : '',"), "signed pct cell missing");
  assert(lib.includes("t.priorWeekTotal === undefined ? '' : t.priorWeekTotal,"), "prior cell absence missing");
  assert(lib.includes("Branch week shapes are gross revenue"), "gross-vs-net note missing");
  assert(lib.includes("org trend line is net of VAT"), "note tail missing");
});

check("caller: the summary payload pre-joins by storeId — no second fetch", () => {
  const org = read("src/components/workspace/org-console.tsx");
  assert(org.includes("const trendRows = (summary.perStoreTrend ?? []).map((t) => ({"), "join missing");
  assert(org.includes("summary.stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',"), "storeId join/fallback missing");
  assert(org.includes("      trendRows,\n    );"), "fifth argument not passed");
});

check("caller: the note counts the sections it actually wrote", () => {
  const org = read("src/components/workspace/org-console.tsx");
  assert(org.includes("const sections ="), "sections count missing");
  assert(org.includes("(summary.hrPerStore && summary.hrPerStore.length > 0 ? 1 : 0)"), "hr count missing");
  assert(org.includes("(desk ? 1 : 0)"), "desk count missing");
  assert(org.includes("(trendRows.length > 0 ? 1 : 0)"), "trend count missing");
  assert(org.includes("section${sections === 1 ? '' : 's'}"), "singular handling missing");
});

check("caller: the button speaks its own busy state", () => {
  const org = read("src/components/workspace/org-console.tsx");
  assert(org.includes("aria-busy={exporting}"), "aria-busy missing");
  assert(org.includes("exporting ? 'Exporting\\u2026' : 'Export CSV'"), "label swap missing");
  assert(org.includes("exporting ? ' animate-pulse' : ''"), "icon pulse missing");
  assert(org.includes("disabled={exporting}"), "disabled missing");
});

check("tests: the v2178 suite exists and pins the executed bytes", () => {
  const t = read("src/tests/branches-csv-week-v2178.test.ts");
  assert(t.includes("expect(csv.endsWith(WEEK_SECTION)).toBe(true);"), "byte-exact tail pin missing");
  assert(t.includes("expect(weekDelta(123_992, 9_048)?.pct).toBe(1270.38);"), "weekDelta parity missing");
  assert(t.includes("expect(row).toBe('Thika,217400,,');"), "honest absence pin missing");
  assert(t.includes("expect(row).toBe('X,300,300,0');"), "flat pin missing");
  assert(t.includes("const nullish = buildBranchesCsv(STORES, AT, null, null, null);"), "whole-block absence pin missing");
});

check("tests: the v2154 call-shape pin evolved deliberately", () => {
  const t = read("src/tests/console-org-v2154.test.ts");
  assert(t.includes("      trendRows,\\n    );"), "evolved pin missing");
  assert(t.includes("v2.178.0 pin evolution (deliberate)"), "evolution note missing");
});

check("docs: the four-section contract and the export KPI row", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("- The export carries the week (v2.178.0):"), "export bullet missing");
  assert(doc.includes("| Export · week by branch | v2.178.0 —"), "KPI row missing");
  const csvDoc = read("docs/payroll-run-lifecycle.md");
  assert(csvDoc.includes("## The branches CSV contract (v2.152.0 + v2.154.0 + v2.178.0)"), "contract heading not evolved");
  assert(csvDoc.includes("Four sections in one blob"), "four-section wording missing");
});

check("suite: the new test file is registered in the tree", () => {
  const t = read("src/tests/branches-csv-week-v2178.test.ts");
  assert(t.includes("v2.178.0"), "release marker missing");
  assert(t.includes("from '../lib/org/branches-csv'"), "lib import missing");
  assert(t.includes("weekDelta"), "classifier import missing");
});

console.log(`\nverify-v2-178-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
