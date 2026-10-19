#!/usr/bin/env node
// v2.135.0 verification — "the verdict leaves a paper trail".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the freeze contract: prepare's OWN gate loop must stamp the verdict on
// BOTH paths (the blocked stop and the clear pass), the UI must parse it
// through the tolerant pure builder and render NOTHING when there is no
// snapshot (honest absence, never a guess), and the remediation door must
// exist ONLY where a real fix-desk exists. Comment-stripping before code
// searches (house lesson 49): a comment that QUOTES a string is not the
// string living in code.

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

const SCHEMA = 'prisma/schema.prisma';
const SERVICE = 'src/lib/hr/payroll/run-service.ts';
const BUILDER = 'src/lib/hr/payroll/gate-verdict.ts';
const LIST_ROUTE = 'src/app/api/payroll/runs/route.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';
const DIALOG = 'src/components/hr/payroll-run-dialog.tsx';
const TEST = 'src/tests/payroll-gate-verdict-v2135.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.135.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.135.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.135.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.135.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-135-0'], 'verify script entry missing');
});

check('whats-new: 2.135.0 leads the feed with the paper-trail story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.135.0'");
  assert(head > -1, 'no 2.135.0 entry');
  assert(head < wn.indexOf("version: '2.134.0'"), '2.135.0 does not lead');
  assert(wn.includes('The verdict leaves a paper trail'), 'title missing');
  const entry = wn.slice(head, wn.indexOf("version: '2.134.0'"));
  const bullets = entry.match(/^ {6}'.*',$/gm) || [];
  assert(bullets.length >= 3 && bullets.length <= 6, `bullet count ${bullets.length}`);
});

check('changelog: [2.135.0] carries Added + Changed with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.135.0]');
  assert(head > -1, 'no [2.135.0] section');
  assert(head < cl.indexOf('## [2.134.0]'), '2.135.0 does not lead');
  const entry = cl.slice(head, cl.indexOf('## [2.134.0]'));
  assert(entry.includes('### Added'), 'no Added section');
  assert(entry.includes('### Changed'), 'no Changed section');
});

// ── schema: the snapshot has somewhere to live ─────────────────────────────
check('schema: PayrollRun carries nullable gateCheckedAt + gateSummary (additive)', () => {
  const s = stripComments(read(SCHEMA));
  assert(s.includes('gateCheckedAt DateTime?'), 'gateCheckedAt missing');
  assert(s.includes('gateSummary   Json?'), 'gateSummary missing');
  // Both sit INSIDE the PayrollRun model (between its model braces).
  const model = s.slice(s.indexOf('model PayrollRun '), s.indexOf('model PayrollDetail'));
  assert(model.includes('gateCheckedAt'), 'columns not inside PayrollRun');
});

// ── the pure builder: the tolerant reader ──────────────────────────────────
check('builder: gate-verdict.ts exports the parser, the text, and the tone', () => {
  const b = stripComments(read(BUILDER));
  assert(b.includes('export function parseGateVerdict('), 'parser missing');
  assert(b.includes('export function buildGateVerdictText('), 'text missing');
  assert(b.includes('export function gateVerdictTone('), 'tone missing');
  assert(b.includes('clear + missingConsent + timesheetNotApproved !== total'), 'tally-adds-up pin missing');
  // Only the gate's own two codes are speakable.
  assert(b.includes("'MISSING_CONSENT'") && b.includes("'TIMESHEET_NOT_APPROVED'"), 'code vocabulary incomplete');
});

// ── the freeze contract: prepare stamps both paths ─────────────────────────
check('freeze: the loop tallies consent/timesheet/clear and stamps BOTH paths', () => {
  const s = stripComments(read(SERVICE));
  assert(s.includes('gateTally.total += 1'), 'total tally missing');
  assert(s.includes('gateTally.missingConsent += 1'), 'consent tally missing');
  assert(s.includes('gateTally.timesheetNotApproved += 1'), 'timesheet tally missing');
  assert(s.includes('gateTally.clear += 1'), 'clear tally missing');
  // BLOCKED path: snapshot rides WITH the persisted issues.
  assert(/errorMessage: JSON\.stringify\(issues\),[\s\S]{0,400}?gateCheckedAt: new Date\(\)/.test(s), 'blocked path not stamped');
  // SUCCESS path: snapshot rides the re-prepare tx update.
  assert(/errorMessage: null,[\s\S]{0,600}?gateCheckedAt: new Date\(\),[\s\S]{0,300}?gateSummary: gateTally/.test(s), 'success path not stamped');
});

check('freeze: the list API exposes the verdict additively (null-safe for old rows)', () => {
  const r = stripComments(read(LIST_ROUTE));
  assert(r.includes('gateCheckedAt: r.gateCheckedAt?.toISOString() ?? null'), 'gateCheckedAt not exposed');
  assert(r.includes('gateSummary: r.gateSummary ?? null'), 'gateSummary not exposed');
});

// ── the honesty contracts: the UI never guesses ────────────────────────────
check('honesty: the runs table parses through the pure builder and renders nothing on absence', () => {
  const p = stripComments(read(PAGE));
  assert(p.includes('parseGateVerdict(run.gateSummary, run.gateCheckedAt)'), 'table bypasses the parser');
  assert(p.includes('data-testid="payroll-run-gate-verdict"'), 'verdict chip missing');
  assert(/const verdict = parseGateVerdict\(run\.gateSummary, run\.gateCheckedAt\);\s*if \(!verdict\) return null;/.test(p), 'absence does not render nothing');
});

check('honesty: the run dialog speaks the frozen strip and the pre-v2.135 absence note', () => {
  const d = stripComments(read(DIALOG));
  assert(d.includes('data-testid="payroll-run-gate-verdict-strip"'), 'strip missing');
  assert(d.includes('data-testid="payroll-run-gate-verdict-missing"'), 'absence note missing');
  assert(d.includes('the live gate may have moved since'), 'staleness honesty missing');
  assert(d.includes('parseGateVerdict(run.gateSummary, run.gateCheckedAt)'), 'dialog bypasses the parser');
});

// ── the remediation door: diagnosis joins its fix ──────────────────────────
check('door: MISSING_CONSENT rows link the consent ledger; timesheet rows never do', () => {
  const p = stripComments(read(PAGE));
  assert(p.includes('data-testid="payroll-gate-consent-door"'), 'consent door missing');
  assert(p.includes('href="/hr/reports?tab=privacy"'), 'consent ledger href missing');
  assert(p.includes('target="_blank"') && p.includes('rel="noopener noreferrer"'), 'door does not open its own tab');
  // The door is keyed on the consent branch ONLY.
  assert(/r\.gateState === 'MISSING_CONSENT' \? \(/.test(p), 'door not gated on the consent branch');
});

// ── tests exist and pin the story ──────────────────────────────────────────
check('tests: the v2.135 suite pins parser, freeze, honesty, door, and styling', () => {
  const t = read(TEST);
  for (const pin of [
    'parseGateVerdict',
    'buildGateVerdictText',
    'gateVerdictTone',
    'gateTally',
    'payroll-run-gate-verdict',
    'payroll-gate-consent-door',
    'dark:border-emerald-900',
    'focus-visible:ring-2',
  ]) {
    assert(t.includes(pin), `suite missing pin: ${pin}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
