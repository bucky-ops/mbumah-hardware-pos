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
    expect(CHROME).toMatch(/const visibleOlder = showAll \? older : older\.slice\(0, INITIAL_VISIBLE\);/);
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
