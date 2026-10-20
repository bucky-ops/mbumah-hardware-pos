// MBUMAH HARDWARE POS - every heartbeat writes its ledger (v2.165.0)
//
// The nightly dispatcher gains the session reaper as its fourth sub-job
// (a SECOND daily sweep — the hourly tick is a single daily shot on Vercel
// Hobby, and a frozen 03:00 deployment must not strand expired sessions
// for a day), writes its own CRON_DISPATCH_TICK always-row (until now a
// healthy nightly dispatch left no trace the Automation pulse could read),
// and every ledger row from either dispatcher names its dispatcher so the
// card can say WHICH heartbeat it is reading. The card's "Last tick" line
// gains the exact EAT stamp as its tooltip (the operator diffing two ticks
// never arithmetic's their way back from "3h ago") and the tick source
// label. Docs: the arming section gains the two-read verification.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// lesson 49: strip comments before a not.toContain - prose legitimately
// names what the code must not.
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const nightly = repo('src/app/api/cron/nightly/route.ts');
const hourly = repo('src/app/api/cron/hourly/route.ts');
const automationApi = repo('src/app/api/org/automation/route.ts');
const orgConsole = repo('src/components/workspace/org-console.tsx');
const cronDoc = repo('docs/cron-operations.md');

describe('the nightly dispatcher - the reaper rides both heartbeats', () => {
  it('folds the session reaper as the fourth sub-job', () => {
    expect(nightly).toContain(
      "import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';",
    );
    expect(nightly).toContain("{ name: 'session-reaper', run: () => sessionReaperGET(request) }");
  });

  it('says WHY the fold is safe (idempotent deleteMany, scope rule intact)', () => {
    expect(nightly).toContain('expiresAt only, never lastActiveAt');
    expect(nightly).toContain('idempotent');
  });

  it('promotes the deleted count with the identical ledgerEntry contract', () => {
    expect(nightly).toContain('function ledgerEntry(');
    const fn = nightly.split('function ledgerEntry(')[1].split('async function nightlyCronHandler')[0];
    expect(fn).toContain("typeof deleted === 'number'");
    expect(fn).toContain('Number.isFinite(deleted)');
    expect(fn).toContain('deleted >= 0');
    expect(fn).toContain('...(carryDeleted ? { deleted } : {})');
  });

  it('writes its own CRON_DISPATCH_TICK always-row naming the dispatcher', () => {
    expect(nightly).toContain("action: 'CRON_DISPATCH_TICK'");
    expect(nightly).toContain('severity: LogSeverity.INFO');
    expect(nightly).toContain("metadata: { dispatcher: 'nightly', results: ledgerResults }");
    // the message names its heartbeat too (systemLog readers, not just JSON)
    expect(nightly).toContain('Nightly cron tick recorded:');
  });
});

describe('the hourly dispatcher - the ledger row names its heartbeat', () => {
  it('stamps dispatcher hourly on the tick row (the re-anchor reads it)', () => {
    const tickIdx = hourly.indexOf("action: 'CRON_DISPATCH_TICK'");
    const tickSlice = hourly.slice(tickIdx, tickIdx + 800);
    expect(tickSlice).toContain("metadata: { dispatcher: 'hourly', results: ledgerResults }");
  });

  it('stamps dispatcher hourly on the partial-failure WARN too', () => {
    const warnIdx = hourly.indexOf("action: 'CRON_DISPATCH_PARTIAL_FAILURE'");
    const warnSlice = hourly.slice(warnIdx, warnIdx + 700);
    expect(warnSlice).toContain("metadata: { dispatcher: 'hourly', results: ledgerResults }");
  });

  it('keeps its own reaper fold - nightly adds a sweep, hourly loses none', () => {
    const body = stripComments(hourly);
    expect(body).toContain("{ name: 'session-reaper', run: () => sessionReaperGET(request) }");
  });
});

describe('the automation API - the dispatcher name is read tolerantly', () => {
  it('parses the dispatcher only when an honest non-empty string', () => {
    expect(automationApi).toContain('let tickDispatcher: string | undefined;');
    expect(automationApi).toContain("const rawDispatcher = (parsed as { dispatcher?: unknown }).dispatcher;");
    expect(automationApi).toContain("typeof rawDispatcher === 'string' && rawDispatcher.length > 0");
  });

  it('lastTick carries the dispatcher only when the row named one', () => {
    expect(automationApi).toContain('...(tickDispatcher ? { dispatcher: tickDispatcher } : {}),');
  });

  it('stays read-only (no writes joined the tolerant read)', () => {
    const writes = automationApi.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
  });
});

describe('the card - the tick speaks its exact stamp and its source', () => {
  it('the Last tick line carries the exact EAT stamp as its tooltip', () => {
    expect(orgConsole).toContain("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';");
    expect(orgConsole).toContain('title={`Tick recorded ${formatEatStamp(new Date(automation.lastTick.at))}`}');
  });

  it('the tick source label renders only when the row named a dispatcher', () => {
    expect(orgConsole).toContain('data-testid="automation-tick-source"');
    expect(orgConsole).toContain('· {automation.lastTick.dispatcher} dispatcher');
  });

  it('the interface carries the optional dispatcher honestly', () => {
    const iface = orgConsole.split('interface AutomationSummary {')[1].split('} | null;')[0];
    expect(iface).toContain('dispatcher?: string;');
  });

  it('the new surfaces keep the card contrast discipline (no alpha families)', () => {
    const cardStart = orgConsole.indexOf('data-testid="automation-card"');
    const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));
    expect(card).not.toContain('/50');
    expect(card).not.toMatch(/text-(emerald|red|amber)-600/);
  });
});

describe('the docs - arming is observed, the ledger has two writers', () => {
  it('cron-operations.md gains the two-read arming verification', () => {
    expect(cronDoc).toContain('### Verifying the arming (two reads, five minutes, v2.165.0)');
    expect(cronDoc).toContain('Arming is not done until it is OBSERVED done');
    expect(cronDoc).toContain('"Verify every sub-job came back ok" step is the honest verdict');
    expect(cronDoc).toContain('flip to the emerald "tick gate armed"');
  });

  it('the ledger section names both writers and the dispatcher identity', () => {
    expect(cronDoc).toContain('## The tick ledger (v2.159.0, extended v2.164.0 + v2.165.0)');
    expect(cronDoc).toContain('**v2.165.0**: BOTH dispatchers write the ledger.');
    expect(cronDoc).toContain("dispatcher: 'hourly' |");
  });

  it('the sub-job table says the reaper rides both dispatchers', () => {
    expect(cronDoc).toContain('rides BOTH dispatchers since v2.165.0');
    expect(cronDoc).toContain('the idempotent deleteMany makes the overlap harmless');
  });

  it('the contracts section warns: both-dispatcher folds are idempotent jobs only', () => {
    expect(cronDoc).toContain('fold it into BOTH dispatchers');
    expect(cronDoc).toContain('idempotent jobs only');
  });
});
