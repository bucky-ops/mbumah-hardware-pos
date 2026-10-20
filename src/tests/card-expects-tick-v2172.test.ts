// MBUMAH HARDWARE POS - the card expects the tick (v2.172.0)
//
// The automation card could say "Last tick 3h ago" (history) — but the
// operator still had to arithmetic their way to "is the heartbeat ON
// TIME?". This round the card answers it: a pure lib computes the next
// due slot from the real cadences (pinger top-of-hour UTC when armed;
// Vercel's daily slot when not), with a 15-minute grace window and a
// posture deferral that never cries wolf while CRON_SECRET is unset.
// The math is EXECUTED here (the lib is importable, no DOM), the wire
// and render contracts are pinned as source, per the house pattern.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TICK_GRACE_MINUTES,
  slotTopOfHour,
  nextTopOfHour,
  nextVercelSlot,
  formatUtcClock,
  formatEatClock,
  nextTickExpectation,
  expectationTextClass,
  expectationDotClass,
} from '@/lib/org/tick-expectation';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const automationApi = repo('src/app/api/org/automation/route.ts');
const orgConsole = repo('src/components/workspace/org-console.tsx');
const tickLib = repo('src/lib/org/tick-expectation.ts');
const cronDoc = repo('docs/cron-operations.md');

const utc = (iso: string) => new Date(iso);

