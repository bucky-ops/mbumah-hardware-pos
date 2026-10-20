// MBUMAH HARDWARE POS - the hints become visible (v2.168.0)
//
// v2.167.0 made the Automation card's hints keyboard-REACHABLE (focusable
// chips, sr-only copies) — but the copy itself was still invisible to
// SIGHTED keyboard users: a focus ring says "here", not "why". This round
// the sentence becomes VISIBLE at the moment of focus: hinted chips and
// the failed-tick pill render a popover bubble on group-focus-visible —
// an ABSOLUTE overlay (the two-row chip area never reflows), aria-hidden
// because the sr-only line already spoke it once. The reaper chip's
// `· reaped N` / `· clean` suffix and a failure chip's `· HTTP N` suffix
// gain their own honest tooltips. And the org console's remaining
// title-only LINKS learn to speak: the HR tiles echo their title sentence
// to screen readers, and the per-branch People & payroll deep links fold
// the hover sentence INTO the accessible name — one truth, two surfaces.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const orgConsole = repo('src/components/workspace/org-console.tsx');
const cronDoc = repo('docs/cron-operations.md');

const cardStart = orgConsole.indexOf('data-testid="automation-card"');
const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));

// the shared bubble recipe — every visible-on-focus surface rides it
const BUBBLE_RECIPE = 'pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-focus-visible:block';

describe('the hints become visible (chips + pill)', () => {
  it('hinted chips render a popover bubble on keyboard focus, guarded by the same lookup', () => {
    expect(card).toContain('data-testid="automation-subjob-hint-bubble"');
    // the bubble is guarded by the SAME expression as the sr-only copy —
    // an unhinted chip renders no bubble, never a guess (the title, the
    // tab stop and the cursor affordance use the ternary form instead)
    const guardCount = (card.match(/AUTOMATION_SUBJOB_HINTS\[job\.name\] && \(/g) || []).length;
    expect(guardCount).toBe(2); // the sr-only line + the visible bubble
    expect(card).toContain(BUBBLE_RECIPE);
  });

  it('the failed-tick pill renders the same bubble, guarded by the same helper call', () => {
    expect(card).toContain('data-testid="automation-failed-bubble"');
    // both the sr-only line and the bubble ride failedTickTooltip — the
    // single-source helper from v2.167.0 still feeds every surface
    expect(card).toContain('{failedTickTooltip(automation) && (');
    const helperUses = (card.match(/failedTickTooltip\(automation\)/g) || []).length;
    expect(helperUses).toBeGreaterThanOrEqual(6); // title + tabIndex + sr-only + bubble + caps
    // the bubble overrides the pill's 9px uppercase display type
    expect(card).toContain('text-[11px] font-normal normal-case tracking-normal');
  });

  it('the bubble is an absolute overlay - the two-row chip area never reflows', () => {
    // absolute + top-full + mt-1.5: the bubble floats over the cadence line
    // below instead of pushing it; pointer-events-none keeps it unclickable
    expect(BUBBLE_RECIPE).toContain('absolute left-0 top-full');
    expect(BUBBLE_RECIPE).toContain('pointer-events-none');
    expect(BUBBLE_RECIPE).not.toContain('static');
    expect(BUBBLE_RECIPE).not.toContain('relative');
  });

  it('the bubble speaks once - aria-hidden because the sr-only line already said it', () => {
    const bubbleAt = card.indexOf('data-testid="automation-subjob-hint-bubble"');
    expect(bubbleAt).toBeGreaterThan(-1);
    const ariaAt = card.lastIndexOf('aria-hidden="true"', bubbleAt);
    expect(ariaAt).toBeGreaterThan(-1);
    expect(bubbleAt - ariaAt).toBeLessThan(80);
  });

  it('the bubble wears the popover token pair - full contrast, no alpha families', () => {
    expect(BUBBLE_RECIPE).toContain('bg-popover');
    expect(BUBBLE_RECIPE).toContain('text-popover-foreground');
    expect(BUBBLE_RECIPE).not.toMatch(/\/\d/); // no alpha tokens in the recipe
  });

  it('chips stay focusable with family rings - the v2.167.0 contract is untouched', () => {
    expect(orgConsole).toContain(
      'tabIndex={AUTOMATION_SUBJOB_HINTS[job.name] ? 0 : undefined}',
    );
    expect(card).toContain('relative group inline-flex items-center gap-1 rounded-full border border-emerald-300');
    expect(card).toContain('relative group inline-flex items-center gap-1 rounded-full border border-red-300');
    expect(orgConsole).toContain('tabIndex={failedTickTooltip(automation) ? 0 : undefined}');
  });
});

describe('the suffixes speak for themselves', () => {
  it('the reaper suffix carries an honest tooltip - ledger count, zero means zero', () => {
    expect(card).toContain("className=\"tabular-nums cursor-help\"");
    expect(card).toContain('expired session');
    expect(card).toContain('the sweep');
    expect(card).toContain('zero expired sessions at tick time');
  });

  it('a failure suffix names its source - the dispatcher recorded it', () => {
    expect(card).toContain('The dispatcher recorded HTTP');
    expect(card).toContain("not a guess.");
  });
});

describe('the title-only links learn to speak', () => {
  it('HR tiles echo their title sentence to screen readers, only when titled', () => {
    expect(orgConsole).toContain('{title && <span className="sr-only"> — {title}</span>}');
    // the echo lives inside the Link branch (after the Open affordance)
    const linkAt = orgConsole.indexOf('if (href) {');
    const echoAt = orgConsole.indexOf('{title && <span className="sr-only"> — {title}</span>}');
    expect(linkAt).toBeGreaterThan(-1);
    expect(echoAt).toBeGreaterThan(linkAt);
  });

  it('the per-branch People & payroll links fold the hover sentence into the accessible name', () => {
    // one truth, two surfaces: the title stays for the mouse, the
    // accessible name IS the same sentence for AT
    expect(orgConsole).toContain(
      'aria-label={`Open the People & Payroll tab pre-filtered to ${store.name}`}',
    );
    expect(orgConsole).toContain(
      'title={`Open the People & Payroll tab pre-filtered to ${store.name}`}',
    );
  });

  it('StatCards keep their visible Open affordance on keyboard focus', () => {
    expect(orgConsole).toContain('group-hover:opacity-100 group-focus-visible:opacity-100');
  });
});

describe('the doc says what the card now does', () => {
  it('cron-operations.md gains the v2.168.0 visible-hints note', () => {
    expect(cronDoc).toContain('The hints become visible (v2.168.0)');
    expect(cronDoc).toContain('never reflows');
    expect(cronDoc).toContain('one truth, two surfaces');
  });

  it('the v2.167.0 note stays - the doc reads as a chronology, not a replacement', () => {
    expect(cronDoc).toContain('The hints reach the keyboard (v2.167.0)');
    expect(cronDoc).toContain('never a dead tab stop');
  });
});
