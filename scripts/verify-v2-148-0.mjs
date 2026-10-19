#!/usr/bin/env node
// v2.148.0 verification — "the shell meets the bar".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the shell acceptance sweep: the ten contrast violations fixed at their
// root tokens (count pills on red-600/amber-500 with the pulse gone, the
// rail's slate-400 quiet text, the dashboard's slate-500 family), the two
// keyboard-reachable scroll regions, the names moved onto roles that may
// carry them (group / note / timer), the skip link, and the run dialog's
// outcome dot. Comment-stripping before code searches (lesson 49);
// double-quoted strings throughout (lesson 61 amendment).

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

const SIDEBAR = 'src/components/layout/app-sidebar.tsx';
const TOPBAR = 'src/components/layout/top-bar.tsx';
const DASH = 'src/app/(shell)/tabs/dashboard-tab.tsx';
const MAINAPP = 'src/components/app/main-app.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const CHANGELOG = 'CHANGELOG.md';
const FEED = 'src/lib/whats-new.ts';
const TEST = 'src/tests/a11y-shell-v2148.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.148.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.148.0', `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.148.0', `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.148.0', `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-148-0'], 'verify:v2-148-0 script missing');
});

check('release surfaces: changelog leads 2.148.0 and the feed leads 2.148.0', () => {
  const cl = read(CHANGELOG);
  assert(cl.indexOf('## [2.148.0] The shell meets the bar') !== -1, 'changelog section missing');
  const feed = read(FEED);
  assert(feed.indexOf("version: '2.148.0'") !== -1, 'feed entry missing');
  assert(feed.indexOf("version: '2.148.0'") < feed.indexOf("version: '2.147.0'"), 'feed order wrong');
  assert(feed.includes('The shell meets the bar'), 'feed title missing');
});

// ── the count pills pass on their own token ────────────────────────────────
check('pills: all three mounts speak red-600/white + amber-500/slate-950', () => {
  const sidebar = stripComments(read(SIDEBAR));
  const topbar = stripComments(read(TOPBAR));
  const tone = "bg-red-600 text-white' : 'bg-amber-500 text-slate-950'";
  assert(sidebar.split(tone).length === 3, `sidebar mounts = ${sidebar.split(tone).length - 1}, want 2`);
  assert(topbar.includes(tone), 'topbar pill tone missing');
});

check('pills: no text-white in any pill base class (the tone owns the color)', () => {
  const sidebar = stripComments(read(SIDEBAR));
  // Both pills ride animate-badge-bounce-in; their base must not carry
  // text-white or the amber variant regresses to white-on-amber. The base
  // ends at the tone ternary (which legitimately carries text-white for
  // the red side) — split there.
  const chunks = sidebar.split('animate-badge-bounce-in').slice(1);
  assert(chunks.length >= 2, 'pill base chunks missing');
  for (const chunk of chunks) {
    const base = chunk.split('${')[0];
    assert(!base.includes('text-white'), 'pill base still carries text-white');
  }
});

check('pills: the pulse is gone from sidebar and topbar (a mid-dimmed frame is a failure)', () => {
  const sidebar = stripComments(read(SIDEBAR));
  const topbar = stripComments(read(TOPBAR));
  // Exact animate-pulse only — animate-pulse-slow is the decorative status
  // dot's own class, not a text pill.
  assert(!/\banimate-pulse(?!-)/.test(sidebar), 'sidebar still pulses');
  assert(!/\banimate-pulse(?!-)/.test(topbar), 'topbar still pulses');
  assert(sidebar.includes('animate-badge-bounce-in'), 'the one-shot bounce-in must stay');
});

// ── the dark rail's quiet text ─────────────────────────────────────────────
check('rail: section labels + kbd hints ride text-slate-400', () => {
  const sidebar = stripComments(read(SIDEBAR));
  assert(sidebar.includes('tracking-wider text-slate-400 flex items-center gap-1.5'), 'section label token missing');
  assert(!sidebar.includes('tracking-wider text-slate-500'), 'old section label token survives');
  assert((sidebar.match(/text-\[8px\] text-slate-400 hidden xl:inline/g) || []).length === 4, 'kbd hints not all moved');
});

