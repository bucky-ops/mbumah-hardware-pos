// MBUMAH HARDWARE POS - the pill names the heartbeat (v2.169.0)
//
// The failed-tick sentence dated every red tick but never said WHICH
// heartbeat failed. Since v2.165.0 every ledger row names its dispatcher
// in the row's own TOP-LEVEL metadata.dispatcher — so the API now reads
// that one standardized field (tolerantly: absent/garbage/pre-2.165 rows
// map to null) and exposes a parallel `failedTickDispatchers` array, and
// the card's single-source helper grows a parenthetical per named stamp:
// "Failed ticks: Tue 20 Oct 2026 · 06:48 EAT (hourly) · ...". This is NOT
// the coupling the v2.167.0 assessment declined — that idea rode the
// stamps on the dispatchers' INTERNAL result shapes (`results` /
// `ledgerResults`); this reads the ONE standardized field.
//
// Also on the record this round:
// - The shell-bubble sweep (the v2.168.0 option #1) is ASSESSED, not
//   built: after v2.168's link sweep, the org console's remaining
//   title-only surfaces are either NON-interactive (badges, status chips
//   — not tab stops by design, so focus bubbles do not apply) or
//   REDUNDANT (the "Open branch workspace" links' visible text already
//   carries the full intent). The recipe stays LINK-scoped.
// - The org console's muted-button alpha family is computed per
//   docs/a11y/contrast-math.md and PASSES all four corners (5.73 / 5.53 /
//   5.48 / 5.29 : 1) — reviewed-passing, numbers recorded in the doc.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const orgConsole = repo('src/components/workspace/org-console.tsx');
const automationApi = repo('src/app/api/org/automation/route.ts');
const cronDoc = repo('docs/cron-operations.md');

describe('the API reads the standardized field, tolerantly', () => {
  it('the failed-tick findMany selects the metadata column and stays capped + same-window', () => {
    const findMany = automationApi.split('rawDb.systemLog.findMany({')[1].split('}),')[0];
    expect(findMany).toContain('action: PARTIAL_FAILURE_ACTION');
    expect(findMany).toContain('select: { createdAt: true, metadata: true }');
    expect(findMany).toContain('take: 10');
  });

  it('the parallel dispatcher array is built with the honesty guards', () => {
    const block = automationApi.split('const failedTickDispatchers')[1].split('];')[0];
    expect(block).toContain("if (!r.metadata) return null;");
    expect(block).toContain('JSON.parse(r.metadata)');
    expect(block).toContain("typeof d === 'string' && d.trim().length > 0 ? d : null");
    expect(block).toContain('} catch {');
  });

  it('the dated comment distinguishes the read from the declined coupling', () => {
    expect(automationApi).toContain('v2.169.0: WHICH heartbeat failed, per stamp');
    expect(automationApi).toContain('NOT the coupling the v2.167.0 assessment');
    expect(automationApi).toContain('failedTickDispatchers,');
  });

  it('the read stays read-only', () => {
    const writes = automationApi.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
    expect(writes).toBeNull();
  });
});

describe('the card names the heartbeat, never a guess', () => {
  it('the summary interface gains the parallel optional array', () => {
    expect(orgConsole).toContain('failedTickDispatchers?: (string | null)[];');
  });

  it('the helper keeps the single-source stamps map verbatim (v2.167 pins hold)', () => {
    const helper = orgConsole
      .split('function failedTickTooltip(automation: AutomationSummary)')[1]
      .split('function findDiagnosticFor')[0];
    expect(helper).toContain('.map((s) => formatEatStamp(new Date(s)))');
    expect(helper).toContain('automation.lastTick.failedCount > automation.failedTickStamps.length');
    expect(helper).toContain('more`');
  });

  it('the parenthetical rides only a non-empty parallel entry at the same index', () => {
    const helper = orgConsole
      .split('function failedTickTooltip(automation: AutomationSummary)')[1]
      .split('function findDiagnosticFor')[0];
    expect(helper).toContain('automation.failedTickDispatchers?.[i]');
    expect(helper).toContain("typeof d === 'string' && d.length > 0 ? `${label} (${d})` : label");
  });

  it('every tooltip surface upgrades together - title, tab stop, sr-only, bubble stay single-sourced', () => {
    expect(orgConsole).toContain('title={failedTickTooltip(automation)}');
    expect(orgConsole).toContain('tabIndex={failedTickTooltip(automation) ? 0 : undefined}');
    expect(orgConsole).toContain('<span className="sr-only">{failedTickTooltip(automation)}</span>');
    expect(orgConsole).toContain('data-testid="automation-failed-bubble"');
  });
});

describe('the doc says which heartbeat', () => {
  it('cron-operations.md gains the v2.169.0 note beside the chronology', () => {
    expect(cronDoc).toContain('The pill names the heartbeat (v2.169.0)');
    expect(cronDoc).toContain('failedTickDispatchers');
    expect(cronDoc).toContain('not the coupling the');
    expect(cronDoc).toContain('The hints become visible (v2.168.0)');
  });
});

describe('the muted-button family is computed, not guessed', () => {
  it('the committed script exists and the doc records all four passing ratios', () => {
    const scriptPath = join(process.cwd(), 'scripts/contrast-math-muted-button-v169.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    const doc = repo('docs/a11y/contrast-math.md');
    expect(doc).toContain("the org console's muted-button family (v2.169.0)");
    expect(doc).toContain('5.73:1');
    expect(doc).toContain('5.29:1');
    expect(doc).toContain('reviewed-passing');
  });
});
