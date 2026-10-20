#!/usr/bin/env node
// v2.171.0 verification — "the denial names its gate".
// Fresh-written (lesson 25). Pins the refusal feed (deniedTickStamps +
// deniedTickGates, tolerant path fold, same window/cap), the single-source
// deniedTickTooltip helper with per-gate clauses + valve, the pill's
// single-gate suffix completeness guard, the doc chronology, and the
// release surfaces. Comment-strip per lesson 49.
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

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

check("version: package.json leads 2.171.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.171.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.171.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.171.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-171-0"], "verify:v2-171-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.171.0] The denial names its gate"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.171.0'"), "whats-new head missing");
  assert(feed.indexOf("2.171.0") < feed.indexOf("2.170.0"), "2.171.0 is not the feed head");
});

check("counters re-anchored (60/61/62/93)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(60)"), "2.110.0 anchor not 60");
  assert(t.includes("toBe(93)"), "2.77.0 anchor not 93");
  assert(t.includes("Re-anchored for 2.171.0 joining the feed."), "re-anchor comment missing");
});

check("the API lists the refusal feed with the tolerant path fold", () => {
  const a = strip(read("src/app/api/org/automation/route.ts"));
  assert(a.includes("deniedCount, deniedRows] = await Promise.all(["), "feed not in the parallel read");
  assert((a.match(/where: \{ action: DENIED_ACTION, createdAt: \{ gte: since \} \}/g) || []).length === 2, "window query count drifted");
  assert(a.includes("const deniedTickStamps = deniedRows.map((r) => r.createdAt.toISOString());"), "stamps map missing");
  assert(a.includes("const deniedTickGates: (string | null)[] = deniedRows.map"), "gates map missing");
  assert(a.includes("if (!r.metadata) return null;"), "absent-metadata guard missing");
  assert(a.includes("if (path.endsWith('/hourly')) return 'hourly';"), "hourly fold missing");
  assert(a.includes("if (path.endsWith('/nightly')) return 'nightly';"), "nightly fold missing");
  assert(a.includes("deniedTickStamps,") && a.includes("deniedTickGates,"), "exposure missing");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "read-only broken");
});

check("the card's helper is single-source with per-gate clauses", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("deniedTickStamps?: string[];") && c.includes("deniedTickGates?: (string | null)[];"), "interface fields missing");
  const helper = c.split("function deniedTickTooltip(automation: AutomationSummary)")[1].split("function deniedGateLabel")[0];
  assert(helper.includes("'Ticks the tick gate refused while armed — a secret was sent but did not match.'"), "base drifted");
  assert(helper.includes("'The usual cause is a stale CRON_SECRET on one side of the arming walkthrough; the refused tick ran nothing.'"), "cause drifted");
  assert((c.match(/Ticks the tick gate refused while armed/g) || []).length === 1, "base not single-source");
  assert(helper.includes("`${counts.get(g)} at the ${g} gate`"), "per-gate clause missing");
  assert(helper.includes("most recent ${formatEatStamp(new Date(stamps[0]))}"), "most-recent stamp missing");
  assert(helper.includes("` · and ${more} more`"), "valve missing");
  assert(helper.includes("if (typeof g !== 'string' || g.length === 0) continue;"), "tolerance guard missing");
});

check("the pill's single-gate suffix is completeness-guarded", () => {
  const c = read("src/components/workspace/org-console.tsx");
  const label = c.split("function deniedGateLabel(automation: AutomationSummary)")[1].split("function findDiagnosticFor")[0];
  assert(label.includes("if (gates.length === 0) return null;"), "empty guard missing");
  assert(label.includes("(automation.deniedTicks7d ?? 0) > (automation.deniedTickStamps?.length ?? 0)"), "completeness guard missing");
  assert(label.includes("return gates.every((g) => g === first) ? first : null;"), "agreement check missing");
  assert(c.includes("{deniedGateLabel(automation) && ` · ${deniedGateLabel(automation)}`}"), "pill suffix render missing");
  assert(c.includes("title={deniedTickTooltip(automation)}"), "title surface drifted");
  assert(c.includes('<span className="sr-only">{deniedTickTooltip(automation)}</span>'), "sr-only drifted");
  assert(c.includes("`${HINT_BUBBLE} normal-case tracking-normal`"), "bubble override drifted");
});

check("the doc chronology carries v2.171.0 and the feed field", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("The denial names its gate (v2.171.0)"), "v2.171.0 note missing");
  assert(doc.includes("The refused tick speaks (v2.170.0)"), "v2.170.0 note drifted");
  assert(doc.includes("`deniedTickStamps` + `deniedTickGates` (v2.171.0)"), "field bullet missing");
  assert(doc.includes("the `path` field feeds"), "ledger add-on missing");
});

check("the v2.170.0 gate contract is untouched", () => {
  for (const p of ["src/app/api/cron/nightly/route.ts", "src/app/api/cron/hourly/route.ts"]) {
    const s = strip(read(p));
    assert(s.includes("if (provided && provided.length > 0) {"), `${p}: discriminator missing`);
    assert(s.includes("action: 'CRON_TICK_DENIED'"), `${p}: action missing`);
    assert(s.includes("error: 'Forbidden: invalid or missing x-cron-secret header.'"), `${p}: 403 body drifted`);
  }
});

check("the v2171 suite exists", () => {
  const t = read("src/tests/denied-names-gate-v2171.test.ts");
  assert(t.includes("the denial names its gate"), "suite header missing");
  assert(t.includes("deniedTickTooltip"), "helper pin missing");
});

console.log(`\nverify-v2-171-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
