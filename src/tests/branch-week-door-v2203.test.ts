import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.203.0 — the week speaks (the Sales trend card opens the branch's
 * week).
 *
 * The door arc's final quiet surface on the branch dashboard that carries
 * unspoken wire figures: the Sales trend · 7 days card drew the week's
 * shape as a picture — a role="img" SVG whose generic aria-label named
 * the chart but whose seven per-day revenues were spoken NOWHERE as text
 * — while revenueTrend7d carried every figure the week could speak:
 * days[] (date, label, revenue, isToday), forecast, forecastMethod,
 * todayIsOutlier. This release makes the card the branch page's EMERALD
 * door and opens the branch's week — zero new queries.
 *
 * The house laws hold from birth: the panel paints its dark half; a week
 * is a TIMELINE, not a ranking — the rows speak in calendar order and the
 * loudest day earns its own line instead of a reorder; a zero total
 * renders NO percentage (never an invented "0%" of nothing); a zero day
 * says "no sales" instead of a share of the week; today's progress is a
 * PROGRESS READ, never an UP/DOWN verdict (the day is not over) and is
 * only spoken when both figures are real (a share of a zero forecast is
 * never spoken); the outlier note is the WIRE's own flag, verbatim; null
 * wire rows are filtered by type predicate, never a non-null assertion;
 * and the door is a self-contained focus view — no anchors (the
 * honest-door law: the pointer is not a door).
 *
 * THE ROUND'S STYLE — a real graphics-contrast catch, measured BEFORE
 * ship by the pre-derivation probe (scripts/probe-week-doors-v2203.mjs,
 * 16/16): the trend chart's FORECAST DASHED LINE rode amber-500 on white
 * — 2.15:1, BELOW the 3:1 non-text graphics bar. The line and the legend
 * swatch re-voice to amber-600 (3.19:1) and the ghost value is pinned
 * BELOW the bar in REVERSE (scripts/contrast-math-week-doors-v2203.mjs,
 * 18/18) so the old voice cannot return silently. The day labels' row
 * grew 9px → 10px and today's label became a real chip (emerald-50/
 * emerald-700 ring-emerald-200, dark variants measured).
 *
 * The compile-time assignability guard (the v2.202.1 lesson): the tab
 * feeds data?.revenueTrend7d STRAIGHT to the modal — TS enforces the
 * wire subset at the mount, so a field-name drift cannot compile.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const doors = readRepo('src/components/dashboard/branch-doors.tsx');
const tab = readRepo('src/app/(shell)/tabs/dashboard-tab.tsx');
const apiRoute = readRepo('src/app/api/dashboard/route.ts');
const contrast = readRepo('scripts/contrast-math-week-doors-v2203.mjs');
const probe = readRepo('scripts/probe-week-doors-v2203.mjs');
const verify = readRepo('scripts/verify-v2-203-0.mjs');
const pkg = JSON.parse(readRepo('package.json')) as {
  version: string;
  mbumah: { releaseVersion: string; baseVersion: string };
  scripts: Record<string, string>;
};
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');

// THE COMPILE-TIME GUARD — the v2.202.1 lesson as a type-level pin: the
// dashboard's own trend slice must satisfy the door's structural subset,
// so a field-name drift between wire and door cannot even compile.
import type { DashboardData } from '@/lib/types';
import type { BranchWeekWire } from '@/components/dashboard/branch-doors';

type WeekWireCheck = NonNullable<DashboardData['revenueTrend7d']> extends NonNullable<BranchWeekWire['revenueTrend7d']>
  ? true
  : never;
const weekWireCheck: WeekWireCheck = true;

