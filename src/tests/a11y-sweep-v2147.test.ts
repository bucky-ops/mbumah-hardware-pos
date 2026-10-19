import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.147.0 — the gate passes the keyboard.
 *
 * Gap: the EMS spec's acceptance lines name two things every surface must
 * hold — "No horizontal scroll on supported viewports" and "Accessibility
 * passes". A scoped axe-core + keyboard-only sweep over the HR workspace
 * found three root causes, all fixed here:
 *  1. The ten-link header nav was the single unclipped element pushing
 *     every HR page to 1141px at 390px width (the runs table already
 *     scrolled inside its own wrapper). The header wraps now.
 *  2. The desk's period picker read to assistive tech as an unnamed
 *     button — the aria-label sat on the Select root, which Radix never
 *     forwards to the trigger.
 *  3. The split line carried aria-label on a plain <span>, whose ARIA
 *     `generic` role prohibits author naming. It is a <p> now.
 *
 * Covered here (source pins — the live sweep itself is agent-browser's,
 * recorded in the worklog):
 *  - the layout's wrap contract (min-h + flex-wrap on the row, the nav,
 *    and the mobile-compact link dress code),
 *  - the desk's toolbar wrap, the named trigger, the <p> split, the
 *    table's scroll wrapper,
 *  - the payroll runs table keeps its own wrapper (regression pin),
 *  - the release surfaces speak the acceptance lines.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const LAYOUT = 'src/app/(shell)/hr/layout.tsx';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';

describe('the header wraps instead of the page scrolling', () => {
  const layout = () => readRepo(LAYOUT);

  it('the header row drops its fixed height and allows the nav to drop below', () => {
    // h-14 forced one row; min-h-14 + flex-wrap lets the nav take its own
    // line on phones while desktop keeps the single-row shape.
    expect(layout()).toContain('flex min-h-14 max-w-7xl flex-wrap items-center');
  });

  it('the nav itself wraps, right-aligned, every link visible', () => {
    // No overflow-x hiding — the acceptance line is about the PAGE not
    // scrolling, and hidden links are worse than wrapped links.
    expect(layout()).toContain('ml-auto flex flex-wrap items-center justify-end gap-1');
  });

  it('nav links keep their accessible name source and compact on phones only', () => {
    const src = layout();
    expect(src).toContain('aria-label="HR navigation"');
    // The mobile-compact dress code: smaller padding/type under sm:, the
    // desktop size unchanged from sm: up.
    expect(src).toContain('sm:px-3 sm:py-1.5 sm:text-sm');
  });

  it('desktop keeps the exact link classes it had (only the phone sizes shrank)', () => {
    // The desktop dress code is untouched: font-medium + hover accent.
    expect(layout()).toContain('font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground');
  });
});

describe('the desk toolbar and table fit a phone', () => {
  const desk = () => readRepo(DESK);

  it('the controls row wraps (picker, batch door, lens trio, csv, refresh)', () => {
    expect(desk()).toContain('<div className="flex flex-wrap items-center gap-2">');
  });

  it('the approval table scrolls inside the shadcn wrapper, never the page', () => {
    expect(desk()).toContain('<div className="relative w-full overflow-x-auto">');
    expect(desk()).toContain('<Table data-testid="hr-timesheet-desk">');
  });

  it('the scope trigger carries the label Radix can actually announce', () => {
    // The label moved from the Select root (never forwarded to the
    // trigger) onto the SelectTrigger itself.
    const src = desk();
    expect(src).toContain('aria-label="Scope the timesheet desk to a payroll period"');
    expect(src).toContain('data-testid="hr-timesheet-scope-picker"');
  });

  it('the dead root-level aria-label is gone (it never reached a button)', () => {
    const src = desk();
    // The Select root no longer pretends to name the control.
    const rootCall = src.slice(src.indexOf('<Select'));
    const rootEnd = rootCall.indexOf('>');
    expect(rootCall.slice(0, rootEnd)).not.toContain('aria-label');
  });

  it('the split line is a <p role="note"> — an explicit role that may carry author naming', () => {
    // aria-label on a plain <span> (role generic) is prohibited by ARIA;
    // axe additionally wants an EXPLICIT role on a p before it trusts the
    // label ("not well supported on a p with no valid role attribute").
    // role="note" — a section subclass whose content is ancillary, which
    // is exactly what the split is beside the total chip — supports
    // naming from author.
    expect(desk()).toContain('data-testid="hr-timesheet-split"');
    const splitIdx = desk().indexOf('data-testid="hr-timesheet-split"');
    const openTagStart = desk().lastIndexOf('<p', splitIdx);
    expect(openTagStart).toBeGreaterThan(-1);
    const openTag = desk().slice(openTagStart, splitIdx);
    expect(openTag).toContain('role="note"');
    expect(openTag).toContain('m-0 inline-flex');
    expect(openTag).not.toContain('<span');
  });
});

describe('the payroll page keeps the surfaces it already had', () => {
  it('the runs table stays inside its own overflow wrapper (regression pin)', () => {
    const src = readRepo(PAYROLL);
    expect(src).toContain('<div className="overflow-x-auto">');
  });

  it('the runs table trigger labels stay label-associated (untouched this round)', () => {
    const src = readRepo(PAYROLL);
    // The dialog pickers carry id + Label htmlFor pairs — axe was clean
    // here before the sweep and must stay so.
    expect(src).toContain('id="run-period"');
    expect(src).toContain('id="run-type"');
  });
});

describe('the release surfaces speak the acceptance sweep', () => {
  it('the changelog names both acceptance lines and the three root causes', () => {
    const changelog = readRepo('CHANGELOG.md');
    expect(changelog).toContain('## [2.147.0] The gate passes the keyboard');
    expect(changelog).toContain('No horizontal scroll on supported viewports');
    expect(changelog).toContain('Accessibility passes');
  });

  it('the whats-new feed leads with 2.147.0', () => {
    const feed = readRepo('src/lib/whats-new.ts');
    const lead = feed.indexOf("version: '2.147.0'");
    expect(lead).toBeGreaterThan(-1);
    expect(feed).toContain('title: ');
  });
});
