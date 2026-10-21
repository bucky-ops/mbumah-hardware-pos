import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.148.0 — the shell meets the bar.
 *
 * The acceptance sweep moved to the surface every user lands on: the
 * authenticated org shell (sidebar, top bar, dashboard). axe-core 4.12
 * at desktop and 390px found real debt the HR sweep (v2.147.0) could not
 * see, because it lives on the OTHER route group:
 *  - TEN colour-contrast violations: white on red-500 count badges (and
 *    a pulse that half-dimmed them mid-frame), slate-500 section labels
 *    on the dark rail, a slate-400-on-white family 25 sites wide (2.63:1),
 *    emerald-600 "All stock healthy" (3.65:1), the slate-100 coaching pill.
 *  - TWO scrollable-region-focusable violations (plus one latent in the
 *    search panel): plain <ul>s with no focusable child — keyboard users
 *    could never scroll them.
 *  - ARIA-prohibited names: aria-label on bare divs (KPI cards, clock).
 *
 * Covered here (source pins — the live sweep is agent-browser's, recorded
 * in the worklog):
 *  - the badge contract at all three mount points (tokens, no pulse),
 *  - the rail's slate-400 quiet text,
 *  - the KPI card's role="group" for non-interactive / button for interactive,
 *  - the zero-sales badge's role="note" + slate-600,
 *  - the four dashboard scrollers' tabIndex + aria-label + ring,
 *  - the search panel's scroller,
 *  - the skip link: first focusable, href to main, main focusable,
 *  - the clock's role="timer",
 *  - the CreateRunDialog chip's outcome dot (the v2.144/v2.146 language),
 *  - the release surfaces speak the version.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SIDEBAR = 'src/components/layout/app-sidebar.tsx';
const TOPBAR = 'src/components/layout/top-bar.tsx';
const DASH = 'src/app/(shell)/tabs/dashboard-tab.tsx';
const MAINAPP = 'src/components/app/main-app.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';

describe('the count pills pass on their own token (no pulse)', () => {
  const sidebar = () => readRepo(SIDEBAR);
  const topbar = () => readRepo(TOPBAR);

  it('critical is white on red-600, warning is slate-950 on amber-500 — at all three mounts', () => {
    // The old contract: text-white in the base + `bg-red-500` /
    // `bg-amber-500` — 3.8:1 and 2.15:1 on tiny bold text.
    const pillTone = 'bg-red-600 text-white\' : \'bg-amber-500 text-slate-950\'';
    expect(sidebar()).toContain(pillTone); // expanded rail
    expect(sidebar()).toContain(pillTone); // collapsed rail (same expression shape)
    expect(sidebar().match(/bg-red-600 text-white/g)?.length).toBe(2);
    expect(topbar()).toContain('bg-red-600 text-white\' : \'bg-amber-500 text-slate-950\'');
  });

  it('text-white no longer sits in the pill base class — the tone owns it', () => {
    // If text-white stayed in the base, the amber variant would render
    // white-on-amber (2.15:1) again. The base keeps only shape + size;
    // the tone ternary legitimately carries text-white for the red side.
    const sidebarPills = sidebar().split('animate-badge-bounce-in');
    expect(sidebarPills.length).toBeGreaterThanOrEqual(3);
    for (const chunk of sidebarPills.slice(1)) {
      const base = chunk.split('${')[0];
      expect(base).not.toContain('text-white');
    }
  });

  it('the pulse is gone from every pill — a mid-dimmed frame is still a failure', () => {
    // axe caught #ffe1e3-on-#fc6068 (2.44:1) DURING the pulse. The bounce-in
    // entrance (one-shot) stays; the opacity loop does not. The pin is for
    // animate-pulse EXACTLY — animate-pulse-slow is the decorative status
    // dot's own class, not a text pill.
    expect(sidebar().match(/\banimate-pulse(?!-)/g)?.length ?? 0).toBe(0);
    expect(topbar().match(/\banimate-pulse(?!-)/g)?.length ?? 0).toBe(0);
  });
});

describe("the dark rail's quiet text clears the bar", () => {
  const sidebar = () => readRepo(SIDEBAR);

  it('section labels ride text-slate-400 (6.6:1 on the slate-900 rail)', () => {
    // slate-500 on the rail measured 3.74:1 — a violation at 10px.
    expect(sidebar()).toContain('text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5');
    expect(sidebar()).not.toContain('tracking-wider text-slate-500');
  });

  it('the F2–F5 kbd hints ride text-slate-400 too', () => {
    expect(sidebar().match(/text-\[8px\] text-slate-500 hidden xl:inline/g)?.length ?? 0).toBe(0);
    expect(sidebar().match(/text-\[8px\] text-slate-400 hidden xl:inline/g)?.length).toBe(4);
  });
});