// ── names on roles that may carry them ─────────────────────────────────────
check('kpi card: non-interactive spreads role=group, interactive keeps button+keys', () => {
  const dash = stripComments(read(DASH));
  const card = dash.split('function KpiCard(')[1].split('function KpiRow(')[0];
  assert(card.includes(": { role: 'group' })}"), 'group role missing');
  assert(card.includes("role: 'button', tabIndex: 0, onClick"), 'interactive role missing');
});

check('zero-sales pill: role=note + slate-600 on the slate-100 pill', () => {
  const dash = stripComments(read(DASH));
  const pill = dash.split('const zeroSalesTrendBadge')[1].split(') : null;')[0];
  assert(pill.includes('role="note"'), 'note role missing');
  assert(pill.includes('text-[10px] font-semibold text-slate-600'), 'slate-600 token missing');
});

check('clock: role=timer carries the name', () => {
  const topbar = stripComments(read(TOPBAR));
  const clock = topbar.split('Live date + clock')[1].split('</Badge>')[0];
  assert(clock.includes('role="timer"'), 'timer role missing');
  assert(clock.includes('aria-label="Current date and time"'), 'clock name missing');
});

// ── keyboard-reachable scroll regions ──────────────────────────────────────
check('dashboard: the four lists are focusable, named, ring-visible', () => {
  const dash = stripComments(read(DASH));
  const names = ['Recent sales', 'System activity', 'Customer spend rankings', 'Urgent alerts'];
  for (const name of names) {
    assert(dash.includes(`tabIndex={0} aria-label="${name}"`), `list "${name}" not focusable/named`);
  }
  assert((dash.match(/custom-scrollbar focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300/g) || []).length === 4, 'focus ring count wrong');
});

check('topbar: the search results panel is focusable and named', () => {
  const topbar = stripComments(read(TOPBAR));
  assert(topbar.includes('tabIndex={0} aria-label="Search results"'), 'search scroller not focusable');
});

