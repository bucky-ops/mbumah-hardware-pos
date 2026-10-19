import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WHATS_NEW, compareWhatsNewVersions, whatsNewMarkAllTarget, whatsNewReadState, whatsNewUnreadCount } from '@/lib/whats-new';

/**
 * v2.66.0 contracts — the console catches up on the news.
 *
 * Gap: the console's Changelog modal was a FROZEN v2.18.3-era list —
 * three hardcoded entries (v2.18.3 / v2.18.1 / v2.16.0) disconnected from
 * the app's WHATS_NEW feed that had grown to 66 entries. The console told
 * a two-year-old story while the POS app celebrated every release. A
 * manager opening the console never learned what shipped.
 *
 * Covered here:
 *  1. ChangelogModal renders the SAME WHATS_NEW source as the tabs shell's
 *     auto-dialog — newest first, latest release emerald-highlighted with
 *     a "latest" pill, older releases muted, per-entry testids.
 *  2. The backlog collapse: latest + 5 older render open; a "Show N older
 *     releases" button expands (and a "Show fewer" collapses) so the modal
 *     never drowns at 66+ entries.
 *  3. The shared seen flag: "Got it" writes mbt_seen_version = APP_VERSION
 *     (the same key the tabs shell's auto-dialog writes) — one flag across
 *     surfaces, no double-nag.
 *  4. The footer's Changelog button wears an SSR-safe "new" pill (mount
 *     gate via useSyncExternalStore) whenever unread release notes wait,
 *     with dark-mode-complete styling on footer, modal and entries.
 *  5. The business contacts block survives the rewrite.
 *  6. What's-New 2.66.0 leads with the catch-up story.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The modal renders the real release feed ──────────────────────────────

describe('ChangelogModal - the console tells the whole release story', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('imports the shared WHATS_NEW feed (single source of truth)', () => {
    // v2.75.0 — the reading-state helpers ride the same import; v2.76.0
    // added the mark-all stamp, so the pin checks membership, not spelling.
    expect(CHROME).toContain("from '@/lib/whats-new';");
    expect(CHROME).toContain('WHATS_NEW');
    expect(CHROME).toContain('whatsNewReadState');
    expect(CHROME).toContain('whatsNewUnreadCount');
  });

  it('imports APP_VERSION alongside the build label', () => {
    expect(CHROME).toContain("import { APP_BUILD_LABEL, APP_VERSION } from '@/lib/version';");
  });

  it('the static v2.18.3-era story is gone', () => {
    expect(CHROME).not.toContain('v2.18.3 - Organization Console joins the unified lineage');
    expect(CHROME).not.toContain('v2.18.1 - Branch manager user-store binding');
    expect(CHROME).not.toContain('v2.16.0 - Subdomain workspaces');
  });

  it('splits the feed into latest + older (newest first)', () => {
    expect(CHROME).toMatch(/const \[latest, \.\.\.older\] = WHATS_NEW;/);
  });

  it('the latest entry wears the emerald treatment + a latest pill', () => {
    expect(CHROME).toMatch(/latest\s*\?\s*'rounded-xl border border-emerald-200 bg-emerald-50\/60 p-3 dark:border-emerald-500\/30 dark:bg-emerald-500\/10'/);
    expect(CHROME).toContain('data-testid="changelog-latest-pill"');
    expect(CHROME).toContain('<Sparkles className="h-2.5 w-2.5" aria-hidden /> latest');
  });

  it('every entry is keyed by version and testid-ed', () => {
    expect(CHROME).toMatch(/data-testid=\{`changelog-entry-\$\{entry\.version\}`\}/);
    expect(CHROME).toMatch(/visibleOlder\.map\(\(entry\) => \(\s*<ChangelogEntry key=\{entry\.version\}/);
  });

  it('the subtitle names the running version honestly', () => {
    expect(CHROME).toMatch(/You&apos;re on version \{APP_VERSION\}/);
    expect(CHROME).toContain('every release since the console joined the lineage, newest first');
  });

  it('the modal carries the changelog testid and keeps scrolling', () => {
    expect(CHROME).toContain('data-testid="changelog-modal"');
    expect(CHROME).toMatch(/className="max-h-\[85vh\] overflow-y-auto sm:max-w-xl"/);
  });

  it('entries render with dot markers in the tabs-shell language', () => {
    expect(CHROME).toMatch(/latest \? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'/);
  });

  it('is dark-mode complete (entries, both chip states, footer blocks)', () => {
    expect(CHROME).toMatch(/'rounded-xl border border-slate-200 bg-slate-50\/50 p-3 dark:border-slate-800 dark:bg-slate-800\/30'/);
    expect(CHROME).toMatch(/text-emerald-900 dark:text-emerald-200/);
    expect(CHROME).toMatch(/text-slate-600 dark:text-slate-400/);
    expect(CHROME).toMatch(/dark:bg-slate-800\/50 dark:text-slate-500/);
  });
});

// ── 2. The backlog collapse ─────────────────────────────────────────────────

describe('ChangelogModal - the backlog waits behind one button', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('renders latest + five older entries open', () => {
    expect(CHROME).toContain('const INITIAL_VISIBLE = 5;');
    // v2.73.0: the derivation grew the jump-expansion (showAll || needsExpand);
    // a plain open still slices at INITIAL_VISIBLE.
    expect(CHROME).toMatch(/const effectiveShowAll = showAll \|\| needsExpand;/);
    expect(CHROME).toMatch(/const visibleOlder = effectiveShowAll \? older : older\.slice\(0, INITIAL_VISIBLE\);/);
  });

  it('the expand button names its honest hidden count', () => {
    expect(CHROME).toMatch(/const hiddenCount = older\.length - visibleOlder\.length;/);
    expect(CHROME).toContain('data-testid="changelog-show-older"');
    expect(CHROME).toMatch(/Show \{hiddenCount\} older release\{hiddenCount === 1 \? '' : 's'\}/);
  });

  it('expanding reveals everything; a Show-fewer button collapses back', () => {
    expect(CHROME).toContain('data-testid="changelog-show-fewer"');
    expect(CHROME).toMatch(/showAll && older\.length > INITIAL_VISIBLE \? \(/);
  });

  it('the collapse buttons wear the dashed-surface + focus ring language', () => {
    expect(CHROME.match(/border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold/g)?.length).toBe(2);
    expect(CHROME).toMatch(/focus-visible:ring-2 focus-visible:ring-orange-400 dark:border-slate-700 dark:bg-slate-900/g);
  });
});

// ── 3. The shared seen flag ─────────────────────────────────────────────────

describe('ChangelogModal - one seen flag across surfaces', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('"Got it" writes the shared mbt_seen_version key', () => {
    expect(CHROME).toContain("const SEEN_VERSION_KEY = 'mbt_seen_version';");
    expect(CHROME).toContain('localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);');
  });

  it('the write is guarded for private mode and closes the modal', () => {
    expect(CHROME).toMatch(/const markSeen = \(\) => \{\s*try \{[\s\S]{0,200}\} catch \{[\s\S]{0,200}onOpenChange\(false\);/);
  });

  it('"Got it" is testid-ed and the GitHub changelog link survives', () => {
    expect(CHROME).toContain('data-testid="changelog-got-it"');
    expect(CHROME).toContain('data-testid="changelog-github-link"');
    expect(CHROME).toContain('View changelog on GitHub');
  });

  it('the business contacts block survives the rewrite (restyled dark)', () => {
    expect(CHROME).toContain('Contacts: 0795 191 909 · 0759 963 601 · mbumahhardware@gmail.com - Juja Town');
  });
});

// ── 4. The footer pill ──────────────────────────────────────────────────────

describe('ConsoleFooter - the release-waiting pill', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('the mount gate is SSR-safe (useSyncExternalStore pattern)', () => {
    expect(CHROME).toMatch(/const mounted = useSyncExternalStore\(subscribeNoop, mountedProbe, serverProbe\);/);
    expect(CHROME).toMatch(/const mountedProbe = \(\) => true;/);
    expect(CHROME).toMatch(/const serverProbe = \(\) => false;/);
  });

  it('the pill reads the shared flag once mounted', () => {
    expect(CHROME).toMatch(/if \(!mounted\) return;[\s\S]{0,300}setReleaseWaiting\(localStorage\.getItem\(SEEN_VERSION_KEY\) !== APP_VERSION\);/);
  });

  it('the pill renders only while release notes wait', () => {
    expect(CHROME).toMatch(/\{releaseWaiting && \(\s*<span data-testid="footer-changelog-pill"/);
  });

  it('the pill names the waiting version on its tooltip', () => {
    expect(CHROME).toMatch(/title=\{`Release notes for v\$\{APP_VERSION\} are waiting`\}/);
  });

  it('the Changelog button is testid-ed and the pill is emerald in both modes', () => {
    expect(CHROME).toContain('data-testid="footer-changelog-button"');
    expect(CHROME).toMatch(/border border-emerald-300 bg-emerald-50 px-1 py-px text-\[9px\] font-semibold text-emerald-700 dark:border-emerald-500\/40 dark:bg-emerald-500\/15 dark:text-emerald-300/);
  });

  it('the footer itself is dark-mode complete', () => {
    expect(CHROME).toMatch(/<footer className="mt-auto border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">/);
    expect(CHROME).toMatch(/text-\[11px\] text-slate-500 lg:px-5 dark:text-slate-400/);
  });
});

// ── 5. What's-New — the release leads with the story ────────────────────────

describe("What's-New 2.66.0", () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('carries the 2.66.0 entry first', () => {
    expect(WN.indexOf("version: '2.66.0'")).toBeGreaterThanOrEqual(0);
    expect(WN.indexOf("version: '2.66.0'")).toBeLessThan(WN.indexOf("version: '2.65.0'"));
  });

  it('leads with the catch-up story', () => {
    expect(WN).toContain('The console catches up on the news — the changelog tells the whole release story now');
  });

  it('announces the feed wiring, the collapse, the pill, and the shared flag', () => {
    expect(WN).toContain("The console\\'s Changelog modal no longer shows a frozen v2.18.3-era list");
    expect(WN).toContain('The latest release wears an emerald "latest" highlight at the top');
    expect(WN).toContain("A small emerald \"new\" pill sits on the footer\\'s Changelog button");
    expect(WN).toContain('read a release on either surface and both stay quiet');
  });

  it('keeps five bullets (the 3-6 shop-floor contract)', () => {
    const entry = WN.slice(WN.indexOf("version: '2.66.0'"), WN.indexOf("version: '2.65.0'"));
    expect(entry.match(/^ {6}'.*',$/gm)?.length).toBe(5);
  });
});

// ── 6. the palette knows the releases (v2.73.0) ─────────────────────────────

describe('CommandPalette - the jump-to-release group (v2.73.0)', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('takes the jump callback and derives one item per release from WHATS_NEW', () => {
    expect(CHROME).toContain('onJumpToRelease: (version: string) => void;');
    // v2.75.0 — the map now derives the reading state on the same pass.
    expect(CHROME).toMatch(/const releaseActions = useMemo\(\s*\(\) => WHATS_NEW\.map\(\(e\) => \(\{[\s\S]*?state: seenState\.read \? whatsNewReadState\(e\.version, seenState\.value\) : \('seen' as const\),/);
  });

  it('renders a dedicated group, last, so the default view stays compact', () => {
    // v2.75.0 — the heading is a fragment now (it carries the unread counter).
    const workspaces = CHROME.indexOf('<CommandGroup heading="Store workspaces">');
    const releases = CHROME.indexOf('Jump to release');
    expect(releases).toBeGreaterThan(workspaces);
  });

  it('release items are testid-ed, searchable by value, and truncate long titles', () => {
    expect(CHROME).toMatch(/data-testid=\{`palette-release-\$\{r\.version\}`\}/);
    expect(CHROME).toMatch(/value=\{`\$\{r\.label\} release notes`\}/);
    expect(CHROME).toContain('min-w-0 flex-1 truncate');
  });

  it('selecting a release closes the palette and jumps', () => {
    expect(CHROME).toMatch(/onSelect=\{\(\) => \{ onOpenChange\(false\); onJumpToRelease\(r\.version\); \}\}/);
  });

  it('wears the changelog icon and keeps the search placeholder', () => {
    // v2.75.0 — the icon goes emerald for the latest, slate for the rest.
    expect(CHROME).toContain("r.state === 'latest' ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'");
    expect(CHROME).toContain('placeholder="Search actions, stores, releases..."');
  });
});

describe('ChangelogModal - the jump lands somewhere real (v2.73.0)', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');
  const PAGE = readRepo('src/app/(shell)/console/page.tsx');

  it('takes the jump target and resolves its index honestly', () => {
    expect(CHROME).toMatch(/jumpTo\?: string \| null/);
    expect(CHROME).toMatch(/const jumpIndex = jumpTo \? WHATS_NEW\.findIndex\(\(e\) => e\.version === jumpTo\) : -1;/);
  });

  it('a deep target forces the backlog open; a plain open keeps the collapse', () => {
    expect(CHROME).toMatch(/const needsExpand = jumpIndex > INITIAL_VISIBLE;/);
    expect(CHROME).toMatch(/const effectiveShowAll = showAll \|\| needsExpand;/);
    expect(CHROME).toMatch(/const visibleOlder = effectiveShowAll \? older : older\.slice\(0, INITIAL_VISIBLE\);/);
  });

  it('scrolls the jumped entry into view once painted (no setState in the effect)', () => {
    expect(CHROME).toMatch(/if \(!open \|\| !jumpTo \|\| jumpIndex < 0\) return;/);
    expect(CHROME).toMatch(/document\.querySelector\(`\[data-testid="changelog-entry-\$\{jumpTo\}"\]`\)/);
    expect(CHROME).toMatch(/scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
    expect(CHROME).toMatch(/return \(\) => window\.clearTimeout\(id\);/);
  });

  it('the jumped entry wears the orange ring + the "via cmd+K" pill (dark complete)', () => {
    expect(CHROME).toMatch(/focused \? ' ring-2 ring-orange-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''/);
    expect(CHROME).toContain('data-testid="changelog-jump-pill"');
    expect(CHROME).toContain('via cmd+K');
    expect(CHROME).toMatch(/border-orange-300 bg-orange-50 px-1\.5 py-px text-\[9px\] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-500\/40 dark:bg-orange-500\/15 dark:text-orange-300/);
  });

  it('the page owns the jump state: palette sets it, close clears it', () => {
    expect(PAGE).toContain('const [releaseJump, setReleaseJump] = useState<string | null>(null);');
    expect(PAGE).toContain('onJumpToRelease={(v) => { setReleaseJump(v); setChangelogOpen(true); }}');
    expect(PAGE).toContain('onOpenChange={(o) => { setChangelogOpen(o); if (!o) setReleaseJump(null); }} jumpTo={releaseJump}');
  });

  it('the modal entry list passes focused by version for latest and older', () => {
    expect(CHROME).toMatch(/<ChangelogEntry entry=\{latest\} latest focused=\{jumpTo === latest\.version\} \/>/);
    expect(CHROME).toMatch(/<ChangelogEntry key=\{entry\.version\} entry=\{entry\} latest=\{false\} focused=\{jumpTo === entry\.version\} \/>/);
  });
});

describe('release metadata - v2.73.0', () => {
  it("leads What's-New with the palette-jump story", () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.73.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.73.0'")).toBeLessThan(WN.indexOf("version: '2.72.0'"));
    expect(WN).toContain('The palette knows the releases');
    expect(WN).toMatch(/Jump to release/);
    expect(WN).toMatch(/via cmd\+K/);
  });

  it('bumps package.json to at least 2.73.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.73.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.73.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.73.0')).toBe(true);
    expect(PKG.scripts['verify:v2-73-0']).toBe('node scripts/verify-v2-73-0.mjs');
  });

  it('keeps the prior console surfaces intact (collapse, pill, shared flag)', () => {
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid="changelog-show-older"');
    expect(CHROME).toContain('data-testid="changelog-got-it"');
    expect(CHROME).toContain('data-testid="footer-changelog-pill"');
    expect(CHROME).toContain("const SEEN_VERSION_KEY = 'mbt_seen_version';");
  });
});

// ── 7. the palette knows what you've read (v2.75.0) ──────────────────────────

describe('compareWhatsNewVersions - semver, not string compare (v2.75.0)', () => {
  it('orders component-wise: major, then minor, then patch', () => {
    expect(compareWhatsNewVersions('2.75.0', '2.74.0')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('2.74.0', '2.75.0')).toBeLessThan(0);
    expect(compareWhatsNewVersions('2.73.0', '2.72.0')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('3.0.0', '2.99.99')).toBeGreaterThan(0);
  });

  it('the string-compare trap is dead: 2.9 ranks BELOW 2.10', () => {
    expect(compareWhatsNewVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('2.9.0', '2.10.0')).toBeLessThan(0);
  });

  it('equal versions compare equal, and missing components read as zero', () => {
    expect(compareWhatsNewVersions('2.75.0', '2.75.0')).toBe(0);
    expect(compareWhatsNewVersions('2.75', '2.75.0')).toBe(0);
  });
});

describe('whatsNewReadState - one flag, one truth (v2.75.0)', () => {
  it('the newest entry in the feed is the latest, always', () => {
    expect(whatsNewReadState(WHATS_NEW[0].version, WHATS_NEW[0].version)).toBe('latest');
    expect(whatsNewReadState(WHATS_NEW[0].version, null)).toBe('latest');
  });

  it('a release strictly newer than the seen flag is new', () => {
    expect(whatsNewReadState('2.74.0', '2.73.0')).toBe('new');
    expect(whatsNewReadState('2.74.1', '2.74.0')).toBe('new');
  });

  it('a release at or below the flag has been seen', () => {
    expect(whatsNewReadState('2.72.0', '2.73.0')).toBe('seen');
    expect(whatsNewReadState('2.73.0', '2.73.0')).toBe('seen');
  });

  it('stays calm with no flag: no unread claims without a reference point', () => {
    expect(whatsNewReadState('2.30.0', null)).toBe('seen');
    expect(whatsNewReadState(WHATS_NEW[0].version, null)).toBe('latest');
  });
});

describe('whatsNewUnreadCount - the heading counter (v2.75.0)', () => {
  it('counts the releases that arrived after the flag', () => {
    // The feed leads 2.125.0 (latest — counted separately), then 2.124.0,
    // 2.123.0, 2.122.0, 2.121.0, 2.120.0, 2.119.0, 2.118.0, 2.117.0, 2.116.0 — a
    // 2.110.0 flag means 2.111.0 … 2.124.0 sit strictly between (the head
    // 2.125.0 reads "latest", NOT 'new'), so the honest count is 14; a
    // 2.77.0 flag counts 2.78.0 … 2.124.0 (the head never joins this count).
    // Re-anchored for 2.125.0 "the desk starts hiring" joining the feed.
    expect(whatsNewUnreadCount('2.110.0')).toBe(14);
    expect(whatsNewUnreadCount('2.109.0')).toBe(15);
    expect(whatsNewUnreadCount('2.108.0')).toBe(16);
    expect(whatsNewUnreadCount('2.77.0')).toBe(47);
    expect(whatsNewUnreadCount('2.70.0')).toBeGreaterThanOrEqual(10);
  });

  it('zero when everything is read, zero when nothing is provably unread', () => {
    expect(whatsNewUnreadCount(WHATS_NEW[0].version)).toBe(0);
    expect(whatsNewUnreadCount(null)).toBe(0);
  });
});

describe('CommandPalette - the release inbox (v2.75.0)', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('reads the SHARED seen flag when the palette opens, never on the server', () => {
    expect(CHROME).toContain('const [seenState, setSeenState] = useState<{ read: boolean; value: string | null }>({ read: false, value: null });');
    const effect = CHROME.split('const [seenState, setSeenState]')[1].split('const releaseActions =')[0];
    expect(effect).toContain('if (!open) return;');
    expect(effect).toContain('localStorage.getItem(SEEN_VERSION_KEY)');
    expect(effect).toContain('window.setTimeout');
    expect(effect).toContain('return () => window.clearTimeout(id);');
  });

  it('re-reads on every open (a "Got it" in the modal lands on the next cmd+K)', () => {
    const effect = CHROME.split('const [seenState, setSeenState]')[1].split('const releaseActions =')[0];
    expect(effect).toContain('[open]);');
  });

  it('claims no state before the flag has actually been read', () => {
    expect(CHROME).toContain("state: seenState.read ? whatsNewReadState(e.version, seenState.value) : ('seen' as const),");
    expect(CHROME).toContain('(seenState.read ? whatsNewUnreadCount(seenState.value) : 0)');
  });

  it('every item carries its state marker, testid-ed per version', () => {
    expect(CHROME).toMatch(/data-testid=\{`palette-release-state-\$\{r\.version\}`\}/);
  });

  it('the latest wears the modal\u2019s emerald badge (same family, Sparkles and all)', () => {
    const latest = CHROME.split("r.state === 'latest' ? (")[1].split(") : r.state === 'new' ?")[0];
    expect(latest).toContain('Sparkles');
    expect(latest).toContain('latest');
    expect(latest).toContain('dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-300');
    expect(latest).toContain('data-testid={`palette-release-state-${r.version}`}');
  });

  it('new arrivals wear the outline chip of the footer-pill family', () => {
    const fresh = CHROME.split(") : r.state === 'new' ? (")[1].split(") : (")[0];
    expect(fresh).toContain('new');
    expect(fresh).toContain('border-emerald-200');
    expect(fresh).toContain('dark:border-emerald-500/30 dark:text-emerald-400');
    expect(fresh).toContain('title={`v${r.version} arrived after you last read the notes`}');
  });

  it('read releases keep their quiet "notes" hint', () => {
    const seen = CHROME.split(") : r.state === 'new' ? (")[1].split('</CommandItem>')[0];
    expect(seen).toContain('<span className="ml-auto shrink-0 text-[10px] text-slate-400">notes</span>');
  });

  it('the group heading counts the unread', () => {
    expect(CHROME).toContain('data-testid="palette-release-unread"');
    expect(CHROME).toContain('{unreadCount} unread');
    expect(CHROME).toContain("arrived after you last read the notes`}");
  });

  it('the latest item reads as first-class (emerald icon + bold title)', () => {
    expect(CHROME).toContain("r.state === 'latest' ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'");
    expect(CHROME).toContain("r.state === 'latest' ? 'font-semibold text-slate-800 dark:text-slate-100' : ''");
  });
});

describe("What's-New 2.75.0", () => {
  it('leads the feed with the release-inbox story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.75.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.75.0'")).toBeLessThan(WN.indexOf("version: '2.74.0'"));
    expect(WN).toContain('The palette knows what you');
    expect(WN).toMatch(/unread/i);
    expect(WN).toMatch(/SAME seen flag/);
  });
});

describe('release metadata - v2.75.0', () => {
  it('bumps package.json to at least 2.75.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.75.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.75.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.75.0')).toBe(true);
    expect(PKG.scripts['verify:v2-75-0']).toBe('node scripts/verify-v2-75-0.mjs');
  });

  it('keeps every prior surface intact (jump group, modal jump, footer pill, cross-links)', () => {
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toMatch(/data-testid=\{`palette-release-\$\{r\.version\}`\}/);
    expect(CHROME).toContain('data-testid="changelog-jump-pill"');
    expect(CHROME).toContain('data-testid="footer-changelog-pill"');
    expect(CHROME).toContain("localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);");
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-request-visit-reviewer"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-visit-request"');
  });
});

// ── 8. the inbox clears in place (v2.76.0) ──────────────────────────

describe('whatsNewMarkAllTarget - the stamp for mark-all-read (v2.76.0)', () => {
  it('is the feed head — the same truth the latest badge wears', () => {
    // Feed head, whatever release leads (2.77.0 now) — and stamping it
    // provably leaves nothing unread.
    expect(whatsNewMarkAllTarget()).toBe(WHATS_NEW[0].version);
    expect(whatsNewUnreadCount(whatsNewMarkAllTarget())).toBe(0);
  });
});

describe('CommandPalette - mark all read (v2.76.0)', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('offers the action only when there is something to clear (flag read, unread > 0, a target exists)', () => {
    expect(CHROME).toContain('{seenState.read && unreadCount > 0 && whatsNewMarkAllTarget() ? (');
  });

  it('writes the SAME shared flag, stamped with the feed head, and claims it immediately', () => {
    const handler = CHROME.split('const markAllRead = () => {')[1].split('  };')[0];
    expect(handler).toContain('whatsNewMarkAllTarget()');
    expect(handler).toContain('if (!target) return;');
    expect(handler).toContain('localStorage.setItem(SEEN_VERSION_KEY, target)');
    expect(handler).toContain('setSeenState({ read: true, value: target })');
  });

  it('storage failure claims nothing (the catch returns before any state moves)', () => {
    const handler = CHROME.split('const markAllRead = () => {')[1].split('  };')[0];
    expect(handler).toContain('catch {');
    expect(handler.indexOf('return; // storage unavailable')).toBeGreaterThan(-1);
    expect(handler.indexOf('setSeenState')).toBeGreaterThan(handler.indexOf('localStorage.setItem'));
  });

  it('stays open on select — you watch the counter and the NEW chips clear', () => {
    const item = CHROME.split('data-testid="palette-mark-all-read"')[1].split('</CommandItem>')[0];
    expect(item).toContain('onSelect={markAllRead}');
    expect(item).not.toContain('onOpenChange(false)');
  });

  it('the action carries the inbox family dress (CheckCheck, emerald icon, honest hint)', () => {
    const item = CHROME.split('data-testid="palette-mark-all-read"')[1].split('</CommandItem>')[0];
    expect(item).toContain('CheckCheck');
    expect(item).toContain('Mark all releases read');
    expect(item).toContain('text-emerald-500 dark:text-emerald-400');
    expect(item).toContain('stays open');
    expect(item).toContain('value="mark all releases read inbox got it catch up"');
  });

  it('sits inside the release group, ahead of the release items', () => {
    const action = CHROME.indexOf('data-testid="palette-mark-all-read"');
    expect(action).toBeGreaterThan(CHROME.indexOf('Jump to release'));
    expect(action).toBeLessThan(CHROME.indexOf('data-testid={`palette-release-${r.version}`}'));
  });

  it('the action explains itself on hover', () => {
    expect(CHROME).toContain('Writes the same seen flag the changelog’s “Got it” writes — the palette stays open');
  });
});

describe("What's-New 2.76.0", () => {
  it('leads the feed with the shortcuts story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.76.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.76.0'")).toBeLessThan(WN.indexOf("version: '2.75.0'"));
    expect(WN).toContain('The shortcuts arrive');
    expect(WN).toMatch(/Mark all releases read/);
    expect(WN).toMatch(/j walks the doors/);
  });
});

describe('release metadata - v2.76.0', () => {
  it('bumps package.json to at least 2.76.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.76.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.76.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.76.0')).toBe(true);
    expect(PKG.scripts['verify:v2-76-0']).toBe('node scripts/verify-v2-76-0.mjs');
  });

  it('keeps every prior surface intact (release inbox, jump group, cross-links, drawers)', () => {
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toMatch(/data-testid=\{`palette-release-state-\$\{r\.version\}`\}/);
    expect(CHROME).toContain('data-testid="palette-release-unread"');
    expect(CHROME).toContain("state: seenState.read ? whatsNewReadState(e.version, seenState.value) : ('seen' as const),");
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-request-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-toggle"');
    expect(VIEW).toContain('printReceiptElement(\'desk-report-content\')');
  });
});

// ── 9. the shortcut sheet tells the whole story (v2.77.0) ────────────────────

describe('ShortcutsModal - the desk report section (v2.77.0)', () => {
  const CHROME = readRepo('src/components/org/chrome.tsx');

  it('the sheet has a labeled desk-report section', () => {
    expect(CHROME).toContain('data-testid="shortcuts-desk-section"');
    expect(CHROME).toContain('On the desk report');
    expect(CHROME).toContain('/org/desk-report');
  });

  it('the three desk keys are listed with where they work', () => {
    expect(CHROME).toContain("['j', 'Desk report: walk to the next door']");
    expect(CHROME).toContain("['k', 'Desk report: walk to the previous door']");
    expect(CHROME).toContain("['esc', 'Desk report: close the open drawer']");
  });

  it('the section renders AFTER the console rows and reuses the kbd row dress', () => {
    const section = CHROME.indexOf('data-testid="shortcuts-desk-section"');
    const consoleRows = CHROME.indexOf("['cmd + K', 'Command palette']");
    expect(section).toBeGreaterThan(consoleRows);
    const body = CHROME.split('data-testid="shortcuts-desk-section"')[1].split('</div>')[0];
    expect(body).toContain('deskRows.map');
    expect(body).toContain('font-mono text-[10px]');
  });

  it('the section carries the FileText marker and a route hint', () => {
    const head = CHROME.split('<div data-testid="shortcuts-desk-section"')[1].split('</div>')[0];
    expect(head).toContain('FileText');
    expect(head).toContain('/org/desk-report');
  });
});

describe("What's-New 2.77.0", () => {
  it('leads the feed with the discoverable-walk story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.77.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.77.0'")).toBeLessThan(WN.indexOf("version: '2.76.0'"));
    expect(WN).toContain('The shortcut sheet tells the whole story');
    expect(WN).toMatch(/aria-live/);
    expect(WN).toMatch(/returns you to the row that owned the drawer/);
  });
});

describe('release metadata - v2.77.0', () => {
  it('bumps package.json to at least 2.77.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.77.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.77.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.77.0')).toBe(true);
    expect(PKG.scripts['verify:v2-77-0']).toBe('node scripts/verify-v2-77-0.mjs');
  });

  it('keeps every prior surface intact (mark-all action, inbox, walk, hint)', () => {
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid="palette-mark-all-read"');
    expect(CHROME).toContain('{seenState.read && unreadCount > 0 && whatsNewMarkAllTarget() ? (');
    // v2.109.0: the import line grew the Home icon (the Expert Console's
    // Home action) — the pin follows the source, not the memory.
    expect(CHROME).toContain("import { CheckCheck, ChevronDown, ChevronUp, CloudOff, ExternalLink, FileText, History, Home, Keyboard, LogIn, Package, ScrollText, Sparkles, Terminal, Store } from 'lucide-react';");
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-kbd-hint"');
  });
});

describe("What's-New 2.84.0", () => {
  it('leads the feed with the run-history story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.84.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.84.0'")).toBeLessThan(WN.indexOf("version: '2.83.0'"));
    expect(WN).toContain('The run remembers its own steps');
    expect(WN).toMatch(/who did what/);
    expect(WN).toMatch(/no timestamp recorded/);
  });
});

describe("What's-New 2.85.0", () => {
  it('leads the feed with the missing-step story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.85.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.85.0'")).toBeLessThan(WN.indexOf("version: '2.84.0'"));
    expect(WN).toContain('The walk gains its missing step');
    expect(WN).toMatch(/Submitted for approval/);
    expect(WN).toMatch(/prepared or submitted/i);
  });
});

describe("What's-New 2.86.0", () => {
  it('leads the feed with the who\u2019s-next story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.86.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.86.0'")).toBeLessThan(WN.indexOf("version: '2.85.0'"));
    expect(WN).toMatch(/names its waiter/);
    expect(WN).toMatch(/Waiting on/);
    expect(WN).toMatch(/waiting since/);
  });
});

describe("What's-New 2.88.0", () => {
  it('leads the feed with the shape story — meter, door, filters', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.88.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.88.0'")).toBeLessThan(WN.indexOf("version: '2.87.0'"));
    expect(WN).toMatch(/shows its shape/);
    expect(WN).toMatch(/calibration meter/i);
    expect(WN).toMatch(/View reviews/);
    expect(WN).toMatch(/Showing X of Y/);
    expect(WN).toMatch(/never appear in any list/i);
  });
});

describe("What's-New 2.87.0", () => {
  it('leads the feed with the write-and-read story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.87.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.87.0'")).toBeLessThan(WN.indexOf("version: '2.86.0'"));
    expect(WN).toMatch(/gets written/);
    expect(WN).toMatch(/dead end/);
    expect(WN).toMatch(/Read review/);
    expect(WN).toMatch(/blind acknowledgements/i);
  });
});

describe("What's-New 2.83.0", () => {
  it('leads the feed with the bundle story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.83.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.83.0'")).toBeLessThan(WN.indexOf("version: '2.82.0'"));
    expect(WN).toContain('The run hands every slip over');
    expect(WN).toMatch(/Payslip bundle \(N\)/);
    expect(WN).toMatch(/_MANIFEST\.csv/);
  });
});

describe("What's-New 2.82.0", () => {
  it('leads the feed with the files-everything story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.82.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.82.0'")).toBeLessThan(WN.indexOf("version: '2.81.0'"));
    expect(WN).toContain('The report files everything');
    expect(WN).toMatch(/File all N visits/);
    expect(WN).toMatch(/mbumah-desk-all-/);
  });
});

describe("What's-New 2.81.0", () => {
  it('leads the feed with the whole-scope story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.81.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.81.0'")).toBeLessThan(WN.indexOf("version: '2.80.0'"));
    expect(WN).toContain('The link carries the whole scope');
    expect(WN).toMatch(/\?days=/);
    expect(WN).toMatch(/two-beat/);
    expect(WN).toMatch(/from the link/);
  });
});

describe("What's-New 2.80.0", () => {
  it('leads the feed with the addressable story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.80.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.80.0'")).toBeLessThan(WN.indexOf("version: '2.79.0'"));
    expect(WN).toContain('The report is addressable');
    expect(WN).toMatch(/\?reviewer=/);
    expect(WN).toMatch(/Their file in the report/);
  });
});

describe("What's-New 2.79.0", () => {
  it('leads the feed with the drawers-file-themselves story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.79.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.79.0'")).toBeLessThan(WN.indexOf("version: '2.78.0'"));
    expect(WN).toContain('The drawers file themselves');
    expect(WN).toMatch(/RFC-4180/);
    expect(WN).toMatch(/mbumah-desk-reviewer-/);
  });
});

describe('release metadata - v2.79.0', () => {
  it('bumps package.json to at least 2.79.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.79.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.79.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.79.0')).toBe(true);
    expect(PKG.scripts['verify:v2-79-0']).toBe('node scripts/verify-v2-79-0.mjs');
  });

  it('keeps every prior surface intact (palette, inbox, shortcuts sheet, walk, drawer CSVs)', () => {
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid="palette-mark-all-read"');
    expect(CHROME).toContain('data-testid="shortcuts-desk-section"');
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-csv"');
    expect(VIEW).toContain('data-testid="desk-report-request-csv"');
  });
});
