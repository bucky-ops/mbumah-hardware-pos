import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.159.0 — the dispatcher keeps its hours.
 *
 * The v2.158.0 proxy pass-through made the production cron reachable, but
 * Vercel Hobby still fires the dispatcher DAILY ("0 3 * * *" in vercel.json)
 * while every sub-job was designed HOURLY — the B2C backoff windows
 * (2m-30m) are meaningless at one tick a day. Three moves close that gap:
 *
 *  1. The cron-hourly GitHub Actions workflow pings the production
 *     dispatcher every hour with the CRON_SECRET (repo secret) and turns
 *     red on any non-200, non-success payload, or failed sub-job —
 *     honest, visible failure in the Actions tab.
 *  2. The dispatcher writes a CRON_DISPATCH_TICK INFO ledger row on EVERY
 *     completed dispatch (the partial-failure WARN only ever fired on
 *     bad days — a healthy tick left no trace, so no reader could tell
 *     "all green" from "never ran").
 *  3. The org console grows the Automation pulse card: the last tick from
 *     the ledger, the per-sub-job chips, the 7-day failed-tick count, the
 *     honest CRON_SECRET posture, and the cadence truth line.
 *
 * STYLE: the POS dashboard-stats trend affordance (the /50 "→" at 9px)
 * drops its alpha (real-text contrast: full muted-foreground on white
 * ≈ 5.76:1) and is honest aria-hidden decoration; the 9px trend percentage
 * moves red-600 → red-700 (knife-edge 4.53:1 → 5.9:1).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const workflow = readRepo('.github/workflows/cron-hourly.yml');
const hourlyRoute = readRepo('src/app/api/cron/hourly/route.ts');
const automationRoute = readRepo('src/app/api/org/automation/route.ts');
const orgConsole = readRepo('src/components/workspace/org-console.tsx');
const dashboardStats = readRepo('src/components/pos/dashboard-stats.tsx');
const vercelJson = readRepo('vercel.json');

describe('the cron-hourly workflow pings production every hour', () => {
  it('is scheduled hourly AND manually triggerable', () => {
    expect(workflow).toContain('cron: "0 * * * *"');
    expect(workflow).toContain('workflow_dispatch');
  });

  it('sends the CRON_SECRET as x-cron-secret (the dispatcher gate header)', () => {
    expect(workflow).toContain('x-cron-secret: ${CRON_SECRET}');
    expect(workflow).toContain('secrets.CRON_SECRET');
  });

  it('fails honestly: non-200, unanswered ping, and failed sub-jobs all exit 1', () => {
    expect(workflow).toContain('exit 1');
    expect(workflow).toContain('body.success !== true');
    const nodeStep = workflow.split('Verify every sub-job came back ok')[1] || '';
    expect(nodeStep).toContain('!r.ok');
  });

  it('documents the setup contract (Vercel env + GitHub secret + PROD_URL default)', () => {
    expect(workflow).toContain('secrets.PROD_URL');
    expect(workflow).toContain('https://mbumah-hardware-pos-one.vercel.app');
    expect(workflow).toContain('set CRON_SECRET');
  });
});

describe('the dispatcher writes a ledger row on every tick', () => {
  it('emits CRON_DISPATCH_TICK INFO with the full sub-job results', () => {
    expect(hourlyRoute).toContain("action: 'CRON_DISPATCH_TICK'");
    expect(hourlyRoute).toContain('severity: LogSeverity.INFO');
    const tickBlock = hourlyRoute.split("action: 'CRON_DISPATCH_TICK'")[0];
    expect(tickBlock).toContain('the tick LEDGER');
  });

  it('the ledger carries the same results the response body carries', () => {
    const tickIdx = hourlyRoute.indexOf("action: 'CRON_DISPATCH_TICK'");
    const tickSlice = hourlyRoute.slice(tickIdx, tickIdx + 800);
    // v2.164.0 re-anchor: the ledger writes the PROMOTED entries (the
    // dispatcher's ledgerEntry — name/ok/status, plus the session-reaper's
    // honest deleted count when the body carried one) instead of the old
    // inline name/ok/status mapping.
    expect(tickSlice).toContain('metadata: { results: ledgerResults }');
  });

  it('keeps the partial-failure WARN for severity filtering', () => {
    expect(hourlyRoute).toContain("action: 'CRON_DISPATCH_PARTIAL_FAILURE'");
    expect(hourlyRoute).toContain('LogSeverity.WARN');
  });

  it('vercel.json still holds the daily schedule (the truth the cadence line tells)', () => {
    expect(vercelJson).toContain('"0 3 * * *"');
  });
});