// ── the muted-on-white family ──────────────────────────────────────────────
check('dashboard: no text-slate-400 survives; all-stock-healthy is emerald-700 ×2', () => {
  const dash = stripComments(read(DASH));
  assert((dash.match(/text-slate-400/g) || []).length === 0, 'slate-400 family survives');
  assert((dash.match(/text-emerald-700">All stock healthy/g) || []).length === 2, 'emerald-700 count wrong');
});

// ── the skip link ──────────────────────────────────────────────────────────
check('skip link: first focusable, hidden until focused, main accepts focus', () => {
  const mainapp = stripComments(read(MAINAPP));
  const shell = mainapp.split('<div className="flex h-screen overflow-hidden">')[1];
  const linkAt = shell.indexOf('href="#main-content"');
  const sidebarAt = shell.indexOf('<AppSidebar />');
  assert(linkAt > -1 && sidebarAt > -1 && linkAt < sidebarAt, 'skip link not before the sidebar');
  assert(shell.includes('sr-only focus:not-sr-only'), 'reveal-on-focus missing');
  assert(shell.includes('focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white'), 'revealed pill dress code missing');
  assert(mainapp.includes('<main id="main-content" tabIndex={-1}'), 'main does not accept focus');
  // The router soft-navs same-page hashes (pushState) — the fragment-focus
  // step never runs, so the handler must land the focus itself.
  const link = shell.split('data-testid="shell-skip-link"')[1].split('</a>')[0];
  assert(link.includes('preventDefault()') && link.includes('target.focus()'), 'the focus-landing click handler missing');
});

// ── the run dialog's outcome dot ───────────────────────────────────────────
check('run dialog: the attempts chip wears the tone dot inside the pill', () => {
  const payroll = stripComments(read(PAYROLL));
  const chip = payroll.split('data-testid="payroll-picker-attempts-chip"')[1].split(') : null}')[0];
  const dotAt = chip.indexOf('data-testid="payroll-picker-attempts-dot"');
  assert(dotAt > -1, 'dot missing');
  assert(chip.includes('aria-hidden'), 'dot not aria-hidden');
  assert(chip.includes("'bg-emerald-500 dark:bg-emerald-400'"), 'emerald tone missing');
  assert(chip.includes("'bg-amber-500 dark:bg-amber-400'"), 'amber tone missing');
  assert(chip.includes("'bg-muted-foreground/40'"), 'muted tone missing');
  const labelAt = chip.indexOf('{attempts.label}');
  assert(labelAt > dotAt, 'dot not before the label inside the chip');
});

// ── the live re-audit follow-ups ───────────────────────────────────────────
check('org console: the branch hint rides slate-600 (alpha token gone)', () => {
  const org = stripComments(read('src/components/workspace/org-console.tsx'));
  assert(!org.includes('text-muted-foreground/80'), 'alpha token survives');
  assert(org.includes('font-normal text-slate-600'), 'slate-600 hint missing');
});

check('alert host: the popup viewport is a named region', () => {
  const host = stripComments(read('src/components/alerts/alert-popup-host.tsx'));
  const viewport = host.split('if (alerts.length === 0) return null;')[1];
  assert(viewport.includes('role="region"'), 'region role missing');
  assert(viewport.includes('aria-label="Alert popups"'), 'name missing');
});

check('shell footer: no alpha-muted tokens survive (the /50 and /60 family)', () => {
  const mainapp = stripComments(read(MAINAPP));
  const footer = mainapp.split('<footer')[1] || '';
  assert(!/text-muted-foreground\/\d+/.test(footer), 'alpha-muted token survives in the footer');
  assert(footer.includes('text-[10px] text-muted-foreground hidden sm:inline'), 'version label token missing');
  assert(footer.includes('hover:text-foreground'), 'shortcuts hover token missing');
});

check('role chip: the signed-in Badge is a named group', () => {
  const topbar = stripComments(read(TOPBAR));
  const chip = topbar.split('signed-in role chip')[1].split('</Badge>')[0];
  assert(chip.includes('role="group"'), 'group role missing');
  assert(chip.includes('aria-label={`Signed in as ${roleBadgeLabel}`}'), 'name missing');
});

// ── tests + docs self-reference ────────────────────────────────────────────
check('tests: a11y-shell-v2148.test.ts exists and pins the same contracts', () => {
  const src = read(TEST);
  assert(src.includes('bg-red-600 text-white'), 'test misses the pill tone pin');
  assert(src.includes("'Recent sales'") && src.includes("'Urgent alerts'"), 'test misses the scroller names pin');
  assert(src.includes('custom-scrollbar focus-visible:outline-none focus-visible:ring-1'), 'test misses the ring pin');
  assert(src.includes('href="#main-content"'), 'test misses the skip link pin');
  assert(src.includes('payroll-picker-attempts-dot'), 'test misses the dot pin');
});

check('changelog: the 2.148.0 section names the audit findings and fixes', () => {
  const cl = read(CHANGELOG);
  const section = cl.slice(cl.indexOf('## [2.148.0]'), cl.indexOf('## [2.147.0]'));
  assert(section.includes('scrollable-region-focusable'), 'scrollable finding missing');
  assert(section.includes('aria-prohibited-attr'), 'prohibited-attr finding missing');
  assert(section.includes('### Fixed'), 'Fixed section missing');
  assert(section.includes('### Added'), 'Added section missing');
  assert(section.includes('### Verified'), 'Verified section missing');
});

check('feed: the 2.148.0 bullets speak shop-floor copy, not commit log', () => {
  const feed = read(FEED);
  const entry = feed.split("version: '2.148.0'")[1].split("version: '2.147.0'")[0];
  const bullets = (entry.match(/'/g) || []).length;
  assert(bullets >= 10, 'too few bullets');
  assert(entry.includes('Skip to main content'), 'skip link bullet missing');
  assert(entry.includes('outcome dot'), 'dot bullet missing');
});

console.log(`\nverify-v2-148-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
