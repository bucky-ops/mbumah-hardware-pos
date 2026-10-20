// MBUMAH HARDWARE POS - the denial names its gate (v2.171.0)
//
// v2.170.0 made the refused tick VISIBLE (CRON_TICK_DENIED, the amber
// denied pill) — but the sentence said only THAT the gate refused, not
// WHICH one. The rows already carry metadata.path (v2.170.0 standardized
// it), so this round the refusal feed gets the same shape the failed
// ticks have had since v2.166/v2.169: exact stamps + a parallel gate
// array, a single-source sentence helper with per-gate clauses, the
// "and N more" valve, and a single-gate suffix on the pill itself when
// every listed refusal agrees. Tolerance everywhere: an absent, garbage,
// or unknown path renders the bare sentence, never a guess.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const automationApi = repo('src/app/api/org/automation/route.ts');
const orgConsole = repo('src/components/workspace/org-console.tsx');
const cronDoc = repo('docs/cron-operations.md');
const nightly = repo('src/app/api/cron/nightly/route.ts');
const hourly = repo('src/app/api/cron/hourly/route.ts');

const cardStart = orgConsole.indexOf('data-testid="automation-card"');
const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));

describe('the refusal feed reaches the read (API)', () => {
  it('the denied rows are listed newest-first, capped, with metadata selected', () => {
    expect(automationApi).toContain('deniedCount, deniedRows] = await Promise.all([');
    // the findMany rides the SAME window and cap as the failed-tick feed
    const findMany = automationApi
      .split("where: { action: DENIED_ACTION, createdAt: { gte: since } },\n        orderBy: { createdAt: 'desc' },\n        select: { createdAt: true, metadata: true },\n        take: 10,")[1];
    expect(findMany).toBeDefined();
    expect(automationApi).toContain('const deniedTickStamps = deniedRows.map((r) => r.createdAt.toISOString());');
  });

  it('the path folds to a gate name tolerantly (hourly | nightly | null)', () => {
    expect(automationApi).toContain('const deniedTickGates: (string | null)[] = deniedRows.map');
    expect(automationApi).toContain('if (!r.metadata) return null;');
    expect(automationApi).toContain('JSON.parse(r.metadata)');
    expect(automationApi).toContain("if (path.endsWith('/hourly')) return 'hourly';");
    expect(automationApi).toContain("if (path.endsWith('/nightly')) return 'nightly';");
    expect(automationApi).toContain('return null;');
    expect(automationApi).toContain('} catch {');
  });

  it('both feed arrays are exposed and the read stays read-only', () => {
    expect(automationApi).toContain('deniedTickStamps,');
    expect(automationApi).toContain('deniedTickGates,');
    expect(automationApi).toContain('deniedTicks7d: deniedCount');
    const writes = automationApi.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
    // the v2.170.0 count query survived beside the new feed
    expect(automationApi.match(/where: \{ action: DENIED_ACTION, createdAt: \{ gte: since \} \}/g) || []).toHaveLength(2);
  });
});