describe('the expectation math (executed, pure lib)', () => {
  it('slotTopOfHour floors a mid-hour instant to the top of its UTC hour', () => {
    expect(slotTopOfHour(utc('2026-10-20T13:07:34.500Z')).toISOString()).toBe(
      '2026-10-20T13:00:00.000Z',
    );
    expect(slotTopOfHour(utc('2026-10-20T00:07:00.000Z')).toISOString()).toBe(
      '2026-10-20T00:00:00.000Z',
    );
    // day boundaries are UTC-day boundaries too
    expect(slotTopOfHour(utc('2026-10-20T23:59:59.000Z')).toISOString()).toBe(
      '2026-10-20T23:00:00.000Z',
    );
  });

  it('nextTopOfHour is STRICTLY after now — an exact slot rolls to the next hour', () => {
    expect(nextTopOfHour(utc('2026-10-20T13:00:00.000Z')).toISOString()).toBe(
      '2026-10-20T14:00:00.000Z',
    );
    expect(nextTopOfHour(utc('2026-10-20T13:07:00.000Z')).toISOString()).toBe(
      '2026-10-20T14:00:00.000Z',
    );
    // 23:07 rolls across the UTC midnight line
    expect(nextTopOfHour(utc('2026-10-20T23:07:00.000Z')).toISOString()).toBe(
      '2026-10-21T00:00:00.000Z',
    );
  });

  it('nextVercelSlot names the next daily {hour}:00 UTC strictly after now', () => {
    // before today's slot → today's slot
    expect(nextVercelSlot(utc('2026-10-20T02:00:00.000Z'), 3).toISOString()).toBe(
      '2026-10-20T03:00:00.000Z',
    );
    // after today's slot → tomorrow's
    expect(nextVercelSlot(utc('2026-10-20T04:00:00.000Z'), 3).toISOString()).toBe(
      '2026-10-21T03:00:00.000Z',
    );
    // an EXACT slot instant is not strictly after itself → rolls a day
    expect(nextVercelSlot(utc('2026-10-20T03:00:00.000Z'), 3).toISOString()).toBe(
      '2026-10-21T03:00:00.000Z',
    );
    // a non-default hour is honored (the API owns the number):
    // 06:00 is after 05:00 today → tomorrow's 05:00 slot
    expect(nextVercelSlot(utc('2026-10-20T06:00:00.000Z'), 5).toISOString()).toBe(
      '2026-10-21T05:00:00.000Z',
    );
  });

  it("the clock formatters speak the card's two timezones compactly", () => {
    expect(formatUtcClock(utc('2026-10-20T13:00:00.000Z'))).toBe('13:00 UTC');
    // EAT = UTC+3, the same shift formatEatStamp applies
    expect(formatEatClock(utc('2026-10-20T13:00:00.000Z'))).toBe('16:00 EAT');
    expect(formatEatClock(utc('2026-10-20T21:30:00.000Z'))).toBe('00:30 EAT');
  });

  it('on-time: armed with a recent tick, the line names the next due slot in both clocks', () => {
    const expectation = nextTickExpectation({
      lastTickAt: '2026-10-20T11:58:00.000Z',
      generatedAt: '2026-10-20T12:10:00.000Z',
      secretConfigured: true,
      vercelHourUtc: 3,
    });
    expect(expectation).not.toBeNull();
    expect(expectation?.state).toBe('on-time');
    expect(expectation?.text).toBe(
      "Next tick due 13:00 UTC (16:00 EAT) — the hourly dispatcher's slot.",
    );
  });

  it('overdue fires only past slot + grace AND with no tick since the slot began', () => {
    // 14:14:59 — one millisecond inside the grace window: still on-time
    const withinGrace = nextTickExpectation({
      lastTickAt: '2026-10-20T11:58:00.000Z',
      generatedAt: '2026-10-20T14:14:59.999Z',
      secretConfigured: true,
    });
    expect(withinGrace?.state).toBe('on-time');

    // 14:15:00 sharp — the boundary flips to overdue, 0m past grace
    const atBoundary = nextTickExpectation({
      lastTickAt: '2026-10-20T11:58:00.000Z',
      generatedAt: '2026-10-20T14:15:00.000Z',
      secretConfigured: true,
    });
    expect(atBoundary?.state).toBe('overdue');
    expect(atBoundary?.text).toBe(
      'Heartbeat overdue — no tick since 14:00 UTC (17:00 EAT), 0m past the 15-minute grace window.',
    );

    // later in the hole the minutes-past count grows honestly
    const deeper = nextTickExpectation({
      lastTickAt: '2026-10-20T11:58:00.000Z',
      generatedAt: '2026-10-20T14:20:00.000Z',
      secretConfigured: true,
    });
    expect(deeper?.text).toBe(
      'Heartbeat overdue — no tick since 14:00 UTC (17:00 EAT), 5m past the 15-minute grace window.',
    );

    // a tick that landed INSIDE the slot satisfies it — on-time even
    // past grace (the ledger pulse is alive; the source label names
    // which dispatcher it was)
    const satisfied = nextTickExpectation({
      lastTickAt: '2026-10-20T14:06:00.000Z',
      generatedAt: '2026-10-20T14:20:00.000Z',
      secretConfigured: true,
    });
    expect(satisfied?.state).toBe('on-time');
  });

  it('unarmed: the pinger cannot fire, so the line names Vercel\u2019s daily slot and NEVER cries wolf', () => {
    // after today's slot → tomorrow's, with the full formatEatStamp
    const after = nextTickExpectation({
      lastTickAt: '2026-10-18T08:48:00.000Z',
      generatedAt: '2026-10-20T12:20:00.000Z',
      secretConfigured: false,
    });
    expect(after?.state).toBe('unarmed');
    expect(after?.text).toBe(
      "Pinger not armed — the next expected tick is Vercel's daily slot 03:00 UTC (Wed 21 Oct 2026 · 06:00 EAT).",
    );
    // before today's slot → today's slot
    const before = nextTickExpectation({
      lastTickAt: '2026-10-19T23:00:00.000Z',
      generatedAt: '2026-10-20T02:00:00.000Z',
      secretConfigured: false,
    });
    expect(before?.text).toBe(
      "Pinger not armed — the next expected tick is Vercel's daily slot 03:00 UTC (Tue 20 Oct 2026 · 06:00 EAT).",
    );
    // an ANCIENT tick with the gate unarmed stays muted-unarmed — an
    // overdue hour is not an incident when nothing is scheduled to ping
    const ancient = nextTickExpectation({
      lastTickAt: '2026-09-01T00:00:00.000Z',
      generatedAt: '2026-10-20T12:20:00.000Z',
      secretConfigured: false,
    });
    expect(ancient?.state).toBe('unarmed');
  });

  it('tolerance: an absent vercelHourUtc falls to the documented 3; unparseable anchors render nothing', () => {
    const defaulted = nextTickExpectation({
      lastTickAt: '2026-10-18T08:48:00.000Z',
      generatedAt: '2026-10-20T12:20:00.000Z',
      secretConfigured: false,
      // vercelHourUtc absent — an older response
    });
    expect(defaulted?.text).toContain('03:00 UTC');

    const badNow = nextTickExpectation({
      lastTickAt: '2026-10-20T11:58:00.000Z',
      generatedAt: 'not-a-timestamp',
      secretConfigured: true,
    });
    expect(badNow).toBeNull();

    const badTick = nextTickExpectation({
      lastTickAt: '',
      generatedAt: '2026-10-20T12:20:00.000Z',
      secretConfigured: true,
    });
    expect(badTick).toBeNull();
  });

  it('the state classes map to the card\u2019s three voices, solid dot fills included', () => {
    expect(expectationTextClass('on-time')).toBe('text-emerald-700 dark:text-emerald-400');
    expect(expectationTextClass('overdue')).toBe('text-amber-700 dark:text-amber-400');
    expect(expectationTextClass('unarmed')).toBe('text-muted-foreground');
    expect(expectationDotClass('on-time')).toBe('bg-emerald-600');
    expect(expectationDotClass('overdue')).toBe('bg-amber-600');
    expect(expectationDotClass('unarmed')).toBe('bg-slate-400 dark:bg-slate-600');
  });

  it('the grace window stays a named exported constant of 15 minutes', () => {
    expect(TICK_GRACE_MINUTES).toBe(15);
    expect(tickLib).toContain('export const TICK_GRACE_MINUTES = 15;');
  });
});

