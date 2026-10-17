#!/usr/bin/env node
// verify-v2-76-0.mjs — release gate for "the shortcuts arrive".
//
// Contracts locked:
//   1. Version slots: package.json 2.76.0 (3 slots) + verify script
//      registered; What's-New 2.76.0 leads the feed.
//   2. The pure stamp: whatsNewMarkAllTarget is the feed's head (an empty
//      feed stamps nothing).
//   3. The palette clears the inbox in place: the action renders only when
//      something is provably unread, writes the SAME shared flag the
//      changelog's "Got it" writes, claims the new state immediately, and
//      STAYS OPEN so the effect is the feedback.
//   4. The desk report walks: every door carries data-desk-door, j/k move
//      with wrap (cold start included), escape runs the shared reset, the
//      guards keep typing safe, and the hint never reaches paper.
//   5. Prior anchors: the reading-state inbox, the jump group, the footer
//      pill, the cross-links, and the drawers' print contract all survive.

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
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.76.0', atLeast(PKG.version, '2.76.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.76.0', atLeast(PKG.mbumah?.releaseVersion, '2.76.0'));
check('mbumah.baseVersion is >= 2.76.0', atLeast(PKG.mbumah?.baseVersion, '2.76.0'));
check('verify:v2-76-0 script registered', PKG.scripts?.['verify:v2-76-0'] === 'node scripts/verify-v2-76-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.76.0 entry first', WN.includes("version: '2.76.0'") && WN.indexOf("version: '2.76.0'") < WN.indexOf("version: '2.75.0'"));
check('whats-new leads with the shortcuts story', WN.includes('The shortcuts arrive'));
check('whats-new feed has grown to 76+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 76);

console.log('== The pure stamp: whatsNewMarkAllTarget ==');
check('whatsNewMarkAllTarget exists with the honest contract', WN.includes('export function whatsNewMarkAllTarget(): string | null') && WN.includes("return WHATS_NEW[0]?.version ?? null;"));
check('the doc block names the one-truth write it mirrors', WN.includes('the same one-truth write the changelog\'s "Got it"'));

console.log('== The palette: the inbox clears in place ==');
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('the palette imports the stamp helper', CHROME.includes("import { WHATS_NEW, whatsNewMarkAllTarget, whatsNewReadState, whatsNewUnreadCount, type WhatsNewEntry } from '@/lib/whats-new';"));
check('CheckCheck joins the icon set', CHROME.includes('CheckCheck, ChevronDown'));
check('the action renders only when something is provably unread', CHROME.includes('{seenState.read && unreadCount > 0 && whatsNewMarkAllTarget() ? ('));
const handler = CHROME.split('const markAllRead = () => {')[1]?.split('  };')[0] ?? '';
check('the handler stamps the feed head', handler.includes('const target = whatsNewMarkAllTarget();') && handler.includes('if (!target) return;'));
check('the handler writes the SAME shared flag', handler.includes('localStorage.setItem(SEEN_VERSION_KEY, target)'));
check('the handler claims the new state immediately', handler.includes('setSeenState({ read: true, value: target })'));
check('storage failure claims nothing', handler.includes('catch {') && handler.includes('return; // storage unavailable') && handler.indexOf('setSeenState') > handler.indexOf('localStorage.setItem'));
const actionItem = CHROME.split('data-testid="palette-mark-all-read"')[1]?.split('</CommandItem>')[0] ?? '';
check('the action keeps the palette open on select', actionItem.includes('onSelect={markAllRead}') && !actionItem.includes('onOpenChange(false)'));
check('the action carries the inbox family dress', actionItem.includes('CheckCheck') && actionItem.includes('text-emerald-500 dark:text-emerald-400') && actionItem.includes('Mark all releases read'));
check('the action tells the truth about staying open', actionItem.includes('stays open'));
check('the action explains itself on hover', CHROME.includes('Writes the same seen flag the changelog\u2019s \u201cGot it\u201d writes \u2014 the palette stays open'));
check('the action sits ahead of the release items', CHROME.indexOf('data-testid="palette-mark-all-read"') > -1 && CHROME.indexOf('data-testid="palette-mark-all-read"') < CHROME.indexOf('data-testid={`palette-release-${r.version}`}'));

console.log('== The desk report: the keyboard walks the doors ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('all six doors carry the walk key (attribute form only)', (VIEW.match(/data-desk-door\n/g) || []).length === 6);
const doorAnchors = ['desk-report-reviewer-toggle', 'desk-report-reviewer-via', 'desk-report-reviewer-visit-request', 'desk-report-request-toggle', 'desk-report-request-via', 'desk-report-request-visit-reviewer'];
check('rows, cross-links, and via chips are all doors', doorAnchors.every((a) => (VIEW.split(`data-testid="${a}"`)[1] ?? '').slice(0, 300).includes('data-desk-door')));
check('one document-level keydown listener, bound and unbound', VIEW.includes("document.addEventListener('keydown', onKeyDown);") && VIEW.includes("document.removeEventListener('keydown', onKeyDown);"));
const keyHandler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1]?.split('    };')[0] ?? '';
check('j is next with wrap, k is previous with wrap', keyHandler.includes('(idx + 1) % doors.length') && keyHandler.includes('(idx - 1 + doors.length) % doors.length'));
check('a cold start from nowhere lands on the first (or last) door', keyHandler.includes("e.key === 'j' ? 0 : doors.length - 1")); // index form since v2.77.0
check('the walk moves focus and stops the scroll', keyHandler.includes('next.focus({ preventScroll: true })') && keyHandler.includes("scrollIntoView({ block: 'nearest', behavior: 'smooth' })") && keyHandler.includes('e.preventDefault()')); // smooth glide since v2.77.0
check('the guards keep typing safe (no modifiers, no inputs)', keyHandler.includes('e.metaKey || e.ctrlKey || e.altKey') && keyHandler.includes('target.closest(\'input, textarea, select, [contenteditable="true"]\')'));
check('escape runs the shared reset (drawer + via memory)', keyHandler.includes("if (e.key === 'Escape')") && keyHandler.includes('clearDrawers();'));
check('only j / k / escape are claimed', keyHandler.includes("e.key !== 'j' && e.key !== 'k'"));
check('the walk follows DOM order (reviewers before most-visited)', VIEW.indexOf('data-testid="desk-report-reviewers"') > -1 && VIEW.indexOf('data-testid="desk-report-reviewers"') < VIEW.indexOf('data-testid="desk-report-top-requests"'));

console.log('== The hint: screen only, never on paper ==');
const hint = VIEW.split('data-testid="desk-report-kbd-hint"')[1]?.split('</span>')[0] ?? '';
check('the keyboard hint exists at the footnote', hint.length > 0 && hint.includes('walk the doors') && hint.includes('closes a drawer'));
check('the hint is screen-only', hint.includes('hidden') && hint.includes('sm:flex') && hint.includes('print:hidden'));
check('the hint dresses its keys as keys (3 kbd chips)', (hint.match(/<kbd /g) || []).length === 3 && hint.includes('font-mono'));

console.log('== Prior anchors: nothing else moved ==');
check('the reading-state inbox survives (per-version state testids)', CHROME.includes('data-testid={`palette-release-state-${r.version}`}'));
check('the unread counter survives', CHROME.includes('data-testid="palette-release-unread"') && CHROME.includes('{unreadCount} unread'));
check('no state claimed before the flag is read (unchanged)', CHROME.includes("state: seenState.read ? whatsNewReadState(e.version, seenState.value) : ('seen' as const),"));
check('the jump-to-release behavior is untouched', CHROME.includes('onSelect={() => { onOpenChange(false); onJumpToRelease(r.version); }}'));
check('the footer pill + Got-it write survive', CHROME.includes('data-testid="footer-changelog-pill"') && CHROME.includes("localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);"));
check('the modal jump landing survives', CHROME.includes('data-testid="changelog-jump-pill"'));
check('the store workspaces group survives', CHROME.includes('<CommandGroup heading="Store workspaces">'));
check('the cross-link jump handlers survive', VIEW.includes('onClick={() => jumpToReviewer(v.reviewer, r.requestId)}') && VIEW.includes('onClick={() => jumpToRequest(v.requestId, r.name)}') && VIEW.includes('onClick={jumpBackToRequest}') && VIEW.includes('onClick={jumpBackToReviewer}'));
check('the CSV filing survives', VIEW.includes('data-testid="desk-report-csv"'));
check('the print contract survives (both drawers + print element)', (VIEW.split('data-testid="desk-report-reviewer-panel"')[1] ?? '').includes('print:hidden') && (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('print:hidden') && VIEW.includes("printReceiptElement('desk-report-content')"));
check('the section hints survive', VIEW.includes('file names inside a drawer jump across') && VIEW.includes('reviewer names inside a drawer jump across'));

console.log('');
if (fail > 0) {
  console.log(`v2.76.0 verification: ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`v2.76.0 verification: ALL PASS (${pass} checks)`);
}
