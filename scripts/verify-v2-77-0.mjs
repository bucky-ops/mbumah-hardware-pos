#!/usr/bin/env node
// verify-v2-77-0.mjs — release gate for "the shortcut sheet tells the whole
// story".
//
// Contracts locked:
//   1. Version slots: package.json 2.77.0 (3 slots) + verify script
//      registered; What's-New 2.77.0 leads the feed.
//   2. The shortcuts modal has a labeled "On the desk report" section with
//      the three desk keys, after the console rows, in the kbd dress.
//   3. The walk can be followed: smooth nearest-edge scroll (no jump), an
//      aria-live announcer naming each door, honest Escape silence.
//   4. Escape restores focus to the row that owned the drawer (APG dialog
//      pattern) via data-reviewer-name / data-request-id + row labels.
//   5. Prior anchors: mark-all action, inbox, 6 doors, kbd hint survive.

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
check('package.json version is >= 2.77.0', atLeast(PKG.version, '2.77.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.77.0', atLeast(PKG.mbumah?.releaseVersion, '2.77.0'));
check('mbumah.baseVersion is >= 2.77.0', atLeast(PKG.mbumah?.baseVersion, '2.77.0'));
check('verify:v2-77-0 script registered', PKG.scripts?.['verify:v2-77-0'] === 'node scripts/verify-v2-77-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.77.0 entry first', WN.includes("version: '2.77.0'") && WN.indexOf("version: '2.77.0'") < WN.indexOf("version: '2.76.0'"));
check('whats-new leads with the discoverable-walk story', WN.includes('The shortcut sheet tells the whole story'));
check('whats-new feed has grown to 77+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 77);

console.log('== The shortcuts modal: the sheet tells the whole story ==');
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('the desk section exists and is labeled', CHROME.includes('data-testid="shortcuts-desk-section"') && CHROME.includes('On the desk report') && CHROME.includes('/org/desk-report'));
check('the three desk keys are listed with where they work', CHROME.includes("['j', 'Desk report: walk to the next door']") && CHROME.includes("['k', 'Desk report: walk to the previous door']") && CHROME.includes("['esc', 'Desk report: close the open drawer']"));
check('the section sits after the console rows', CHROME.indexOf('data-testid="shortcuts-desk-section"') > CHROME.indexOf("['cmd + K', 'Command palette']"));
const deskSection = CHROME.split('<div data-testid="shortcuts-desk-section"')[1]?.split('</div>')[0] ?? '';
check('the section reuses the kbd row dress and carries a marker icon', deskSection.includes('deskRows.map') && deskSection.includes('font-mono text-[10px]') && deskSection.includes('FileText'));
check('the console rows are untouched', CHROME.includes("['cmd + K', 'Command palette']") && CHROME.includes("['F5', 'Force live feed refresh']"));
check('FileText joined the icon set', CHROME.includes('ExternalLink, FileText, History'));

console.log('== The walk can be followed ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
const keyHandler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1]?.split('    };')[0] ?? '';
check('the focused door glides (focus without jump, smooth nearest scroll)', keyHandler.includes('next.focus({ preventScroll: true })') && keyHandler.includes("next.scrollIntoView({ block: 'nearest', behavior: 'smooth' })"));
check('every move is announced with position and label', keyHandler.includes('announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`)'));
check('the label comes from the door itself', keyHandler.includes("next.getAttribute('aria-label') ?? next.textContent?.trim() ?? 'door'"));
check('the announcer is a polite live region, sr-only, mounted at the root', VIEW.includes('data-testid="desk-report-walk-announcer"') && VIEW.includes('role="status"') && VIEW.includes('aria-live="polite"') && VIEW.includes('className="sr-only"') && VIEW.includes('{walkAnnouncement}'));
check('the effect reads the drawer state live (deps carry both drawers)', VIEW.includes('[clearDrawers, openReviewer, openRequest]'));

console.log('== Escape returns to the row that owned the drawer ==');
const escapeBlock = VIEW.split("if (e.key === 'Escape') {")[1]?.split('        return;')[0] ?? '';
check('silence is honest: nothing open announces nothing', escapeBlock.includes('if (!wasReviewer && !wasRequest) return; // nothing open: silence is honest'));
check('the reset still runs through the shared clearDrawers', escapeBlock.includes('clearDrawers();'));
check('focus restoration targets the owning row (CSS.escape both families)', escapeBlock.includes('data-reviewer-name="${CSS.escape(wasReviewer)}"') && escapeBlock.includes('data-request-id="${CSS.escape(wasRequest)}"'));
check('the restored row is focused without a jump and announced by name', escapeBlock.includes('row.focus({ preventScroll: true })') && escapeBlock.includes("row.getAttribute('data-desk-row-label')"));
check('the rows carry their identity', (VIEW.split('data-testid="desk-report-reviewer-toggle"')[1] ?? '').slice(0, 400).includes('data-reviewer-name={r.name}') && (VIEW.split('data-testid="desk-report-request-toggle"')[1] ?? '').slice(0, 400).includes('data-request-id={r.requestId}') && (VIEW.split('data-testid="desk-report-request-toggle"')[1] ?? '').slice(0, 400).includes("data-desk-row-label={`${r.employeeName}'s ${r.leaveTypeName}`}"));

console.log('== Prior anchors: nothing else moved ==');
check('the six doors keep their walk key', (VIEW.match(/data-desk-door\n/g) || []).length === 6);
check('the footnote kbd hint survives', VIEW.includes('data-testid="desk-report-kbd-hint"') && (VIEW.split('data-testid="desk-report-kbd-hint"')[1] ?? '').includes('print:hidden'));
check('the wrap walk survives (cold start + both wraps)', keyHandler.includes("e.key === 'j' ? 0 : doors.length - 1") && keyHandler.includes('(idx + 1) % doors.length') && keyHandler.includes('(idx - 1 + doors.length) % doors.length'));
check('the guards survive (no modifiers, never inside an input)', keyHandler.includes('e.metaKey || e.ctrlKey || e.altKey') && keyHandler.includes("target.closest('input, textarea, select, [contenteditable=\"true\"]')"));
check('the mark-all action survives', CHROME.includes('data-testid="palette-mark-all-read"') && CHROME.includes('{seenState.read && unreadCount > 0 && whatsNewMarkAllTarget() ? ('));
check('the reading-state inbox survives', CHROME.includes('data-testid={`palette-release-state-${r.version}`}') && CHROME.includes('data-testid="palette-release-unread"'));
check('the cross-link doors survive', VIEW.includes('data-testid="desk-report-request-visit-reviewer"') && VIEW.includes('data-testid="desk-report-reviewer-visit-request"'));
check('the drawers keep their print contract', (VIEW.split('data-testid="desk-report-reviewer-panel"')[1] ?? '').includes('print:hidden') && (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('print:hidden'));

console.log('');
if (fail > 0) {
  console.log(`v2.77.0 verification: ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`v2.77.0 verification: ALL PASS (${pass} checks)`);
}
