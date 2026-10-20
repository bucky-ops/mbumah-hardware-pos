// MBUMAH HARDWARE POS - the chips explain themselves (v2.166.0)
//
// The Automation pulse card's sub-job chips each say what their sub-job
// OWNS (a one-line tooltip — the card-sized echo of cron-operations.md's
// register, with cursor-help as the affordance; an unknown name renders
// bare, never a guess). The failed-tick pill lists the EXACT failed ticks
// in EAT: the API now returns up to 10 stamps behind the 7-day count, and
// the card says "and N more" when the count outruns the cap. Docs: the
// cadence section notes BOTH dispatchers carry sub-jobs.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const orgConsole = repo('src/components/workspace/org-console.tsx');
const automationApi = repo('src/app/api/org/automation/route.ts');
const cronDoc = repo('docs/cron-operations.md');

// every sub-job name BOTH dispatchers can emit (6 hourly + 4 nightly,
// session-reaper shared = 9 unique names)
const ALL_NAMES = [
  'outbox',
  'payments-sweeper',
  'etims-retry',
  'debt-reminders',
  'b2c-recovery',
  'session-reaper',
  'reconciliation',
  'retention',
  'hr-report-digests',
];

describe('the chips say what they own', () => {
  it('AUTOMATION_SUBJOB_HINTS covers every name both dispatchers can emit', () => {
    expect(orgConsole).toContain('const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {');
    const map = orgConsole.split('const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {')[1].split('};')[0];
    // all nine, asserted strictly: each name appears as a map key (quoted or bare)
    const keys = [...map.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
    for (const name of ALL_NAMES) expect(keys).toContain(name);
    expect(keys.length).toBe(ALL_NAMES.length);
  });

  it('the chip renders the hint as its title and wears cursor-help only when hinted', () => {
    expect(orgConsole).toContain('title={AUTOMATION_SUBJOB_HINTS[job.name]}');
    // both color families carry the conditional affordance (the quoted
    // ' cursor-help' literal appears exactly twice — comment prose excluded)
    expect(orgConsole.match(/' cursor-help'/g)?.length).toBe(2);
  });

  it('an unknown name gets NO hint - the card never invents ownership', () => {
    expect(orgConsole).toContain('the card never invents ownership for a sub-job it has');
    // the hint lookup is a plain index access: missing key -> undefined -> no title
    expect(orgConsole).not.toContain('AUTOMATION_SUBJOB_HINTS[job.name] ??');
  });

  it('the register stays the canonical copy (the doc still holds the table)', () => {
    expect(cronDoc).toContain('| `outbox` | outbox_events pump |');
    // v2.167.0 re-anchor (dated): the table grew from six to nine — the
    // nightly-only sub-jobs joined as rows, so the heading renamed; the
    // drift pin for ALL nine keys lives in keyboard-hints-v2167.test.ts.
    expect(cronDoc).toContain('## The sub-jobs (nine, as of v2.167.0)');
  });
});

describe('the failed-tick pill speaks its exact ticks', () => {
  it('the API returns up to 10 stamps behind the 7-day count (same window)', () => {
    expect(automationApi).toContain('rawDb.systemLog.findMany({');
    const findMany = automationApi.split('rawDb.systemLog.findMany({')[1].split('}),')[0];
    expect(findMany).toContain('action: PARTIAL_FAILURE_ACTION');
    expect(findMany).toContain("createdAt: { gte: since }");
    expect(findMany).toContain("orderBy: { createdAt: 'desc' }");
    expect(findMany).toContain('take: 10');
    expect(automationApi).toContain('const failedTickStamps = failedTicks.map((r) => r.createdAt.toISOString());');
    expect(automationApi).toContain('failedTickStamps,');
  });

  it('the read stays read-only', () => {
    const writes = automationApi.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
  });

  it('the card tooltip lists the stamps in EAT and says and-N-more honestly', () => {
    expect(orgConsole).toContain('.map((s) => formatEatStamp(new Date(s)))');
    expect(orgConsole).toContain("automation.lastTick.failedCount > automation.failedTickStamps.length");
    expect(orgConsole).toContain('more`');
    // honest absence: no stamps -> no tooltip (undefined, never a guess)
    expect(orgConsole).toContain(': undefined');
  });

  it('the interface carries the optional stamps field', () => {
    const iface = orgConsole.split('interface AutomationSummary {')[1].split('secretConfigured')[0];
    expect(iface).toContain('failedTickStamps?: string[];');
  });
});

describe('the docs - both dispatchers carry sub-jobs', () => {
  it('the cadence section names the nightly FOUR and the hourly SIX', () => {
    expect(cronDoc).toContain('BOTH dispatchers carry sub-jobs (v2.166.0 note)');
    expect(cronDoc).toContain('the hourly carries SIX');
    expect(cronDoc).toContain('the nightly carries FOUR');
    expect(cronDoc).toContain('(reconciliation, retention, hr-report-digests, session-reaper)');
  });

  it('the heartbeat section documents the chip hints and the pill cap', () => {
    expect(cronDoc).toContain('the sub-job chips carry a one-line "what this sub-job owns"');
    expect(cronDoc).toContain('capped at 10 with an honest "and N more"');
  });
});
