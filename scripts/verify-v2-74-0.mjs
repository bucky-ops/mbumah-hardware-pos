#!/usr/bin/env node
// verify-v2-74-0.mjs — release gate for "the drawers talk to each other".
//
// Contracts locked:
//   1. Version slots: package.json 2.74.0 (3 slots) + verify script
//      registered; What's-New 2.74.0 leads the feed.
//   2. The cross-links: a request visit row's reviewer name and a reviewer
//      visit row's request title are doors — each jump closes the other
//      family (the one-drawer rule), records where it came from, and the
//      opened drawer offers the way back with a via chip.
//   3. The door guard: a request door is promised only when the file is on
//      the most-visited list (the section is a capped digest).
//   4. The memory is honest: plain toggles and scope changes clear the via
//      state, so a chip never describes a stale jump.
//   5. Prior anchors: both drawer families, the CSV voice, the print
//      pipeline, and the palette's jump-to-release group all survive.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
// This release's own pins — written atLeast from birth so the script keeps
// passing on later versions (every-round precedent).
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.74.0', atLeast(PKG.version, '2.74.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.74.0', atLeast(PKG.mbumah?.releaseVersion, '2.74.0'));
check('mbumah.baseVersion is >= 2.74.0', atLeast(PKG.mbumah?.baseVersion, '2.74.0'));
check('verify:v2-74-0 script registered', PKG.scripts?.['verify:v2-74-0'] === 'node scripts/verify-v2-74-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.74.0 entry first', WN.includes("version: '2.74.0'") && WN.indexOf("version: '2.74.0'") < WN.indexOf("version: '2.73.0'"));
check('whats-new leads with the cross-links story', WN.includes('The drawers talk to each other'));
check('whats-new feed has grown to 74+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 74);

console.log('== The pure module: the ledger names both families ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('deskReportRequestSubject recovers the human title from the ledger', MOD.includes('export function deskReportRequestSubject(') && MOD.includes('return entry ? { employeeName: entry.employeeName, leaveTypeName: entry.leaveTypeName } : null;'));
check('the subject lookup reads (find), never reorders', /const entry = ledger\.find\(\(e\) => e\.requestId === requestId\);/.test(MOD));
check('deskReportHasRequestDoor guards the capped digest', MOD.includes('export function deskReportHasRequestDoor(') && /return topRequests\.some\(\(r\) => r\.requestId === requestId\);/.test(MOD));
check('the module header tells the v2.74.0 story', MOD.includes('v2.74.0: the drawers talk to each other'));

console.log('== The view: every name inside a drawer is a door ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the view imports both cross-link helpers', VIEW.includes('deskReportHasRequestDoor,') && VIEW.includes('deskReportRequestSubject,'));
check('the view imports the jump affordance icons', VIEW.includes('ArrowUpRight') && VIEW.includes('CornerUpLeft'));
check('the two jump handlers exist', VIEW.includes('const jumpToReviewer = (name: string, fromRequestId: string) => {') && VIEW.includes('const jumpToRequest = (id: string, fromReviewer: string) => {'));
const jumpToReviewer = VIEW.split('const jumpToReviewer =')[1]?.split('const jumpToRequest =')[0] ?? '';
const jumpToRequest = VIEW.split('const jumpToRequest =')[1]?.split('const jumpBackToReviewer =')[0] ?? '';
check('a jump closes the OTHER family first (the one-drawer rule)', jumpToReviewer.includes('setOpenRequest(null);') && jumpToRequest.includes('setOpenReviewer(null);'));
check('a jump records where it came from', jumpToReviewer.includes('setViaReviewer(fromRequestId);') && jumpToRequest.includes('setViaRequest(fromReviewer);'));
check('a jump clears the opposite via state', jumpToReviewer.includes('setViaRequest(null);') && jumpToRequest.includes('setViaReviewer(null);'));
check('the way back exists in both directions', VIEW.includes('const jumpBackToReviewer = () => {') && VIEW.includes('const jumpBackToRequest = () => {'));
check('the back guards read the via state before acting', /if \(!viaRequest\) return;/.test(VIEW) && /if \(!viaReviewer\) return;/.test(VIEW));
const toggleReviewer = VIEW.split('const toggleReviewer =')[1]?.split('// v2.72.0 — the report reads the file')[0] ?? '';
const toggleRequest = VIEW.split('const toggleRequest =')[1]?.split('// v2.74.0 — the cross-links')[0] ?? '';
check('plain toggles clear the memory', toggleReviewer.includes('setViaRequest(null);') && toggleReviewer.includes('setViaReviewer(null);') && toggleRequest.includes('setViaRequest(null);') && toggleRequest.includes('setViaReviewer(null);'));
const clearDrawers = VIEW.split('const clearDrawers = () => {')[1]?.split('const toggleReviewer =')[0] ?? '';
check('the shared reset clears drawers AND memory', clearDrawers.includes('setOpenReviewer(null);') && clearDrawers.includes('setOpenRequest(null);') && clearDrawers.includes('setViaRequest(null);') && clearDrawers.includes('setViaReviewer(null);'));
const pickDays = VIEW.split('const pickDays =')[1]?.split('const pickBranch =')[0] ?? '';
const pickBranch = VIEW.split('const pickBranch =')[1]?.split('// v2.71.0')[0] ?? '';
check('scope changes go through the shared reset', pickDays.includes('clearDrawers();') && pickBranch.includes('clearDrawers();'));

check('a request visit row opens the reviewer it names', VIEW.includes('onClick={() => jumpToReviewer(v.reviewer, r.requestId)}') && VIEW.includes('data-testid="desk-report-request-visit-reviewer"'));
check('the reviewer door is labelled for the ears too', VIEW.includes("aria-label={`Open ${v.reviewer}'s visits`}") && VIEW.includes("aria-label={`Back to ${viaRequest}'s visits`}"));
check('a reviewer visit row opens the file it names', VIEW.includes('data-testid="desk-report-reviewer-visit-request"') && VIEW.includes('onClick={() => jumpToRequest(v.requestId, r.name)}'));
check('the request door is guarded by the digest cap', VIEW.includes('{deskReportHasRequestDoor(data.topRequests, v.requestId) ? (') && VIEW.includes('<>{v.employeeName}&apos;s {v.leaveTypeName}</>'));
check('the reviewer via chip reads its label from the SAME ledger', VIEW.includes('const viaBackSubject = viaReviewer ? deskReportRequestSubject(data.ledger, viaReviewer) : null;'));
check('both via chips exist and are testid-ed', VIEW.includes('data-testid="desk-report-reviewer-via"') && VIEW.includes('data-testid="desk-report-request-via"'));
check('the chips are the way back (one click)', VIEW.includes('onClick={jumpBackToRequest}') && VIEW.includes('onClick={jumpBackToReviewer}'));
check('the doors wear the jump affordance', (VIEW.split('data-testid="desk-report-request-visit-reviewer"')[1] ?? '').split('</button>')[0].includes('ArrowUpRight') && (VIEW.split('data-testid="desk-report-reviewer-visit-request"')[1] ?? '').split('</button>')[0].includes('ArrowUpRight'));
check('the reviewer door echoes the reviewer hue', (VIEW.split('data-testid="desk-report-request-visit-reviewer"')[1] ?? '').split('</button>')[0].includes('deskReportAvatarHue(v.reviewer)'));
check('the doors hover toward solid', VIEW.includes('hover:decoration-emerald-500 hover:decoration-solid'));
const reviewerViaChip = (VIEW.split('data-testid="desk-report-reviewer-via"')[1] ?? '').split('</button>')[0] ?? '';
check('the chips complete the emerald family in dark mode', reviewerViaChip.includes('dark:bg-slate-900/60') && reviewerViaChip.includes('dark:border-emerald-500/40') && reviewerViaChip.includes('dark:hover:bg-emerald-500/15'));
const reviewerPanel = VIEW.split('data-testid="desk-report-reviewer-panel"')[1]?.split('desk-report-reviewer-visits')[0] ?? '';
const requestPanel = VIEW.split('data-testid="desk-report-request-panel"')[1]?.split('desk-report-request-visits')[0] ?? '';
check('the drawers stay off the paper (cross-links included)', reviewerPanel.includes('print:hidden') && requestPanel.includes('print:hidden'));
check('the section hints say the rows are doors now', VIEW.includes('file names inside a drawer jump across') && VIEW.includes('reviewer names inside a drawer jump across'));

console.log('== Prior anchors: nothing else moved ==');
check('the reviewer doors survive', VIEW.includes('data-testid="desk-report-reviewer-toggle"') && VIEW.includes('data-testid="desk-report-reviewer-panel"'));
check('the request doors survive', VIEW.includes('data-testid="desk-report-request-toggle"') && VIEW.includes('data-testid="desk-report-request-panel"'));
check('the single-drawer rule survives on the toggles', /const toggleReviewer = \(name: string\) => \{[\s\S]*?setOpenRequest\(null\);/.test(VIEW) && /const toggleRequest = \(id: string\) => \{[\s\S]*?setOpenReviewer\(null\);/.test(VIEW));
check('the CSV voice survives', VIEW.includes('data-testid="desk-report-csv"'));
check('the print pipeline survives', VIEW.includes("printReceiptElement('desk-report-content')"));
check('the one-pass derivation survives', MOD.includes('export function deskReportReviewerLedger(') && MOD.includes('export function deskReportRequestLedger('));
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('the palette still knows the releases', CHROME.includes('data-testid={`palette-release-${r.version}`}') && CHROME.includes('<CommandGroup heading="Jump to release">'));
check('the changelog still lands its jumps', CHROME.includes('data-testid="changelog-jump-pill"'));

console.log('');
if (fail > 0) {
  console.log(`v2.74.0 verification: ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`v2.74.0 verification: ALL PASS (${pass} checks)`);
}
