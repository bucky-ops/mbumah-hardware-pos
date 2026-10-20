#!/usr/bin/env node
// v2.172.0 verification — "the card expects the tick".
// Fresh-written (lesson 25). Pins the pure expectation lib (three states,
// grace window, posture deferral, tolerance), the API's vercelHourUtc
// anchor, the card's render contract, and the doc chronology. Comment-strip
// per lesson 49.
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

check("version: package.json leads 2.172.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.172.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.172.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.172.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-172-0"], "verify:v2-172-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.172.0] The card expects the tick"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.172.0'"), "whats-new head missing");
  assert(feed.indexOf("2.172.0") < feed.indexOf("2.171.0"), "2.172.0 is not the feed head");
});

check("counters re-anchored (61/62/63/94)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(61)"), "2.110.0 anchor not 61");
  assert(t.includes("toBe(94)"), "2.77.0 anchor not 94");
  assert(t.includes("Re-anchored for 2.172.0 joining the feed."), "re-anchor comment missing");
});

check("the expectation lib exists, is pure, and names its constants", () => {
  const lib = read("src/lib/org/tick-expectation.ts");
  assert(lib.includes("export const TICK_GRACE_MINUTES = 15;"), "grace constant missing");
  assert(lib.includes("export function slotTopOfHour("), "slotTopOfHour missing");
  assert(lib.includes("export function nextTopOfHour("), "nextTopOfHour missing");
  assert(lib.includes("export function nextVercelSlot(now: Date, hourUtc = 3): Date"), "nextVercelSlot default missing");
  assert(lib.includes("export function formatUtcClock("), "formatUtcClock missing");
  assert(lib.includes("export function formatEatClock("), "formatEatClock missing");
  assert(lib.includes("export function nextTickExpectation("), "nextTickExpectation missing");
  assert(lib.includes("export function expectationTextClass("), "text-class map missing");
  assert(lib.includes("export function expectationDotClass("), "dot-class map missing");
  // purity: no db, no fetch, no Date.now (the now anchor is passed in)
  assert(!/from '@\/lib\/db'/.test(lib), "lib must not import the db");
  assert(!/fetch\(/.test(lib), "lib must not fetch");
  assert(!lib.includes("Date.now()"), "lib must not read the wall clock (anchor is passed in)");
});

check("the lib's three sentences and the posture deferral are honest", () => {
  const lib = read("src/lib/org/tick-expectation.ts");
  assert(lib.includes("Next tick due ${formatUtcClock(due)} (${formatEatClock(due)}) — the hourly dispatcher's slot."), "on-time sentence drifted");
  assert(lib.includes("Heartbeat overdue — no tick since ${formatUtcClock(slot)} (${formatEatClock(slot)}), ${minutesPast}m past the ${TICK_GRACE_MINUTES}-minute grace window."), "overdue sentence drifted");
  assert(lib.includes("Pinger not armed — the next expected tick is Vercel's daily slot ${formatUtcClock(next)} (${formatEatStamp(next)})."), "unarmed sentence drifted");
  assert(lib.includes("if (input.secretConfigured !== true) {"), "posture deferral guard missing");
  assert(lib.includes("lastTick.getTime() < slot.getTime() && now.getTime() >= graceEnd"), "overdue condition missing");
  assert(lib.includes("if (Number.isNaN(now.getTime())) return null;"), "bad-anchor guard missing");
});

check("the API exposes vercelHourUtc: 3 and stays read-only", () => {
  const a = strip(read("src/app/api/org/automation/route.ts"));
  assert(a.includes("vercelHourUtc: 3,"), "API anchor missing");
  assert(a.includes("vercelSchedule: '0 3 * * *',"), "schedule string drifted");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "read-only broken");
});

check("the card renders the expectation line from the lib", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("} from '@/lib/org/tick-expectation';"), "lib import missing");
  assert(c.includes("cadence: { vercelSchedule: string; pingerWorkflow: string; vercelHourUtc?: number };"), "interface field missing");
  assert(c.includes("data-testid=\"automation-expectation\""), "test id missing");
  const before = c.split('data-testid="automation-expectation"')[0].slice(-120);
  assert(before.includes('role="note"'), "role=note missing");
  const line = c.split('data-testid="automation-expectation"')[1].split("{expectation.text}")[0];
  assert(!line.includes("title="), "the full-sentence line must not carry a tooltip");
  assert(!line.includes("tabIndex"), "the line must not be a tab stop");
  assert(c.includes("generatedAt: automation.generatedAt,"), "server anchor missing");
  assert(c.includes("lastTickAt: automation.lastTick.at,"), "ledger anchor missing");
  assert(c.includes("expectationTextClass(expectation.state)"), "text class not wired");
  assert(c.includes("expectationDotClass(expectation.state)"), "dot class not wired");
  assert(c.includes('aria-hidden="true"'), "decorative dot not aria-hidden");
});

check("the doc chronology carries v2.172.0", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("The card expects the tick (v2.172.0)"), "v2.172.0 note missing");
  assert(doc.includes("The denial names its gate (v2.171.0)"), "v2.171.0 note drifted");
  assert(doc.includes("15-minute grace window"), "grace window doc missing");
  assert(doc.includes("`vercelHourUtc`"), "field bullet missing");
});

check("the v2172 suite exists and executes the math", () => {
  const t = read("src/tests/card-expects-tick-v2172.test.ts");
  assert(t.includes("the card expects the tick"), "suite header missing");
  assert(t.includes("import {\n  TICK_GRACE_MINUTES,"), "lib not imported for execution");
  assert(t.includes("TICK_GRACE_MINUTES).toBe(15)"), "grace value not executed");
});

console.log(`\nverify-v2-172-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
