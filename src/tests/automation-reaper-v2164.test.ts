// MBUMAH HARDWARE POS - the pulse speaks the reaper (v2.164.0)
//
// The dispatcher's tick ledger now promotes the session-reaper's honest
// deleted count (only when a non-negative finite number), the automation
// API passes it through its tolerant guard, and the org console's
// Automation pulse card speaks it in two places: the reaper chip
// (`· reaped N` / `· clean`) and a sky header pill when positive.
// Docs: cron-operations.md names the sixth sub-job, and
// payroll-run-lifecycle.md gains the spec parity appendix.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const dispatcher = repo('src/app/api/cron/hourly/route.ts');
const automationApi = repo('src/app/api/org/automation/route.ts');
const orgConsole = repo('src/components/workspace/org-console.tsx');
const cronDoc = repo('docs/cron-operations.md');
const lifecycleDoc = repo('docs/payroll-run-lifecycle.md');

describe('the dispatcher - the ledger carries the honest count', () => {
  it('ledgerEntry promotes deleted only when it is a non-negative finite number', () => {
    expect(dispatcher).toContain('function ledgerEntry(');
    const fn = dispatcher.split('function ledgerEntry(')[1].split('async function dispatchAll')[0];
    expect(fn).toContain("typeof deleted === 'number'");
    expect(fn).toContain('Number.isFinite(deleted)');
    expect(fn).toContain('deleted >= 0');
    // spread-omitted when garbage: the key never appears with a fake value
    expect(fn).toContain('...(carryDeleted ? { deleted } : {})');
  });

  it('both ledger rows (WARN and INFO) write the same promoted entries', () => {
    expect(dispatcher).toContain('const ledgerResults = results.map(ledgerEntry);');
    const after = dispatcher.split('const ledgerResults = results.map(ledgerEntry);')[1];
    // v2.165.0 re-anchor: both metadata writes also name the dispatcher
    // ('hourly') — the nightly dispatcher writes the same action from
    // v2.165.0 on, so every ledger row says which heartbeat recorded it.
    const metadataWrites =
      after.match(/metadata: \{ dispatcher: 'hourly', results: ledgerResults \}/g) || [];
    expect(metadataWrites.length).toBe(2);
    // the OLD inline mapping is gone - one shape, one definition
    expect(dispatcher).not.toContain('results.map((r) => ({ name: r.name, ok: r.ok, status: r.status }))');
  });

  it('the docstring says WHY the count rides the ledger', () => {
    expect(dispatcher).toContain('SO THE PULSE CAN SPEAK IT');
    expect(dispatcher).toContain('the ledger never invents a count');
  });
});

describe('the automation API - the tolerant guard passes honest counts', () => {
  it('SubJobResult is optional-deleted and the guard enforces the shape', () => {
    expect(automationApi).toContain('deleted?: number;');
    // The guard destructures once (TS cannot narrow cast-property accesses
    // across a chain; no-non-null-assertion is house lint policy).
    const guard = automationApi.split('const { name, ok, status, deleted } = job;')[1];
    expect(guard).toContain("typeof deleted === 'number'");
    expect(guard).toContain('Number.isFinite(deleted)');
    expect(guard).toContain('deleted >= 0');
    expect(guard).toContain('if (deleted === undefined) return true;');
  });

  it('absent deleted still passes - older ticks stay readable', () => {
    expect(automationApi).toContain('if (deleted === undefined) return true;');
  });
});

describe('the automation card - the chip and the headline pill', () => {
  it('the reaper chip speaks its sweep: reaped N or clean, never a guess', () => {
    expect(orgConsole).toContain("job.name === 'session-reaper' && job.ok && job.deleted !== undefined");
    expect(orgConsole).toContain("· {job.deleted > 0 ? `reaped ${job.deleted}` : 'clean'}");
    // tabular-nums, the same dress the HTTP-status suffix wears
    const chip = orgConsole.split('v2.164.0: the reaper chip speaks its own sweep')[1];
    expect(chip).toContain('tabular-nums');
  });

  it('the header pill wears the count only when it is positive', () => {
    expect(orgConsole).toContain('data-testid="automation-reaped-pill"');
    expect(orgConsole).toContain("(automation.lastTick.subJobs.find((j) => j.name === 'session-reaper')?.deleted ??\n                0) > 0");
    // dark twins on the sky family
    expect(orgConsole).toContain('dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300');
    // honest silence documented: zero reaps render nothing
    expect(orgConsole).toContain('zero reaps or an older tick render NOTHING');
  });

  it('AutomationSubJob carries the optional deleted field', () => {
    const iface = orgConsole.split('interface AutomationSubJob {')[1].split('}')[0];
    expect(iface).toContain('deleted?: number;');
  });
});

describe('the docs - six sub-jobs and the parity appendix', () => {
  it('cron-operations.md names the reaper as the sixth sub-job with its scope rule', () => {
    expect(cronDoc).toContain('## The sub-jobs (six, as of v2.163.0)');
    expect(cronDoc).toContain('| `session-reaper` |');
    expect(cronDoc).toContain('never `lastActiveAt`');
    expect(cronDoc).toContain('extended v2.164.0');
    expect(cronDoc).toContain('promoted by the dispatcher\'s `ledgerEntry`, never invented by');
  });

  it('payroll-run-lifecycle.md carries the spec parity appendix', () => {
    expect(lifecycleDoc).toContain('## Spec parity appendix (v2.164.0)');
    expect(lifecycleDoc).toContain('| 4.6 Payroll run lifecycle');
    expect(lifecycleDoc).toContain('| 4.7 Performance, assets, disciplinary, self-service |');
    expect(lifecycleDoc).toContain('| 4.8 HR workspace, org console integration, reporting, compliance hardening |');
    expect(lifecycleDoc).toContain('v2.18.9');
    expect(lifecycleDoc).toContain('v2.19.0 (Stage G)');
    expect(lifecycleDoc).toContain('v2.20.0 (Stage H)');
    // the parity rule: releases, never intents
    expect(lifecycleDoc).toContain('every row cites a RELEASE that shipped');
  });
});