describe('names move onto roles that may carry them', () => {
  const dash = () => readRepo(DASH);
  const topbar = () => readRepo(TOPBAR);

  it('a non-interactive KPI card spreads role="group"; interactive keeps role="button"', () => {
    // aria-label on a bare div is a prohibited pairing (generic role).
    const card = dash().split('function KpiCard(')[1].split('function KpiRow(')[0];
    expect(card).toContain("{...(interactive");
    expect(card).toContain(": { role: 'group' })}");
    expect(card).toContain("role: 'button', tabIndex: 0, onClick");
    expect(card).toContain('aria-label={interactive ? `${label} - open details` : label}');
  });

  it('the zero-sales coaching pill takes role="note" and slate-600', () => {
    // v2.147.0's pattern: note is the section role for ancillary content
    // and accepts author naming; slate-400 on slate-100 measured 2.4:1.
    const pill = dash().split('const zeroSalesTrendBadge')[1].split(') : null;')[0];
    expect(pill).toContain('role="note"');
    expect(pill).toContain('text-[10px] font-semibold text-slate-600');
  });

  it('the live clock is a role="timer" (an incrementing time display)', () => {
    const clock = topbar().split('Live date + clock')[1].split('</Badge>')[0];
    expect(clock).toContain('role="timer"');
    expect(clock).toContain('aria-label="Current date and time"');
  });
});

describe('every dashboard scroller is keyboard-reachable', () => {
  const dash = () => readRepo(DASH);

  it('the four lists carry tabIndex={0} + an honest name + a visible focus ring', () => {
    const names = ['Recent sales', 'System activity', 'Customer spend rankings', 'Urgent alerts'];
    for (const name of names) {
      expect(dash()).toContain(`tabIndex={0} aria-label="${name}"`);
    }
    // The affordance is visible when focused — a silent tabIndex is
    // discoverable by nobody.
    expect(dash().match(/custom-scrollbar focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300/g)?.length).toBe(4);
  });

  it('the search results panel is focusable too (its empty state has no children)', () => {
    const topbar = () => readRepo(TOPBAR);
    expect(topbar()).toContain('tabIndex={0} aria-label="Search results"');
  });
});

