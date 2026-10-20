import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.189.0 — the roster drills, and the net wears its verdict.
 *
 * Two carried options ship together, both answering the same question a
 * owner asks staring at the console: "so what do I DO with this?"
 *
 *   1. THE ROSTER DRILLS — v2.186.0 taught the desk's morning note to name
 *      its reviewers (the share-bar roster), but the rows kept their hands
 *      in their pockets: the answer to "who pulled the desk?" was on the
 *      screen and the drill-down was one click away, yet the row connected
 *      neither. This release each roster row becomes a real control that
 *      applies the panel's existing ?reviewer= filter — the same drill the
 *      ledger rows have had since v2.65.0, one state lift, no new wire.
 *      The org-wide contract holds: the digest strip NEVER re-keys (only
 *      the timeline below narrows). Clicking the drilled reviewer again
 *      releases the filter, matching the branch chips' toggle semantics.
 *      The affordance is honest — hover brightens the row and slides a
 *      chevron in; the drilled row wears the panel's emerald drill
 *      language (ring + tint + emerald bar + visible chevron); the figures
 *      re-tint with it; aria-pressed + a spoken label carry the state; the
 *      keyboard wears the house focus ring.
 *
 *   2. THE NET VERDICT — v2.187.0 gave the revenue modal's ribbon a VAT
 *      week-over-week chip (taxPriorWeekTotal's first consumer) but left
 *      the NET face mute about its own trend, even though both windows
 *      were already on the wire (netWeekTotal since v2.185.0's chip,
 *      netPriorWeekTotal since v2.187.0). This release the net lens grows
 *      its own verdict strip — structurally the VAT ribbon's mirror
 *      (label, week figure, arrowed verdict, prior chip) but wearing the
 *      net face's violet family so the two faces stay distinguishable at
 *      a glance. The honesty rule is the SAME as the VAT chip: up
 *      emerald, down red, flat calm, and a zero prior renders NO
 *      percentage — never an invented "0%", never a NaN.
 *
 * Pinned here: the drill's control semantics (type/aria-pressed/label),
 * the toggle (drilled ? null : name), the emerald drill language and the
 * chevron affordance, the caption + footer invitations, the v2.186.0
 * strip pins holding (share math, width cap, six rows, "+N more"), the
 * verdict's gate + fallback chain + honesty math (EXECUTED), the violet
 * family, the arrow semantics, the untouched v2.185.0/v2.187.0 shapes,
 * and the version.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const panels = readRepo('src/components/org/panels.tsx');
const modal = readRepo('src/components/org/kpi-row.tsx');
const pkg = JSON.parse(readRepo('package.json'));

describe('the roster drills - the rows answer back', () => {
  it('each roster row is a real control: typed, pressed, spoken, findable', () => {
    expect(panels).toContain('data-testid="desk-digest-roster-drill"');
    // the attributes between the drill button's <button and its testid
    const drillIdx = panels.indexOf('data-testid="desk-digest-roster-drill"');
    const btnOpen = panels.lastIndexOf('<button', drillIdx);
    const btnHead = panels.slice(btnOpen, drillIdx);
    expect(btnHead).toContain('type="button"');
    expect(btnHead).toContain('onClick={() => onFilterChange({ ...filter, reviewer: drilled ? null : r.name })}');
    expect(btnHead).toContain('aria-pressed={drilled}');
    expect(panels).toContain("aria-label={`${drilled ? 'Stop reviewing' : 'Review'} ${r.name}'s desk visits — ${r.visits} of ${yesterday.visits} yesterday`}");
  });

  it('the drill TOGGLES: clicking the drilled reviewer releases the filter', () => {
    // The same semantics the branch chips have had since v2.65.0 —
    // active chip clicked again goes back to "all".
    expect(panels).toContain('reviewer: drilled ? null : r.name');
    const drilled = panels.indexOf('const drilled = reviewer === r.name;');
    const toggle = panels.indexOf('reviewer: drilled ? null : r.name');
    expect(drilled).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(drilled);
  });

  it('the drilled row wears the emerald drill language; the rest stay calm until hovered', () => {
    expect(panels).toContain("'bg-emerald-50/90 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40'");
    expect(panels).toContain("'hover:bg-white/80 dark:hover:bg-slate-800/50'");
    // the share bar re-tints with the drill — emerald-600 while drilled
    expect(panels).toContain("${drilled ? 'bg-emerald-600' : 'bg-emerald-500/80'}");
    // the figures re-tint with the drill
    expect(panels).toContain("${drilled ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}");
    // the keyboard wears the house focus ring
    expect(panels).toContain('focus-visible:ring-2 focus-visible:ring-emerald-400');
  });

  it('the chevron affordance: hidden until hovered, visible while drilled', () => {
    expect(panels).toContain('group-hover:translate-x-0 group-hover:opacity-70');
    // the drilled chevron wears the swept emerald token (emerald-800 — the
    // v2.149.0 contrast sweep bans text-emerald-600 on light surfaces)
    expect(panels).toContain("'translate-x-0 text-emerald-800 opacity-100 dark:text-emerald-400'");
    expect(panels).toContain("'-translate-x-0.5 text-slate-500 opacity-0 group-hover:translate-x-0 group-hover:opacity-70 dark:text-slate-500'");
  });

  it('the strip invites the drill — caption and footer both speak it', () => {
    expect(panels).toContain('· click a name to pull their file');
    expect(panels).toContain('Click a row — or a name in the digest roster — to review that person&apos;s desk visits');
  });

  it('the v2.186.0 strip pins HOLD — the drill re-keyed nothing', () => {
    // the gate, the share math, the width cap, the six-row slice, the honest "+N more"
    expect(panels).toContain('{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && (');
    expect(panels).toContain('const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;');
    expect(panels).toContain('style={{ width: `${Math.min(100, share)}%` }}');
    expect(panels).toContain('yesterday.reviewerRows.slice(0, 6)');
    expect(panels).toContain('+{yesterday.reviewerRows.length - 6} more reviewer');
  });

  it('the org-wide contract holds: the strip renders from the payload, never the filtered timeline', () => {
    // the roster still reads `yesterday.*` (the org-wide note), and the
    // drill only WRITES the filter (onFilterChange) — it never re-keys
    // what the strip reads.
    const rosterBlock = panels.split('data-testid="desk-digest-roster"')[1]?.split('{yesterday.reviewerRows.length > 6 && (')[0] ?? '';
    expect(rosterBlock).toContain('yesterday.reviewerRows.slice(0, 6)');
    expect(rosterBlock).toContain('onFilterChange(');
    expect(rosterBlock).not.toContain('recent.filter');
  });
});

describe('the net verdict - the second face speaks its trend', () => {
  it('the strip renders ONLY in the net lens and ONLY when the prior arrived', () => {
    expect(modal).toContain("lens === 'net' && k.revenue.netPriorWeekTotal != null && (() => {");
    // the v2.185.0 VAT ribbon keeps its own lens-agnostic gate
    expect(modal).toContain('{k.revenue.taxWeekTotal != null && (');
  });

  it('the week figure rides the SAME fallback chain the net grid uses', () => {
    expect(modal).toContain('const netWeek = k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0);');
    expect(modal).toContain('const netPrior = k.revenue.netPriorWeekTotal ?? 0;');
  });

  it('the honesty rule: a zero prior renders NO percentage, never an invented 0%', () => {
    expect(modal).toContain('const netPct = netPrior > 0 ? Math.round((netDelta / netPrior) * 1000) / 10 : null;');
    expect(modal).toContain("{netPct == null ? 'vs prior' : `${netDelta > 0 ? '+' : ''}${netPct}% vs prior`}");
  });

  it('the arrows mirror the VAT chip: emerald up, red down, calm flat', () => {
    expect(modal).toContain("{netDelta > 0 ? '▲' : netDelta < 0 ? '▼' : '—'}");
    expect(modal).toContain("netDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : netDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-50 text-slate-500 ring-slate-200'");
  });

  it('the strip wears the NET face violet - the two faces stay distinguishable', () => {
    expect(modal).toContain('data-testid="revenue-net-wow-strip"');
    expect(modal).toContain('data-testid="revenue-net-wow-week"');
    expect(modal).toContain('data-testid="revenue-net-wow"');
    expect(modal).toContain('data-testid="revenue-net-wow-prior"');
    expect(modal).toContain('border border-violet-100 bg-violet-50/70');
    expect(modal).toContain('text-[10px] font-semibold uppercase tracking-wide text-violet-800');
  });

  it('EXECUTED: the verdict math agrees with the v2.187.0 E2E figures', () => {
    // Live figures from the shipped v2.187.0 build: net 7d 286,450 vs
    // prior 350,500 — the formula must reproduce them exactly.
    const verdict = (netWeek: number, netPrior: number) => {
      const netDelta = netWeek - netPrior;
      const netPct = netPrior > 0 ? Math.round((netDelta / netPrior) * 1000) / 10 : null;
      return {
        arrow: netDelta > 0 ? '▲' : netDelta < 0 ? '▼' : '—',
        text: netPct == null ? 'vs prior' : `${netDelta > 0 ? '+' : ''}${netPct}% vs prior`,
      };
    };
    expect(verdict(286450, 350500)).toEqual({ arrow: '▼', text: '-18.3% vs prior' });
    // a rising week wears the explicit plus
    expect(verdict(360000, 350500)).toEqual({ arrow: '▲', text: '+2.7% vs prior' });
    // a zero prior renders NO percentage — never an invented 0%
    expect(verdict(12000, 0)).toEqual({ arrow: '▲', text: 'vs prior' });
    // a genuinely flat week stays calm
    expect(verdict(9000, 9000)).toEqual({ arrow: '—', text: '0% vs prior' });
  });
});

describe('the version contract', () => {
  it('package.json rides at 2.191.0', () => {
    expect(pkg.version).toBe('2.191.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.191.0');
    expect(pkg.mbumah.baseVersion).toBe('2.191.0');
  });
});
