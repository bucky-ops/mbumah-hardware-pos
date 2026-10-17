#!/usr/bin/env node
// verify-v2-73-0.mjs — release gate for "the palette knows the releases".
//
// Contracts locked:
//   1. Version slots: package.json 2.73.0 (3 slots) + verify script
//      registered; What's-New 2.73.0 leads the feed.
//   2. The palette grows a "Jump to release" group fed by the SAME WHATS_NEW
//      source (one item per release, newest first), items are testid-ed,
//      searchable, truncated, and selecting one closes the palette and jumps.
//   3. The modal lands the jump: deep targets force the backlog open, a
//      scroll effect (no setState) brings the entry into view, the jumped
//      entry wears the orange ring + "via cmd+K" pill; the page owns the
//      jump state and clears it on close; plain opens keep the collapse.
//   4. Prior anchors: collapse buttons, footer pill, shared seen flag,
//      login dialog, store workspaces intact.

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
check('package.json version is >= 2.73.0', atLeast(PKG.version, '2.73.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.73.0', atLeast(PKG.mbumah?.releaseVersion, '2.73.0'));
check('mbumah.baseVersion is >= 2.73.0', atLeast(PKG.mbumah?.baseVersion, '2.73.0'));
check('verify:v2-73-0 script registered', PKG.scripts?.['verify:v2-73-0'] === 'node scripts/verify-v2-73-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.73.0 entry first', WN.includes("version: '2.73.0'") && WN.indexOf("version: '2.73.0'") < WN.indexOf("version: '2.72.0'"));
check('whats-new leads with the palette-jump story', WN.includes('The palette knows the releases'));
check('whats-new feed has grown to 73+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 73);

console.log('== The palette: a jump-to-release group ==');
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('the palette takes the jump callback', CHROME.includes('onJumpToRelease: (version: string) => void;'));
check('release items derive from the SAME WHATS_NEW source', /const releaseActions = useMemo\(\s*\(\) => WHATS_NEW\.map\(/.test(CHROME) && CHROME.includes('label: `v${e.version} — ${e.title}`'));
check('the group is named "Jump to release" and sits after the workspaces', CHROME.includes('Jump to release') && CHROME.indexOf('Jump to release') > CHROME.indexOf('<CommandGroup heading="Store workspaces">')); // heading grew the unread counter in v2.75.0
check('items are testid-ed per version', CHROME.includes("data-testid={`palette-release-${r.version}`}"));
check('items are searchable by their own label + notes', CHROME.includes('value={`${r.label} release notes`}'));
check('long titles truncate inside the item', CHROME.includes('min-w-0 flex-1 truncate') && CHROME.includes('{r.label}')); // label wears the latest-bold conditional since v2.75.0
check('selecting one closes the palette and jumps', CHROME.includes('onSelect={() => { onOpenChange(false); onJumpToRelease(r.version); }}'));
check('the group wears the changelog icon', CHROME.includes('<ScrollText className={`mr-2 h-3.5 w-3.5 shrink-0')); // icon went state-conditional in v2.75.0
check('the search placeholder names releases too', CHROME.includes('placeholder="Search actions, stores, releases..."'));
check('the group only renders when the feed has entries', CHROME.includes('{releaseActions.length > 0 ? ('));
check('the store workspaces group survives untouched', CHROME.includes('<CommandGroup heading="Store workspaces">') && CHROME.includes('<Package className="mr-2 h-3.5 w-3.5 text-slate-400" />'));

console.log('== The modal: the jump lands somewhere real ==');
check('the modal takes the jump target', CHROME.includes('jumpTo?: string | null'));
check('the jump index resolves honestly (unknown = -1)', CHROME.includes('const jumpIndex = jumpTo ? WHATS_NEW.findIndex((e) => e.version === jumpTo) : -1;'));
check('a deep target forces the backlog open', CHROME.includes('const needsExpand = jumpIndex > INITIAL_VISIBLE;') && CHROME.includes('const effectiveShowAll = showAll || needsExpand;'));
check('a plain open still slices at INITIAL_VISIBLE', CHROME.includes('const visibleOlder = effectiveShowAll ? older : older.slice(0, INITIAL_VISIBLE);'));
check('the scroll effect guards open + target + known index', CHROME.includes('if (!open || !jumpTo || jumpIndex < 0) return;'));
check('the scroll effect scrolls the entry into view', CHROME.includes('scrollIntoView({ block: \'center\', behavior: \'smooth\' })'));
check('the scroll effect cleans its timer up', CHROME.includes('return () => window.clearTimeout(id);'));
check('the jumped entry wears the orange ring (dark complete)', CHROME.includes("focused ? ' ring-2 ring-orange-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''"));
check('the "via cmd+K" pill exists and is testid-ed', CHROME.includes('data-testid="changelog-jump-pill"') && CHROME.includes('via cmd+K'));
check('the pill wears the orange family in both modes', CHROME.includes('border-orange-300 bg-orange-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300'));
check('latest and older entries both receive focused', CHROME.includes('focused={jumpTo === latest.version}') && CHROME.includes('focused={jumpTo === entry.version}'));

console.log('== The page: the jump state lives on the console ==');
const PAGE = read('src/app/(shell)/console/page.tsx') ?? '';
check('the page owns releaseJump state', PAGE.includes('const [releaseJump, setReleaseJump] = useState<string | null>(null);'));
check('the palette handler sets the jump and opens the modal', PAGE.includes('onJumpToRelease={(v) => { setReleaseJump(v); setChangelogOpen(true); }}'));
check('closing the modal clears the jump', PAGE.includes('onOpenChange={(o) => { setChangelogOpen(o); if (!o) setReleaseJump(null); }} jumpTo={releaseJump}'));

console.log('== Prior anchors ==');
check('the backlog collapse buttons survive', CHROME.includes('data-testid="changelog-show-older"') && CHROME.includes('data-testid="changelog-show-fewer"'));
check('the footer release-waiting pill survives', CHROME.includes('data-testid="footer-changelog-pill"'));
check('the shared seen flag survives', CHROME.includes("const SEEN_VERSION_KEY = 'mbt_seen_version';") && CHROME.includes('localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);'));
check('the GitHub changelog link survives', CHROME.includes('data-testid="changelog-github-link"'));
check('the changelog modal testid survives', CHROME.includes('data-testid="changelog-modal"'));
check('the version header badge survives', CHROME.includes('{APP_BUILD_LABEL}'));
check('the morning-note report page is untouched', (read('src/app/(shell)/org/desk-report/page.tsx') ?? '').includes('DeskReportView'));
check('the desk report drill-downs survive', (read('src/components/org/desk-report-view.tsx') ?? '').includes('deskReportRequestLedger,') && (read('src/components/org/desk-report-view.tsx') ?? '').includes('deskReportReviewerLedger,'));

console.log(`\nv2.73.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) {
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  process.exit(1);
}