describe('the wire carries the anchors (API + card)', () => {
  it('the API cadence object exposes vercelHourUtc: 3 beside the readable schedule', () => {
    expect(automationApi).toContain('vercelHourUtc: 3,');
    expect(automationApi).toContain("vercelSchedule: '0 3 * * *',");
    expect(automationApi).toContain("pingerWorkflow: 'cron-hourly.yml',");
    // the dated comment pins the intent: a NUMBER, not a parsed cron string
    expect(automationApi).toContain(
      'the UTC hour of the daily Vercel slot as a NUMBER the',
    );
  });

  it('the read stays read-only', () => {
    const writes = automationApi.match(
      /\.(create|update|delete|upsert|updateMany|deleteMany)\(/g,
    );
    expect(writes).toBeNull();
  });

  it('the interface carries vercelHourUtc as OPTIONAL (older responses tolerated)', () => {
    expect(orgConsole).toContain(
      'cadence: { vercelSchedule: string; pingerWorkflow: string; vercelHourUtc?: number };',
    );
  });

  it('the card feeds the lib the ledger read\u2019s own anchors — never the browser clock', () => {
    expect(orgConsole).toContain('lastTickAt: automation.lastTick.at,');
    expect(orgConsole).toContain('generatedAt: automation.generatedAt,');
    expect(orgConsole).toContain('secretConfigured: automation.secretConfigured,');
    expect(orgConsole).toContain('vercelHourUtc: automation.cadence.vercelHourUtc,');
  });
});

describe('the render contract (the line speaks for itself)', () => {
  it('the expectation line is a role=note with a test id and the full visible sentence', () => {
    expect(orgConsole).toContain('data-testid="automation-expectation"');
    const before = orgConsole.split('data-testid="automation-expectation"')[0].slice(-120);
    expect(before).toContain('role="note"');
    const line = orgConsole
      .split('data-testid="automation-expectation"')[1]
      .split('{expectation.text}')[0];
    // no tooltip, no tab stop: the sentence IS the visible text, so the
    // compressed-pill machinery (title/sr-only/bubble) has nothing to add
    expect(line).not.toContain('title=');
    expect(line).not.toContain('tabIndex');
  });

  it('the state dot is decorative, solid, and never reflows the line', () => {
    expect(orgConsole).toContain('data-testid="automation-expectation-dot"');
    expect(orgConsole).toContain('aria-hidden="true"');
    expect(orgConsole).toContain('inline-block h-1.5 w-1.5 shrink-0 rounded-full');
    expect(orgConsole).toContain(
      'flex items-center gap-1.5 text-xs ${expectationTextClass(expectation.state)}',
    );
  });

  it('both class helpers are wired from the lib import', () => {
    expect(orgConsole).toContain("} from '@/lib/org/tick-expectation';");
    expect(orgConsole).toContain('expectationTextClass(expectation.state)');
    expect(orgConsole).toContain('expectationDotClass(expectation.state)');
  });
});

describe('the docs tell the truth (cron-operations.md)', () => {
  it('the chronology note explains all three states and the grace window', () => {
    expect(cronDoc).toContain('The card expects the tick (v2.172.0)');
    expect(cronDoc).toContain('15-minute grace window');
    expect(cronDoc).toContain('Pinger not armed');
    expect(cronDoc).toContain('never cries wolf');
  });

  it('the cadence field bullet gains vercelHourUtc', () => {
    expect(cronDoc).toContain('`vercelHourUtc`');
    expect(cronDoc).toContain("card's expectation line consumes");
  });

  it('the chronology chain stays unbroken (v2.167 through v2.172 all present)', () => {
    for (const note of [
      'The pill names the heartbeat (v2.169.0)',
      'The refused tick speaks (v2.170.0)',
      'The denial names its gate (v2.171.0)',
      'The card expects the tick (v2.172.0)',
    ]) {
      expect(cronDoc).toContain(note);
    }
  });
});
