#!/usr/bin/env node
// v2.144.0 verification — "the lens learns the other outcome".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the three-way outcome lens (UNKNOWN survives only under 'all'; a garbage
// lens degrades, never guesses), the picker's per-period outcome dots (one
// definition of "last" — through summarizeGateTimeline itself), and the
// card's joined segmented trio. Comment-stripping before code searches
// (house lesson 49).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};
/** Strip line comments so a quoted example in prose never satisfies a code pin. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const PURE = 'src/lib/hr/payroll/gate-timeline.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';
const TEST = 'src/tests/gate-lens-v2144.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.144.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.144.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.144.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.144.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-144-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.144.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.144.0'");
  assert(head > -1, 'whats-new 2.144.0 missing');
  assert(feed.indexOf("version: '") === head, '2.144.0 must LEAD the feed (the dialog reads WHATS_NEW[0])');
  assert(feed.includes('The lens learns the other outcome'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.144.0] The lens learns the other outcome'), 'CHANGELOG entry missing');
});

// ── the pure lens family ───────────────────────────────────────────────────
check('pure: GateTimelineLens type + gateTimelineLensFilter — three ways, garbage degrades to all', () => {
  const src = stripComments(read(PURE));
  assert(src.includes("export type GateTimelineLens = 'all' | 'blocked' | 'passed'"), 'lens type missing');
  assert(src.includes('export function gateTimelineLensFilter'), 'lens filter missing');
  assert(src.includes("if (lens === 'blocked') return rows.filter((r) => r && r.outcome === 'BLOCKED');"), 'blocked branch missing');
  assert(src.includes("if (lens === 'passed') return rows.filter((r) => r && r.outcome === 'PASSED');"), 'passed branch missing');
  assert(src.includes('return [...rows];'), 'all branch must be a COPY');
  assert(src.includes('if (!Array.isArray(rows)) return [];'), 'non-array guard missing');
});

check('pure: UNKNOWN rows survive only under all — neither lens may claim garbage', () => {
  const src = stripComments(read(PURE));
  // The lens branches match BLOCKED/PASSED EXACTLY (===): no range, no
  // includes, no truthiness — an UNKNOWN outcome can never satisfy either.
  const code = src;
  assert(code.includes("lens === 'blocked'") && code.includes("lens === 'passed'"), 'exact-match branches required');
  assert(!/lens[^\n]*==[^=]/.test(code.replace(/lens === '(all|blocked|passed)'/g, '')), 'lens compares must be exact matches only');
});

check('pure: scopeGateTimeline — lens ∩ period, garbage lens degrades, honest empty', () => {
  const src = stripComments(read(PURE));
  assert(src.includes("if (opts?.lens === 'blocked') out = out.filter((r) => r && r.outcome === 'BLOCKED');"), 'scope blocked branch missing');
  assert(src.includes("else if (opts?.lens === 'passed') out = out.filter((r) => r && r.outcome === 'PASSED');"), 'scope passed branch missing');
  assert(src.includes("typeof opts?.periodLabel === 'string' && opts.periodLabel ? opts.periodLabel : null"), 'period guard missing');
  assert(!/blockedOnly/.test(src), 'the v2.142 boolean must be GONE from the module');
});

check('pure: listTimelinePeriods wears lastOutcome through summarizeGateTimeline — ONE definition', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('lastOutcome:'), 'period entry missing lastOutcome');
  assert(src.includes('lastAtIso:'), 'period entry missing lastAtIso');
  assert(src.includes('const summary = summarizeGateTimeline(group);'), 'must reuse the summarizer, never a second parser');
  assert(src.includes("typeof row.runLabel !== 'string' || !row.runLabel.trim()"), 'unlabeled guard missing');
});

check('pure: the module stays PURE — the injected filename clock stays the only new Date()', () => {
  const src = stripComments(read(PURE));
  const clockUses = src.match(/new Date\(\)/g) ?? [];
  assert(clockUses.length === 1, `exactly one new Date() allowed (filename injection), got ${clockUses.length}`);
  assert(src.includes('when: Date = new Date()'), 'injection point missing');
  assert(!/@prisma\/client|node-fetch|axios|fetch\(|window\./.test(src), 'purity violation');
});

// ── the card contract ──────────────────────────────────────────────────────
check('card: the joined segmented trio with three aria-pressed members', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('data-testid="payroll-gate-timeline-lens"'), 'group container missing');
  assert(src.includes('role="group"'), 'role=group missing');
  for (const m of ['lens-all', 'lens-blocked', 'lens-passed']) {
    assert(src.includes(`payroll-gate-timeline-${m}`), `member ${m} missing`);
  }
  assert(src.includes("aria-pressed={timelineLens === 'all'}"), 'all aria-pressed missing');
  assert(src.includes("aria-pressed={timelineLens === 'blocked'}"), 'blocked aria-pressed missing');
  assert(src.includes("aria-pressed={timelineLens === 'passed'}"), 'passed aria-pressed missing');
  assert(src.includes("useState<GateTimelineLens>('all')"), 'lens state missing');
});

check('card: the lens dresses as the rows it keeps — neutral ALL, rose BLOCKED, emerald PASSED', () => {
  const src = read(PAGE);
  assert(src.includes('bg-muted text-foreground hover:bg-muted hover:text-foreground'), 'ALL active family missing');
  assert(src.includes('border border-rose-300 bg-rose-50 text-rose-800'), 'BLOCKED rose family missing');
  assert(src.includes('dark:bg-rose-950/50 dark:text-rose-300'), 'BLOCKED dark twins missing');
  assert(src.includes('border border-emerald-300 bg-emerald-50 text-emerald-800'), 'PASSED emerald family missing');
  assert(src.includes('dark:bg-emerald-950/50 dark:text-emerald-300'), 'PASSED dark twins missing');
  assert(src.includes('Passed only'), 'PASSED label missing');
  assert(src.includes('Blocked only'), 'BLOCKED label missing');
});

check('card: both composition sites read lens: timelineLens — the boolean is GONE', () => {
  const src = stripComments(read(PAGE));
  const uses = src.match(/lens: timelineLens,/g) ?? [];
  assert(uses.length === 2, `expected both call sites on lens: timelineLens, got ${uses.length}`);
  assert(!/blockedOnly|timelineBlockedOnly/.test(src), 'the boolean must be GONE from the page');
});

check('card: the scope-empty guard reads the lens; the lens-empty speaks the PASSED voice', () => {
  const src = read(PAGE);
  assert(src.includes("timelinePeriod && timelineLens === 'all'"), 'scope-empty guard missing');
  assert(src.includes('No passed attempts in this period'), 'PASSED empty (scoped) missing');
  assert(src.includes('No passed attempts in the window'), 'PASSED empty (unscoped) missing');
  assert(src.includes('the attempts on record were stopped or unreadable'), 'PASSED honesty missing');
});

check('card: the picker items wear the outcome dot — tone per outcome, word in the title', () => {
  const src = read(PAGE);
  assert(src.includes('data-testid="payroll-gate-timeline-period-outcome"'), 'dot testid missing');
  assert(src.includes('bg-emerald-500 dark:bg-emerald-400'), 'PASSED dot tone missing');
  assert(src.includes('bg-amber-500 dark:bg-amber-400'), 'BLOCKED dot tone missing');
  assert(src.includes('bg-muted-foreground/40'), 'fallback dot tone missing');
  assert(src.includes('Last attempt outcome:'), 'dot title missing');
  assert(src.includes('aria-hidden'), 'dot must be aria-hidden decoration');
});

check('card: the summary chip stays route-built; the scoped line still re-runs the summarizer', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('timeline.summary.attempts}'), 'route-built chip missing');
  assert(src.includes('summarizeGateTimeline(timelineFiltered)'), 'scoped summarizer missing');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: gate-lens-v2144 carries the round contract', () => {
  const src = read(TEST);
  assert(src.includes('gateTimelineLensFilter'), 'lens filter tests missing');
  assert(src.includes('UNKNOWN rows survive ONLY under all'), 'UNKNOWN honesty test missing');
  assert(src.includes("lastOutcome is the CLOCK-newest attempt's"), 'clock-based last test missing');
  assert(src.includes('payroll-gate-timeline-lens-blocked'), 'trio card pin missing');
});

check('tests: prior rounds re-anchored — no stale boolean pins remain in the suite', () => {
  for (const f of ['src/tests/gate-activity-v2142.test.ts', 'src/tests/gate-period-v2143.test.ts']) {
    const src = read(f);
    assert(!/filterGateTimeline|blockedOnly|timelineBlockedOnly/.test(src), `${f} still pins the boolean era`);
  }
  const counters = read('src/tests/console-changelog.test.ts');
  assert(counters.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(33)"), 'counter 2.110.0 not re-anchored to 33');
  assert(counters.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(66)"), 'counter 2.77.0 not re-anchored to 66');
});

check('docs: the run-lifecycle contract names the outcome lens', () => {
  const doc = read('docs/hr/payroll-run-lifecycle.md');
  assert(doc.includes('Outcome lens (v2.144.0)'), 'lens contract missing from the doc');
  assert(doc.includes('survive only under `all`'), 'UNKNOWN honesty missing from the doc');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