describe('the muted-on-white family clears the bar', () => {
  it('dashboard-tab no longer renders text-slate-400 on white', () => {
    // 25 sites measured 2.63:1 (axe flagged the chart and donut nodes;
    // the rest are the same failure waiting for a render).
    expect(readRepo(DASH).match(/text-slate-400/g)?.length ?? 0).toBe(0);
  });

  it('"All stock healthy" rides emerald-700 (5.5:1), not emerald-600', () => {
    // v2.155.0 re-anchor: the app-wide emerald-text sweep moved the whole
    // family to -700, so the forbidden token is now emerald-600 itself.
    expect(readRepo(DASH).match(/text-emerald-600">All stock healthy/g)?.length ?? 0).toBe(0);
    expect(readRepo(DASH).match(/text-emerald-700">All stock healthy/g)?.length).toBe(2);
  });
});

describe("the skip link is the shell's first stop", () => {
  const mainapp = () => readRepo(MAINAPP);

  it('the link exists, hidden until focused, pointing at the content region', () => {
    expect(mainapp()).toContain('href="#main-content"');
    expect(mainapp()).toContain('data-testid="shell-skip-link"');
    expect(mainapp()).toContain('sr-only focus:not-sr-only');
    // Revealed as a readable pill (dark bg, white text) on first Tab.
    expect(mainapp()).toContain('focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white');
  });

  it('the link sits BEFORE the sidebar in the JSX (first focusable in DOM order)', () => {
    const shell = mainapp().split('<div className="flex h-screen overflow-hidden">')[1];
    const linkAt = shell.indexOf('href="#main-content"');
    const sidebarAt = shell.indexOf('<AppSidebar />');
    expect(linkAt).toBeGreaterThan(-1);
    expect(sidebarAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(sidebarAt);
  });

  it('the target <main> accepts focus (tabIndex={-1}) so focus truly lands', () => {
    // Without it the browser scrolls silently while focus stays behind.
    expect(mainapp()).toContain('<main id="main-content" tabIndex={-1}');
  });

  it('the click handler lands the focus itself (the router soft-nav skips it)', () => {
    // Next intercepts same-page hash clicks and pushState's the hash —
    // the browser never performs a fragment navigation, so focus would
    // stay on the link. The handler focuses #main-content explicitly;
    // the href stays as the no-JS fallback (it precedes the testid).
    const app = mainapp();
    const link = app.split('data-testid="shell-skip-link"')[1].split('</a>')[0];
    expect(link).toContain('onClick=');
    expect(link).toContain("document.getElementById('main-content')");
    expect(link).toContain('target.focus()');
    expect(link).toContain('preventDefault()');
    expect(app).toContain('href="#main-content"');
  });
});

describe("the run dialog's last-run chip wears the outcome dot", () => {
  const payroll = () => readRepo(PAYROLL);

  it('the dot rides the attempts chip in the same tone language the table and card speak', () => {
    const chip = payroll().split('data-testid="payroll-picker-attempts-chip"')[1].split(') : null}')[0];
    expect(chip).toContain('data-testid="payroll-picker-attempts-dot"');
    expect(chip).toContain('aria-hidden');
    expect(chip).toContain("'bg-emerald-500 dark:bg-emerald-400'");
    expect(chip).toContain("'bg-amber-500 dark:bg-amber-400'");
    expect(chip).toContain("'bg-muted-foreground/40'");
    expect(chip).toContain('{attempts.label}');
  });

  it('the dot is INSIDE the pill (not a sibling decoration)', () => {
    // The chip's own border wraps the dot — one surface, one story.
    const chip = payroll().split('data-testid="payroll-picker-attempts-chip"')[1].split(') : null}')[0];
    const dotAt = chip.indexOf('payroll-picker-attempts-dot');
    const labelAt = chip.indexOf('{attempts.label}');
    const closeAt = chip.lastIndexOf('</span>');
    expect(dotAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(dotAt);
    expect(closeAt).toBeGreaterThan(labelAt);
  });
});

describe('the live re-audit follow-ups (found on the rebuilt build)', () => {
  it('the org console branch hint rides slate-600, never an alpha token', () => {
    // The /80 alpha measured 3.61:1; even full muted-foreground computes
    // ~4.4:1 on the muted toggle's own bg — slate-600 passes at ~7:1.
    const org = readRepo('src/components/workspace/org-console.tsx');
    expect(org).not.toContain('text-muted-foreground/80');
    expect(org).toContain('font-normal text-slate-600');
  });

  it('the alert popup host is a named region (not a bare named div)', () => {
    const host = readRepo('src/components/alerts/alert-popup-host.tsx');
    const viewport = host.split('if (alerts.length === 0) return null;')[1];
    expect(viewport).toContain('role="region"');
    expect(viewport).toContain('aria-label="Alert popups"');
  });

  it('the shell footer drops every alpha-muted token (the /50 and /60 family)', () => {
    // Version label /50 measured 2.1:1, the status chip and the shortcuts
    // button /60 measured 2.51:1 — full muted-foreground passes at ~4.6:1.
    const footer = readRepo(MAINAPP).split('<footer')[1] || '';
    expect(footer).not.toMatch(/text-muted-foreground\/\d+/);
    expect(footer).toContain('text-[10px] text-muted-foreground hidden sm:inline');
    expect(footer).toContain('text-[10px] text-muted-foreground"');
    expect(footer).toContain('hover:text-foreground');
  });

  it('the signed-in role chip is a named group (Badge renders a bare div)', () => {
    const topbar = readRepo(TOPBAR);
    const chip = topbar.split('signed-in role chip')[1].split('</Badge>')[0];
    expect(chip).toContain('role="group"');
    expect(chip).toContain('aria-label={`Signed in as ${roleBadgeLabel}`}');
  });
});

describe('the release surfaces speak the version', () => {
  it('package.json, whats-new and the changelog lead with 2.154.0 (re-anchored per release)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.198.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.198.0');
    expect(pkg.mbumah.baseVersion).toBe('2.198.0');
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed.indexOf("'2.189.0'")).toBeGreaterThan(-1);
    expect(feed.indexOf("'2.189.0'")).toBeLessThan(feed.indexOf("'2.153.0'"));
    expect(readRepo('CHANGELOG.md')).toContain('## [2.189.0]');
  });

  it('the unread counter test is re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(87);");
  });
});