describe('GET /api/org/automation — the ledger read', () => {
  it('guards with the org-roles contract (parity with /api/org/summary)', () => {
    expect(automationRoute).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];");
    expect(automationRoute).toContain('requireAuth(orgAutomationHandler, { roles: ORG_ROLES })');
  });

  it('is read-only over the org-wide client (no tenant narrowing, no writes)', () => {
    expect(automationRoute).toContain('runWithoutTenant');
    expect(automationRoute).toContain('rawDb.systemLog.findFirst');
    expect(automationRoute).toContain('orderBy: { createdAt: \'desc\' }');
    const writes = automationRoute.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
  });

  it('counts the 7-day partial-failure tail', () => {
    expect(automationRoute).toContain('CRON_DISPATCH_PARTIAL_FAILURE');
    expect(automationRoute).toContain('7 * 24 * 60 * 60 * 1000');
  });

  it('parses the ledger metadata tolerantly — garbage yields empty chips, never a throw', () => {
    const parseSlice = automationRoute.slice(
      automationRoute.indexOf('JSON.parse'),
      automationRoute.indexOf('secretConfigured'),
    );
    expect(parseSlice).toContain('catch');
    expect(parseSlice).toContain('subJobs = []');
  });

  it('reports the honest tick-gate posture from the server env', () => {
    expect(automationRoute).toContain('Boolean(process.env.CRON_SECRET)');
  });
});

describe('the org console Automation pulse card', () => {
  it('fetches the ledger read on the same auth lifecycle as the summary', () => {
    expect(orgConsole).toContain("authorizedFetchJson('/api/org/automation')");
    expect(orgConsole).toContain('[isAuthenticated, automationReload]');
  });

  it('renders every honest state: loading, empty, error+retry, and the live pulse', () => {
    for (const tid of [
      'automation-card',
      'automation-secret-posture',
      'automation-retry',
      'automation-error',
      'automation-empty',
      'automation-last-tick',
      'automation-failed-count',
      'automation-subjob-list',
      'automation-subjob-chip',
      'automation-cadence-line',
    ]) {
      expect(orgConsole).toContain(`data-testid="${tid}"`);
    }
    expect(orgConsole).toContain('No dispatch has been recorded yet');
    expect(orgConsole).toContain('this is a read failure, not a dispatch failure');
  });

  it('the card is a named region; the unknown tick renders nothing (never a guess)', () => {
    expect(orgConsole).toContain('aria-label="Automation pulse"');
    expect(orgConsole).toContain('role="region"');
    expect(orgConsole).toContain('the chips stay empty until a parseable tick lands');
  });

  it('the cadence truth line names both schedulers', () => {
    expect(orgConsole).toContain('automation.cadence.vercelSchedule');
    expect(orgConsole).toContain('automation.cadence.pingerWorkflow');
    expect(orgConsole).toContain('designed hourly cadence when armed');
  });

  it('contrast families: emerald-700/red-700/amber-700 text on -50 tints, never bare -600', () => {
    const cardStart = orgConsole.indexOf('data-testid="automation-card"');
    const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));
    expect(card).toContain('text-emerald-700');
    expect(card).toContain('text-red-700');
    expect(card).toContain('text-amber-700');
    expect(card).not.toMatch(/text-(emerald|red|amber)-600/);
    expect(card).not.toContain('/50');
  });
});

describe('the POS dashboard trend affordance reads at 9px', () => {
  it('the click affordance arrow drops its /50 alpha and admits it is decoration', () => {
    expect(dashboardStats).toContain('text-[9px] text-muted-foreground" aria-hidden="true"');
    expect(dashboardStats).not.toContain('text-muted-foreground/50">→');
  });

  it('the 9px trend percentage clears the bar: red-700, dark pair kept', () => {
    expect(dashboardStats).toContain("'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'");
    expect(dashboardStats).not.toContain('text-red-600 dark:text-red-400');
  });
});
