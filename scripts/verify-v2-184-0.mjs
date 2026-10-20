#!/usr/bin/env node
// v2.184.0 verification — "the drill-down heals".
// Fresh-written (lesson 25). Pins the post-release E2E fix: the restore
// macrotask bumps the write-back's hrRestoreTick (the post-restore pulse)
// so a stock-shaped restore — corrupt bytes included — walks the stock
// fork and clears the key, the siblings' self-heal carried over verbatim
// (the drill-down has no widths to hand back fresh, by the documented
// restraint). Also re-pins the v2.183.0 surface it rides on.
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

check("version: package.json leads 2.184.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.184.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.184.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.184.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-184-0"], "verify:v2-184-0 script missing");
  assert(pkg.scripts["verify:v2-183-0"], "verify:v2-183-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.184.0] The drill-down heals"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.184.0]") < changelog.indexOf("## [2.183.0]"), "2.184.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.184.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The drill-down heals'"), "whats-new title missing");
  assert(feed.indexOf("2.184.0") < feed.indexOf("2.183.0"), "2.184.0 is not the feed head");
});

check("fix: the restore pulse - the tick is declared, bumped in the macrotask, carried in the deps", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const [hrRestoreTick, setHrRestoreTick] = useState(0);"), "tick declaration missing");
  assert(comp.includes("setHrRestoreTick((t) => t + 1);"), "tick bump missing");
  assert(comp.indexOf("setHrRestoreTick((t) => t + 1);") > comp.indexOf("const id = window.setTimeout(() => {"), "bump is not inside the restore macrotask");
  assert(comp.includes("}, [hrRestoreTick, hrPerStoreOpen, hrSort, hrDense]);"), "deps do not carry the tick");
  // the stock fork is still the ONE clear path
  assert(comp.includes("const stock = !hrPerStoreOpen && hrSort === null && hrDense === false;"), "stock fork missing");
  assert(comp.includes("if (stock) clearHrDrilldownPrefs(storage);"), "stock-clear missing");
  // the restore gate is untouched
  assert(comp.includes("if (!hrRestored.current) return;"), "restore gate missing");
  assert(comp.includes("hrRestored.current = true;"), "restored ref missing");
});

check("fix: the reasoning is written where the pin lives", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("v2.184.0: the write-back's post-restore pulse"), "component comment missing");
  const suite = read("src/tests/hr-drilldown-prefs-v2183.test.ts");
  assert(suite.includes("v2.184.0 pin evolution (deliberate)"), "pin evolution comment missing");
  assert(suite.includes("}, [hrRestoreTick, hrPerStoreOpen, hrSort, hrDense]);"), "suite pin not evolved");
});

check("docs: the bullet and the KPI row speak the heal", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("v2.184.0: the restore bumps the write-back's `hrRestoreTick`"), "bullet heal note missing");
  assert(doc.includes("v2.184.0 — the `hrRestoreTick` post-restore pulse"), "KPI heal note missing");
});

check("the v2.183.0 surface rides untouched", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("const prefs = loadHrDrilldownPrefs(storage);"), "restore missing");
  assert(comp.includes("setHrRestoreTick((t) => t + 1);") === true, "sanity");
  assert(comp.includes("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />"), "glyph reuse drifted");
  assert(comp.includes("() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),"), "hrRows memo drifted");
  assert(!comp.includes("mbumah.hr-drilldown.prefs"), "org-console touches the drill-down key");
  const lib = read("src/lib/org/hr-drilldown-prefs.ts");
  assert(lib.includes("export const HR_DRILLDOWN_PREFS_KEY = 'mbumah.hr-drilldown.prefs';"), "spine key drifted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
