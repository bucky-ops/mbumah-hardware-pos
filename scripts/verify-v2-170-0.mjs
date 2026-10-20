#!/usr/bin/env node
// v2.170.0 verification — "the refused tick speaks".
// Fresh-written (lesson 25). Pins the discriminated CRON_TICK_DENIED row in
// both gates (sent-a-secret only, path-only metadata, byte-identical 403,
// catch-guarded), the API's deniedTicks7d window count, the card's amber
// denied pill with the full hint treatment, the shared HINT_BUBBLE constant,
// the doc chronology + two-read sync, and the release surfaces.
// Comment-strip per lesson 49.
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

check("version: package.json leads 2.170.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.170.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.170.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.170.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-170-0"], "verify:v2-170-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.170.0] The refused tick speaks"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.170.0'"), "whats-new head missing");
  assert(feed.indexOf("2.170.0") < feed.indexOf("2.169.0"), "2.170.0 is not the feed head");
});

check("counters re-anchored (59/60/61/92)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(59)"), "2.110.0 anchor not 59");
  assert(t.includes("toBe(92)"), "2.77.0 anchor not 92");
  assert(t.includes("Re-anchored for 2.170.0 joining the feed."), "re-anchor comment missing");
});

check("both gates write CRON_TICK_DENIED behind the sent-a-secret discriminator", () => {
  for (const p of ["src/app/api/cron/nightly/route.ts", "src/app/api/cron/hourly/route.ts"]) {
    const s = strip(read(p));
    const start = s.indexOf("if (provided !== secret)");
    assert(start > -1, `${p}: mismatch check missing`);
    const block = s.slice(start, s.indexOf("return null;", start));
    assert(block.includes("if (provided && provided.length > 0) {"), `${p}: discriminator missing`);
    assert(block.indexOf("CRON_TICK_DENIED") > -1 && block.indexOf("CRON_TICK_DENIED") < block.indexOf("status: 403"), `${p}: row not before the 403`);
    assert(block.includes("action: 'CRON_TICK_DENIED'"), `${p}: action missing`);
    assert(block.includes("LogSeverity.WARN"), `${p}: severity missing`);
    assert(block.includes(".catch(() => {})"), `${p}: catch-guard missing`);
    assert(block.includes("error: 'Forbidden: invalid or missing x-cron-secret header.'"), `${p}: 403 body drifted`);
  }
});

check("no secret material rides the row (scoped to the log call)", () => {
  const nightly = strip(read("src/app/api/cron/nightly/route.ts"));
  const start = nightly.indexOf("if (provided !== secret)");
  const block = nightly.slice(start, nightly.indexOf("return null;", start));
  const logCall = block.slice(block.indexOf("await systemLog"), block.indexOf("}).catch"));
  assert(logCall.includes("metadata: { path: '/api/cron/nightly' }"), "path-only metadata drifted");
  assert(!logCall.includes("provided"), "provided value leaked into the log call");
  assert(!/secret:|providedLength/.test(logCall), "secret material pattern in the log call");
});

check("the fail-open path above the refusal is untouched", () => {
  for (const p of ["src/app/api/cron/nightly/route.ts", "src/app/api/cron/hourly/route.ts"]) {
    const s = strip(read(p));
    assert(s.includes("action: 'CRON_SECRET_UNSET'"), `${p}: fail-open WARN missing`);
    assert(s.includes("accepted an unauthenticated request"), `${p}: fail-open message drifted`);
  }
});

check("the automation read counts the refusals in the same window", () => {
  const a = strip(read("src/app/api/org/automation/route.ts"));
  assert(a.includes("const DENIED_ACTION = 'CRON_TICK_DENIED';"), "DENIED_ACTION const missing");
  assert(a.includes("deniedCount] = await Promise.all(["), "count not in the parallel read");
  assert(a.includes("where: { action: DENIED_ACTION, createdAt: { gte: since } }"), "window drifted");
  assert(a.includes("deniedTicks7d: deniedCount"), "exposure missing");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "read-only broken");
  assert(a.includes("failedTickDispatchers,"), "v2.169.0 exposure drifted");
});

check("the card's denied pill carries the full hint treatment", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("deniedTicks7d?: number;"), "interface field missing");
  assert(c.includes("(automation.deniedTicks7d ?? 0) > 0"), "tolerant guard missing");
  assert(c.includes('data-testid="automation-denied-pill"'), "pill missing");
  assert(c.includes('data-testid="automation-denied-bubble"'), "bubble missing");
  assert(c.includes("border-amber-300 bg-amber-50") && c.includes("text-amber-700"), "amber family drifted");
  assert(c.includes("focus-visible:ring-amber-600"), "focus ring drifted");
  assert(c.includes("tabIndex={0}"), "tab stop missing");
  const sentence = c.split("Ticks the tick gate refused while armed").length - 1;
  assert(sentence === 3, `sentence surfaces = ${sentence}, expected 3 (title, sr-only, bubble)`);
});

check("the bubble recipe lives in one place (HINT_BUBBLE)", () => {
  const c = read("src/components/workspace/org-console.tsx");
  const stripped = strip(c);
  assert((stripped.match(/const HINT_BUBBLE =/g) || []).length === 1, "constant not single");
  assert(stripped.includes("'pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-focus-visible:block'"), "recipe drifted");
  assert((stripped.match(/className=\{HINT_BUBBLE\}/g) || []).length === 1, "chip bubble not on the constant");
  assert((stripped.match(/\$\{HINT_BUBBLE\} normal-case tracking-normal/g) || []).length === 2, "pill-family override count drifted");
});

check("the doc chronology carries v2.170.0 and the two-read sync", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("The refused tick speaks (v2.170.0)"), "v2.170.0 note missing");
  assert(doc.includes("The pill names the heartbeat (v2.169.0)"), "v2.169.0 note drifted");
  assert(doc.includes("The hints become visible (v2.168.0)"), "v2.168.0 note drifted");
  assert(doc.includes("`deniedTicks7d` (v2.170.0)"), "field bullet missing");
  assert(doc.includes("never secret material"), "ledger bullet drifted");
  assert(doc.includes("If the two secrets DISAGREE, the card says so since v2.170.0"), "two-read sync missing");
});

check("the v2170 suite exists and is client-safe in shape", () => {
  const t = read("src/tests/denied-tick-speaks-v2170.test.ts");
  assert(t.includes("the refused tick speaks"), "suite header missing");
  assert(t.includes("denialBlock"), "gate-slice helper missing");
});

console.log(`\nverify-v2-170-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
