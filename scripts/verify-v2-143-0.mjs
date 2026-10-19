#!/usr/bin/env node
// v2.143.0 verification — "the story scopes itself".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the period scope (a pure list + a pure period ∩ lens filter riding the
// payload the read already returns), the scoped count line (the pure
// summarizer re-run on the scoped set; the header chip keeps speaking ALL),
// the row-label click-to-scope, and the export that follows both dimensions
// with a filename that says when it is scoped. Comment-stripping before
// code searches (house lesson 49).

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
const DOC = 'docs/hr/payroll-run-lifecycle.md';
const TEST = 'src/tests/gate-period-v2143.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.143.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.143.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.143.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.143.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-143-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.143.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.143.0'");
  assert(head > -1, 'whats-new 2.143.0 missing');
  assert(feed.indexOf("version: '") === head, '2.143.0 must LEAD the feed (the dialog reads WHATS_NEW[0])');
  assert(feed.includes('The story scopes itself'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.143.0] The story scopes itself'), 'CHANGELOG entry missing');
});

// ── the pure additions ─────────────────────────────────────────────────────
check('pure: listTimelinePeriods — distinct labels, distinct runs, unlabeled never invent', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function listTimelinePeriods'), 'period list missing');
  assert(src.includes('entry.runs.add(row.runId)'), 'runs must be DISTINCT run ids, not row count');
  assert(src.includes("typeof row.runLabel !== 'string' || !row.runLabel.trim()"), 'unlabeled guard missing');
  assert(src.includes('if (!Array.isArray(rows)) return [];'), 'non-array guard missing');
});

check('pure: scopeGateTimeline — one composition point, copy semantics, honest empty', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function scopeGateTimeline'), 'scope filter missing');
  assert(src.includes("rows.filter((r) => r && r.runLabel === period)"), 'period narrowing missing');
  assert(src.includes("out.filter((r) => r && r.outcome === 'BLOCKED')"), 'lens composition missing');
  assert(src.includes('return [...rows]'), 'both-off must return a COPY, never the caller\'s array');
  assert(src.includes("typeof opts?.periodLabel === 'string' && opts.periodLabel"), 'null/empty = all missing');
});

check('pure: gateTimelineCsvFilename — slug discipline, INJECTED clock', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function gateTimelineCsvFilename'), 'filename builder missing');
  assert(src.includes("when: Date = new Date()"), 'clock must be injected (the consent filenames\' own pattern)');
  assert(src.includes("replace(/[^a-z0-9]+/g, '-')"), 'slug discipline missing');
  assert(src.includes('`gate-activity-${slug}-${date}.csv`'), 'scoped filename shape missing');
  assert(src.includes('`gate-activity-${date}.csv`'), 'unscoped filename shape missing');
});

check('pure: the module keeps its PURE head — no db, no network', () => {
  // The purity contract LIVES in a comment — read raw, never strip here.
  const raw = read(PURE);
  const src = stripComments(raw);
  assert(raw.includes('PURE module: no db, no network, no clock, no window'), 'purity contract line missing');
  assert(!src.includes("from '@/lib/db'"), 'db import must not exist');
  assert(!/fetch\(/.test(src), 'network call must not exist');
});

check('pure: filterGateTimeline survives untouched (the v2.142 lens tests keep their subject)', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function filterGateTimeline'), 'v2.142 lens must remain exported');
});

// ── the card contract ─────────────────────────────────────────────────────
check('card: the picker renders ONLY when a labeled period exists; All periods is real', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('timelinePeriods.length > 0 ? ('), 'picker presence gate missing');
  assert(src.includes('payroll-gate-timeline-period-picker'), 'picker testid missing');
  assert(src.includes("value={timelinePeriod ?? '__all__'}"), 'All-periods sentinel missing');
  assert(src.includes('All periods'), 'All periods option missing');
});

check('card: the header chip keeps speaking the ROUTE-built ALL count', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('{timeline.summary.attempts}'), 'chip must read the route-built summary');
});

check('card: the scoped set feeds rows, bound, line, and export from ONE memo', () => {
  const src = stripComments(read(PAGE));
  assert(
    src.includes('scopeGateTimeline(timeline?.rows ?? [], {\n        blockedOnly: timelineBlockedOnly,\n        periodLabel: timelinePeriod,\n      })'),
    'timelineFiltered must be the one scopeGateTimeline memo',
  );
  assert(src.includes('timelineShowAll ? timelineFiltered : timelineFiltered.slice(0, 8)'), 'bound must read the scoped set');
  assert(src.includes('summarizeGateTimeline(timelineFiltered)'), 'scoped line must re-run the pure summarizer');
  assert(src.includes('payroll-gate-timeline-scoped'), 'scoped line testid missing');
});

check('card: a row label scopes on click — hover, focus ring, per-period aria', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('payroll-gate-timeline-run-'), 'row run-label testid missing');
  assert(src.includes('setTimelinePeriod(row.runLabel)'), 'click must set the period scope');
  assert(src.includes('hover:underline focus-visible:outline-none focus-visible:ring-1'), 'affordance styling missing');
});

check('card: the export follows BOTH dimensions and the filename says it', () => {
  const src = stripComments(read(PAGE));
  assert(
    src.includes('scopeGateTimeline(timeline.rows, {\n      blockedOnly: timelineBlockedOnly,\n      periodLabel: timelinePeriod,\n    })'),
    'export must map the scoped set',
  );
  assert(src.includes('gateTimelineCsvFilename(timelinePeriod)'), 'filename must speak the scope');
  assert(src.includes('filtered to the current period and lens'), 'export title honesty missing');
});

check('card: both honest empties keep their own voices', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('payroll-gate-timeline-scope-empty'), 'scope-empty testid missing');
  assert(src.includes('payroll-gate-timeline-lens-empty'), 'lens-empty testid missing');
  assert(src.includes('timelinePeriod && !timelineBlockedOnly ?'), 'scope-empty must speak only the vanished-window case');
  assert(src.includes('No blocked attempts in this period'), 'lens-empty must name the period when one is picked');
});

// ── discipline ────────────────────────────────────────────────────────────
check('docs: the store-timeline contract names the period scope', () => {
  const doc = read(DOC);
  assert(doc.toLowerCase().includes('period scope'), 'doc must name the period scope');
  assert(doc.includes('gate-activity-'), 'doc must name the scoped filename');
});

check('tests: the v2.143.0 suite exists and covers the scope family', () => {
  const src = read(TEST);
  assert(src.includes('listTimelinePeriods'), 'suite must cover the period list');
  assert(src.includes('scopeGateTimeline'), 'suite must cover the scope filter');
  assert(src.includes('gateTimelineCsvFilename'), 'suite must cover the filename');
  assert(src.includes("setTimelinePeriod(row.runLabel)"), 'suite must pin the row-label click');
});

const total = pass + fail;
console.log(`\n${pass}/${total} checks passed`);
if (fail > 0) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK — v2.143.0 the story scopes itself');