describe('the card sentence says which gate (helper)', () => {
  it('the interface carries both feed fields', () => {
    expect(orgConsole).toContain('deniedTickStamps?: string[];');
    expect(orgConsole).toContain('deniedTickGates?: (string | null)[];');
  });

  it('deniedTickTooltip is single-source: base and cause live once, per-gate clause zips counts', () => {
    const helper = orgConsole
      .split('function deniedTickTooltip(automation: AutomationSummary)')[1]
      .split('function deniedGateLabel')[0];
    expect(helper).toContain("'Ticks the tick gate refused while armed — a secret was sent but did not match.'");
    expect(helper).toContain("'The usual cause is a stale CRON_SECRET on one side of the arming walkthrough; the refused tick ran nothing.'");
    expect(orgConsole.split('Ticks the tick gate refused while armed').length - 1).toBe(1);
    expect(orgConsole.split('The usual cause is a stale CRON_SECRET').length - 1).toBe(1);
    // per-gate counts in first-seen order, joined into the details clause
    expect(helper).toContain('counts.set(g, (counts.get(g) ?? 0) + 1);');
    expect(helper).toContain('`${counts.get(g)} at the ${g} gate`');
    expect(helper).toContain(".join(', ')");
    // the most recent refusal's EAT stamp and the and-N-more valve
    expect(helper).toContain('most recent ${formatEatStamp(new Date(stamps[0]))}');
    expect(helper).toContain('` · and ${more} more`');
    // tolerance: a null, an empty string, or a non-string never joins
    expect(helper).toContain("if (typeof g !== 'string' || g.length === 0) continue;");
  });

  it('the pill suffix renders only when every listed refusal agrees and the list is complete', () => {
    const label = orgConsole
      .split('function deniedGateLabel(automation: AutomationSummary)')[1]
      .split('function findDiagnosticFor')[0];
    expect(label).toContain('if (gates.length === 0) return null;');
    // completeness: the count must not outrun the <=10 feed — unseen rows
    // could belong to the other gate, so a capped list never gets a suffix
    expect(label).toContain('(automation.deniedTicks7d ?? 0) > (automation.deniedTickStamps?.length ?? 0)');
    expect(label).toContain('return gates.every((g) => g === first) ? first : null;');
    expect(card).toContain('{deniedGateLabel(automation) && ` · ${deniedGateLabel(automation)}`}');
  });

  it('the three surfaces still ride the helper with the full hint treatment', () => {
    expect(card).toContain('title={deniedTickTooltip(automation)}');
    expect(card).toContain('<span className="sr-only">{deniedTickTooltip(automation)}</span>');
    expect(card).toContain('data-testid="automation-denied-bubble"');
    expect(card).toContain('`${HINT_BUBBLE} normal-case tracking-normal`');
    expect(card).toContain('tabIndex={0}');
    // the amber family is untouched (v2.170.0 contract)
    expect(card).toContain('border-amber-300 bg-amber-50');
    expect(card).toContain('focus-visible:ring-amber-600');
  });
});

describe('the register keeps its chronology (docs)', () => {
  it('cron-operations.md carries the v2.171.0 note, the field bullet and the ledger add-on', () => {
    expect(cronDoc).toContain('The denial names its gate (v2.171.0)');
    expect(cronDoc).toContain('The refused tick speaks (v2.170.0)');
    expect(cronDoc).toContain('`deniedTickStamps` + `deniedTickGates` (v2.171.0)');
    expect(cronDoc).toContain('the `path` field feeds');
    expect(cronDoc).toContain('most recent');
    expect(cronDoc).toContain('never a guess');
  });
});

describe('the v2.170.0 gate contract is untouched', () => {
  it('both gates still discriminate, log before the 403, and carry path-only metadata', () => {
    for (const route of [nightly, hourly]) {
      const start = route.indexOf('if (provided !== secret)');
      const block = route.slice(start, route.indexOf('return null;', start));
      expect(block).toContain('if (provided && provided.length > 0) {');
      expect(block).toContain("action: 'CRON_TICK_DENIED'");
      expect(block).toContain('LogSeverity.WARN');
      expect(block).toContain('.catch(() => {})');
      expect(block).toContain("error: 'Forbidden: invalid or missing x-cron-secret header.'");
    }
    expect(nightly).toContain("metadata: { path: '/api/cron/nightly' }");
    expect(hourly).toContain("metadata: { path: '/api/cron/hourly' }");
  });

  it('the failed-tick helper pins from v2.169.0 survive verbatim beside the new helper', () => {
    const helper = orgConsole
      .split('function failedTickTooltip(automation: AutomationSummary)')[1]
      .split('/* v2.171.0')[0];
    expect(helper).toContain('.map((s) => formatEatStamp(new Date(s)))');
    expect(helper).toContain("typeof d === 'string' && d.length > 0 ? `${label} (${d})` : label");
    expect(helper).toContain('automation.failedTickDispatchers?.[i]');
  });
});
