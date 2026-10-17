import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    expect(CHROME).toContain("import { WHATS_NEW, type WhatsNewEntry } from '@/lib/whats-new';");
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
    expect(CHROME).toMatch(/const releaseActions = useMemo\(\s*\(\) => WHATS_NEW\.map\(\(e\) => \(\{ version: e\.version, label: `v\$\{e\.version\} — \$\{e\.title\}` \}\)\)/);
  });

  it('renders a dedicated group, last, so the default view stays compact', () => {
    expect(CHROME).toContain('<CommandGroup heading="Jump to release">');
    const workspaces = CHROME.indexOf('<CommandGroup heading="Store workspaces">');
    const releases = CHROME.indexOf('<CommandGroup heading="Jump to release">');
    expect(releases).toBeGreaterThan(workspaces);
  });

  it('release items are testid-ed, searchable by value, and truncate long titles', () => {
    expect(CHROME).toMatch(/data-testid=\{`palette-release-\$\{r\.version\}`\}/);
    expect(CHROME).toMatch(/value=\{`\$\{r\.label\} release notes`\}/);
    expect(CHROME).toContain('<span className="min-w-0 flex-1 truncate">{r.label}</span>');
  });

  it('selecting a release closes the palette and jumps', () => {
    expect(CHROME).toMatch(/onSelect=\{\(\) => \{ onOpenChange\(false\); onJumpToRelease\(r\.version\); \}\}/);
  });

  it('wears the changelog icon and dark-safe slate styling', () => {
    expect(CHROME).toMatch(/<ScrollText className="mr-2 h-3\.5 w-3\.5 shrink-0 text-slate-400" \/>/);
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
