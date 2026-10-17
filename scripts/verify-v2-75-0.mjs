#!/usr/bin/env node
// verify-v2-75-0.mjs — release gate for "the palette knows what you've read".
//
// Contracts locked:
//   1. Version slots: package.json 2.75.0 (3 slots) + verify script
//      registered; What's-New 2.75.0 leads the feed.
//   2. The pure reading-state helpers: semver-aware ordering (the 2.9 vs
//      2.10 trap is dead), one-truth read states, honest unread counting.
//   3. The palette reads the SHARED seen flag on open (deferred, re-read
//      every open), derives per-item latest/new/seen, testids its markers,
//      and counts the unread in the group heading.
//   4. The honesty rule: no unread claims without a reference point (a null
//      flag renders no "new" chips), and no state claimed before the flag
//      has actually been read.
//   5. Prior anchors: the jump group, the modal's jump + "Got it", the
//      footer pill, and the desk report cross-links all survive.

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
check('package.json version is >= 2.75.0', atLeast(PKG.version, '2.75.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.75.0', atLeast(PKG.mbumah?.releaseVersion, '2.75.0'));
check('mbumah.baseVersion is >= 2.75.0', atLeast(PKG.mbumah?.baseVersion, '2.75.0'));
check('verify:v2-75-0 script registered', PKG.scripts?.['verify:v2-75-0'] === 'node scripts/verify-v2-75-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.75.0 entry first', WN.includes("version: '2.75.0'") && WN.indexOf("version: '2.75.0'") < WN.indexOf("version: '2.74.0'"));
check('whats-new leads with the release-inbox story', WN.includes('The palette knows what you'));
check('whats-new feed has grown to 75+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 75);

console.log('== The pure module: semver ordering + one-truth read states ==');
check('compareWhatsNewVersions is component-wise', WN.includes('export function compareWhatsNewVersions(a: string, b: string): number') && WN.includes('const pa = a.split(\'.\').map(Number);'));
check('whatsNewReadState exists with the one-truth contract', WN.includes('export function whatsNewReadState(version: string, seenVersion: string | null): WhatsNewReadState'));
check('the latest is the feed head, always', WN.includes("if (version === WHATS_NEW[0]?.version) return 'latest';"));
check('new is claimed only against an EXISTING flag', WN.includes("if (seenVersion && compareWhatsNewVersions(version, seenVersion) > 0) return 'new';"));
check('whatsNewUnreadCount filters the feed', WN.includes('export function whatsNewUnreadCount(seenVersion: string | null): number') && WN.includes("whatsNewReadState(e.version, seenVersion) === 'new'"));

console.log('== The palette: a release inbox, not just a jump list ==');
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('the palette imports the reading-state helpers', CHROME.includes("from '@/lib/whats-new';") && CHROME.includes('WHATS_NEW') && CHROME.includes('whatsNewReadState') && CHROME.includes('whatsNewUnreadCount')); // import list may grow (v2.76.0 added the mark-all stamp)
check('the shared flag is read when the palette OPENS', CHROME.includes('const [seenState, setSeenState] = useState<{ read: boolean; value: string | null }>({ read: false, value: null });') && CHROME.includes('localStorage.getItem(SEEN_VERSION_KEY)'));
check('the read is deferred (no setState inside the effect body)', /if \(!open\) return;\s*\n\s*const id = window\.setTimeout/.test(CHROME));
check('the flag is re-read on every open (Got-it lands on next cmd+K)', /localStorage\.getItem\(SEEN_VERSION_KEY\)[\s\S]{0,220}/.test(CHROME) && CHROME.includes('[open]);'));
check('no state is claimed before the flag has been read', CHROME.includes("state: seenState.read ? whatsNewReadState(e.version, seenState.value) : ('seen' as const),") && CHROME.includes('(seenState.read ? whatsNewUnreadCount(seenState.value) : 0)'));
check('items carry per-version state testids', CHROME.includes('data-testid={`palette-release-state-${r.version}`}'));

const latestChip = CHROME.split("r.state === 'latest' ? (")[1]?.split(") : r.state === 'new' ?")[0] ?? '';
check('the latest wears the modal\u2019s emerald badge', latestChip.includes('Sparkles') && latestChip.includes('dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-300'));
const freshChip = CHROME.split(") : r.state === 'new' ? (")[1]?.split(") : (")[0] ?? '';
check('new arrivals wear the outline chip', freshChip.includes('border-emerald-200') && freshChip.includes('dark:border-emerald-500/30 dark:text-emerald-400') && freshChip.includes('title={`v${r.version} arrived after you last read the notes`}'));
check('read releases keep the quiet "notes" hint', CHROME.includes('<span className="ml-auto shrink-0 text-[10px] text-slate-400">notes</span>'));
check('the group heading counts the unread', CHROME.includes('data-testid="palette-release-unread"') && CHROME.includes('{unreadCount} unread'));
check('the counter explains itself on hover', CHROME.includes("${unreadCount === 1 ? '' : 's'} arrived after you last read the notes"));
check('the latest item reads first-class (emerald icon + bold title)', CHROME.includes("r.state === 'latest' ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'") && CHROME.includes("r.state === 'latest' ? 'font-semibold text-slate-800 dark:text-slate-100' : ''"));
check('the jump behavior is untouched', CHROME.includes('onSelect={() => { onOpenChange(false); onJumpToRelease(r.version); }}'));

console.log('== Prior anchors: nothing else moved ==');
check('the footer pill survives (same flag, same family)', CHROME.includes('data-testid="footer-changelog-pill"') && CHROME.includes("setReleaseWaiting(localStorage.getItem(SEEN_VERSION_KEY) !== APP_VERSION);"));
check('the modal\u2019s Got-it still writes the shared flag', CHROME.includes("localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);"));
check('the modal\u2019s jump landing survives', CHROME.includes('data-testid="changelog-jump-pill"') && CHROME.includes("focused ? ' ring-2 ring-orange-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''"));
check('the modal\u2019s latest pill survives', CHROME.includes('data-testid="changelog-latest-pill"'));
check('the jump-to-release items keep their testids + search value', CHROME.includes('data-testid={`palette-release-${r.version}`}') && CHROME.includes('value={`${r.label} release notes`}'));
check('the store workspaces group survives', CHROME.includes('<CommandGroup heading="Store workspaces">'));
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the desk report cross-links survive (v2.74.0)', MOD.includes('export function deskReportRequestSubject(') && VIEW.includes('data-testid="desk-report-request-visit-reviewer"') && VIEW.includes('data-testid="desk-report-reviewer-visit-request"'));
check('the drawers keep their print contract', (VIEW.split('data-testid="desk-report-reviewer-panel"')[1] ?? '').includes('print:hidden'));

console.log('');
if (fail > 0) {
  console.log(`v2.75.0 verification: ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`v2.75.0 verification: ALL PASS (${pass} checks)`);
}