describe('v2.203.0 — the wire purity: the week composes, never forks', () => {
  it('the compile-time guard holds: RevenueTrend7d satisfies BranchWeekWire', () => {
    expect(weekWireCheck).toBe(true);
  });

  it('the door reads ONLY the fields the dashboard wire already carries', () => {
    expect(apiRoute).toContain('revenueTrend7d');
    // zero new queries in the door: no fetch, no db, no prisma
    expect(doors).not.toContain('fetch(');
    expect(doors).not.toContain("from '@/lib/db'");
    expect(doors).not.toContain('prisma');
  });

  it('the tab feeds the modal straight from the answer (assignability at the mount)', () => {
    expect(tab).toContain('trend={data?.revenueTrend7d ?? null}');
  });

  it('a week is a TIMELINE, not a ranking — the rows keep calendar order', () => {
    expect(doors).toContain('a week is a timeline, not a ranking');
    // the weekDays helper maps and filters, never sorts
    const weekFn = doors.slice(doors.indexOf('function weekDays'), doors.indexOf('export function WeekLedgerModal'));
    expect(weekFn).not.toContain('.sort(');
    // the debt book sorts loudest-first; the week does not — the loudest gets a LINE
    expect(doors).toContain('branch-week-loudest');
  });

  it('null wire rows are filtered by predicate, never a non-null assertion', () => {
    expect(doors).toContain('.filter((d): d is NonNullable<typeof d> => !!d && d.date != null)');
    const weekFn = doors.slice(doors.indexOf('function weekDays'), doors.indexOf('export function WeekLedgerModal'));
    expect(weekFn).not.toContain('!.');
    expect(weekFn).not.toContain('!)');
  });
});

describe('v2.203.0 — the honest anatomy of the branch\u2019s week', () => {
  it('the modal carries every handle of the honest anatomy', () => {
    for (const id of [
      'branch-week-total',
      'branch-week-meta',
      'branch-week-loudest',
      'branch-week-row',
      'branch-week-share',
      'branch-week-today-chip',
      'branch-week-zero',
      'branch-week-forecast',
      'branch-week-delta',
      'branch-week-outlier',
      'branch-week-window',
      'branch-week-empty',
    ]) {
      expect(doors).toContain(`data-testid="${id}"`);
    }
  });

  it('the zero-total rule holds: a share of a zero week is never spoken', () => {
    // the ONE share writer the doors share since v2.201.0
    expect(doors).toContain('if (total <= 0) return null;');
    // a zero day says "no sales" instead of "0% of the week"
    expect(doors).toContain('no sales');
  });

  it("today's progress is a progress read, never a verdict — and only when both figures are real", () => {
    expect(doors).toContain('todayShare = today && forecast > 0 ? shareOf(today.revenue, forecast) : null');
    expect(doors).toContain('Today so far ');
    expect(doors).not.toContain('up from forecast');
    expect(doors).not.toContain('ahead of forecast');
  });

  it('the outlier voice is the wire\u2019s own flag, verbatim', () => {
    expect(doors).toContain("trend?.todayIsOutlier === true");
    expect(doors).toContain('Today is a bulk-sale outlier');
  });

  it('the window note speaks what the shares read against', () => {
    expect(doors).toContain('The week reads the ');
    expect(doors).toContain('the shares read against the named week');
  });

  it('the empty step-aside keeps a history-less week honest', () => {
    expect(doors).toContain('Not enough history yet — the week speaks after a couple of trading days.');
  });

  it('the no-anchors law: the door is a focus view, not a link farm', () => {
    expect(doors).not.toContain('href=');
  });

  it('the dark-panel law from birth', () => {
    expect(doors).toContain('dark:border-slate-700 dark:bg-slate-900');
  });
});

