// MBUMAH HARDWARE POS - the hints reach the keyboard (v2.167.0)
//
// v2.166.0 gave every sub-job chip an ownership sentence and the failed-tick
// pill the exact EAT stamps — but native `title` tooltips are MOUSE-ONLY.
// This round the hints stop being hover-exclusive: hinted chips are
// focusable (tab stop + family-colored focus ring) and every hint AND exact
// stamp also rides an sr-only line, so screen readers and keyboard users
// get the same copy the mouse got. The register (cron-operations.md's
// sub-job table) grows from six rows to nine — the nightly-only sub-jobs
// had only lived in the cadence prose — and a drift pin now asserts every
// AUTOMATION_SUBJOB_HINTS key has a row there (Option #1 closed, both
// directions). The v2.166.0 "stamps via ledger metadata" idea is assessed
// ON THE RECORD in the API and deliberately NOT built (Option #3).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const orgConsole = repo('src/components/workspace/org-console.tsx');
const automationApi = repo('src/app/api/org/automation/route.ts');
const cronDoc = repo('docs/cron-operations.md');

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

const cardStart = orgConsole.indexOf('data-testid="automation-card"');
const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));

describe('the hints reach the keyboard', () => {
  it('hinted chips are focusable; unhinted names never become dead tab stops', () => {
    expect(orgConsole).toContain(
      'tabIndex={AUTOMATION_SUBJOB_HINTS[job.name] ? 0 : undefined}',
    );
  });

  it('focusable chips wear a family-colored focus ring as the affordance', () => {
    // full-opacity families only — the card's contrast discipline extends
    // to focus (emerald-600 for ok, red-600 for a failure), never alpha
    expect(card).toContain('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1');
    expect(card).toContain('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1');
    expect(card).not.toContain('ring-emerald-300 focus-visible');
    expect(card).not.toContain('/50');
  });

  it('the ownership line rides an sr-only copy inside the chip, only when hinted', () => {
    expect(orgConsole).toContain(
      '<span className="sr-only"> — {AUTOMATION_SUBJOB_HINTS[job.name]}</span>',
    );
    // the sr-only copy is guarded by the SAME lookup as the title — an
    // unhinted chip stays silent (never a guess)
    const guard = orgConsole.indexOf('{AUTOMATION_SUBJOB_HINTS[job.name] && (', orgConsole.indexOf('v2.167.0: the ownership line'));
    expect(guard).toBeGreaterThan(-1);
  });

  it('the failed-tick sentence is computed ONCE and rides both surfaces', () => {
    // single source of truth: the sentence literal lives only in the helper
    expect(orgConsole.match(/Failed ticks: /g)?.length).toBe(1);
    expect(orgConsole).toContain('title={failedTickTooltip(automation)}');
    expect(orgConsole).toContain(
      '<span className="sr-only">{failedTickTooltip(automation)}</span>',
    );
  });

  it('the helper keeps the v2.166.0 honesty contract (undefined when stamps are absent)', () => {
    const helper = orgConsole
      .split('function failedTickTooltip(automation: AutomationSummary)')[1]
      .split('function findDiagnosticFor')[0];
    expect(helper).toContain(
      'if (!automation.failedTickStamps || automation.failedTickStamps.length === 0)',
    );
    expect(helper).toContain('.map((s) => formatEatStamp(new Date(s)))');
    expect(helper).toContain(
      'automation.lastTick.failedCount > automation.failedTickStamps.length',
    );
    expect(helper).toContain('more`');
  });

  it('the pill is focusable only while it has an exact-tick sentence to say', () => {
    expect(orgConsole).toContain('tabIndex={failedTickTooltip(automation) ? 0 : undefined}');
  });

  it('the last-tick exact stamp rides the screen-reader line too', () => {
    expect(orgConsole).toContain(
      '(recorded {formatEatStamp(new Date(automation.lastTick.at))})',
    );
  });

  it('the card carries exactly four sr-only copies (chip + pill + last tick + denied pill)', () => {
    // v2.170.0 re-anchor: the amber denied pill brings the fourth sr-only
    // copy (its own sentence rides the same one-truth rule) — the count
    // was 3 (chip + pill + last tick) since v2.167.0.
    expect(card.match(/className="sr-only"/g)?.length).toBe(4);
  });
});

describe('the register closes over all nine', () => {
  it('every AUTOMATION_SUBJOB_HINTS key has a row in the doc sub-job table (drift pin, both directions)', () => {
    const map = orgConsole
      .split('const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {')[1]
      .split('};')[0];
    const keys = [...map.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
    expect(keys.length).toBe(ALL_NAMES.length);
    for (const name of keys) {
      expect(cronDoc).toContain(`| \`${name}\` |`);
    }
  });

  it('the table heading names nine (v2.167.0) and the nightly rows say they are nightly-only', () => {
    expect(cronDoc).toContain('## The sub-jobs (nine, as of v2.167.0)');
    expect(cronDoc).toContain('| `reconciliation` | the nightly financial summaries rebuild |');
    expect(cronDoc).toContain('| `retention` | the expired-record purge |');
    expect(cronDoc).toContain('| `hr-report-digests` | the scheduled HR report digests |');
  });

  it('the heartbeat section documents keyboard reachability', () => {
    expect(cronDoc).toContain('The hints reach the keyboard (v2.167.0)');
    expect(cronDoc).toContain('no longer\n  mouse-only');
    expect(cronDoc).toContain('never a dead tab stop');
  });
});

describe('the assessment is on the record (stamps via metadata: assessed, not built)', () => {
  it('the API carries the dated assessment and keeps the format-agnostic findMany', () => {
    expect(automationApi).toContain('v2.167.0 assessment (built nowhere, kept here)');
    expect(automationApi).toContain('hourly rows carry');
    expect(automationApi).toContain('The separate findMany stays: format-agnostic, same window,');
    const findMany = automationApi.split('rawDb.systemLog.findMany({')[1].split('}),')[0];
    expect(findMany).toContain('action: PARTIAL_FAILURE_ACTION');
    expect(findMany).toContain('take: 10');
  });

  it('the read stays read-only', () => {
    const writes = automationApi.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
  });
});