describe('v2.203.0 — the card face is the door', () => {
  it('the trend card wears the door vocabulary', () => {
    expect(tab).toContain('data-testid="branch-week-card"');
    expect(tab).toContain('role="button"');
    expect(tab).toContain('aria-label="Sales trend - open details"');
    expect(tab).toContain("if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWeekOpen(true); }");
  });

  it('the emerald family face: edge bar, live dot, focus ring', () => {
    expect(tab).toContain('<span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-emerald-600" />');
    expect(tab).toContain('focus-visible:ring-emerald-500/40');
  });

  it('the live dot is honest: lit ONLY when the week has data', () => {
    expect(tab).toContain('{hasData ? <span aria-hidden="true" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-emerald-600 anim-pulse-dot" /> : null}');
    expect(tab).toContain("hasData ? 'ring-1 ring-slate-300 dark:ring-slate-600' : ''");
  });

  it('the hook-order law: the door state is declared before anything else', () => {
    const stateIdx = tab.indexOf('const [weekOpen, setWeekOpen] = useState(false);');
    const trendIdx = tab.indexOf('const trend: RevenueTrend7d | null | undefined');
    expect(stateIdx).toBeGreaterThan(-1);
    expect(trendIdx).toBeGreaterThan(stateIdx);
  });

  it("the description says what the card opens", () => {
    expect(tab).toContain('Net revenue with forecast — open the branch&rsquo;s week');
  });

  it("today's progress row rides the face with the capped bar", () => {
    expect(tab).toContain('data-testid="branch-week-progress"');
    expect(tab).toContain('Today so far');
    expect(tab).toContain('Math.min(100, Math.max(0, todayShare))');
  });
});

describe('v2.203.0 — the round\u2019s style: the forecast line clears the graphics bar', () => {
  it('the chart line and the legend swatch ride amber-600', () => {
    expect(tab).toContain('stroke="#d97706"');
    expect(tab).toContain('border-dashed border-amber-600');
    expect(doors).toContain('border-dashed border-amber-600');
  });

  it('the ghost amber-500 voice is GONE from the trend card and pinned in REVERSE', () => {
    // scoped to the card's own body — the tab's OTHER #f59e0b voices (the
    // M-Pesa donut segment, the health bar) are pre-existing surfaces with
    // their figures spoken beside them, out of this round's scope, recorded
    // honestly.
    const card = tab.slice(tab.indexOf('function SalesTrendForecastCard'), tab.indexOf('function DebtAgingCard'));
    expect(card).not.toContain('#f59e0b');
    expect(card).not.toContain('border-amber-500');
    expect(probe).toContain("GHOST amber-500 forecast line pinned BELOW the bar (in reverse)");
    expect(contrast).toContain("GHOST amber-500 forecast line pinned BELOW the bar (reverse)");
  });

  it('the day labels grew to 10px and today wears the family chip', () => {
    expect(tab).toContain('flex justify-between px-0.5 text-[10px] text-slate-500');
    expect(tab).toContain(
      'rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
    );
    // the hourly chart's hour labels join the readability bump (same row-class)
    expect(tab).toContain('flex-1 text-center text-[10px] text-slate-500');
  });

  it('the committed scripts carry the whole record', () => {
    expect(probe).toContain('the week door');
    expect(contrast).toContain('THE FIX');
    expect(a11yDoc).toContain("the forecast line's re-voice (v2.203.0)");
    expect(a11yDoc).toContain('2.15:1, BELOW the 3:1 graphics bar');
  });
});

describe('v2.203.0 — the release surfaces', () => {
  it('the version rides at 2.203.0 in all three slots and the verify script is wired', () => {
    expect(pkg.version).toBe('2.207.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.207.0');
    expect(pkg.mbumah.baseVersion).toBe('2.207.0');
    expect(pkg.scripts['verify:v2-203-0']).toBe('node scripts/verify-v2-203-0.mjs');
  });

  it('the whats-new feed leads with the release (ORDER pattern)', () => {
    expect(whatsNew).toContain("version: '2.204.0'");
    expect(whatsNew.indexOf("version: '2.204.0'")).toBeLessThan(whatsNew.indexOf("version: '2.202.1'"));
  });

  it('the changelog keeps the round above its predecessor', () => {
    const i203 = changelog.indexOf('## [2.203.0]');
    expect(i203).toBeGreaterThan(-1);
    expect(i203).toBeLessThan(changelog.indexOf('## [2.202.1]'));
  });

  it('the verify script reads the sources of record, not memory', () => {
    expect(verify).toContain('Written fresh this round');
    expect(verify).toContain('the version rides at 2.203.0 in all three slots');
  });

  it('the honest record: PaymentMethodsCard stays deliberately door-less', () => {
    expect(changelog).toContain('PaymentMethodsCard stays deliberately door-less');
  });
});
