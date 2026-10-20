// MBUMAH HARDWARE POS - the refused tick speaks (v2.170.0)
//
// A tick that sends the WRONG x-cron-secret was invisible everywhere: the
// gate returned 403, no ledger row was written, and the exact moment the
// pinger's secret went stale left the card green with an aging tick and no
// explanation — the one silent failure mode inside the arming walkthrough
// the two-read protocol could only catch on read #1 (the Actions tab).
// This round the gate writes CRON_TICK_DENIED (WARN) for denials that at
// least SENT a non-empty secret, the automation read counts them in the
// same 7-day window as the failed ticks, and the card grows an amber
// "N denied ticks in 7d" pill with the full hint treatment (title, tab
// stop, sr-only copy, visible-on-focus bubble). The recipe literal moves
// into the module-level HINT_BUBBLE constant — three surfaces, one home.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const nightly = repo('src/app/api/cron/nightly/route.ts');
const hourly = repo('src/app/api/cron/hourly/route.ts');
const automationApi = repo('src/app/api/org/automation/route.ts');
const orgConsole = repo('src/components/workspace/org-console.tsx');
const cronDoc = repo('docs/cron-operations.md');

const cardStart = orgConsole.indexOf('data-testid="automation-card"');
const card = orgConsole.slice(cardStart, orgConsole.indexOf('Recent audit events', cardStart));

// the denial block in each gate: from the mismatch check to the function's
// final return null (the fail-open path lives ABOVE it and stays untouched)
function denialBlock(route: string): string {
  const start = route.indexOf('if (provided !== secret)');
  expect(start).toBeGreaterThan(-1);
  return route.slice(start, route.indexOf('return null;', start));
}

const DENIED_BASE =
  'Ticks the tick gate refused while armed — a secret was sent but did not match.';
const DENIED_CAUSE =
  'The usual cause is a stale CRON_SECRET on one side of the arming walkthrough; the refused tick ran nothing.';

describe('the gate writes its own row (dispatchers)', () => {
  it('both gates record CRON_TICK_DENIED before refusing, guarded by the sent-a-secret discriminator', () => {
    for (const route of [nightly, hourly]) {
      const block = denialBlock(route);
      // the discriminator: ONLY denials that at least SENT a non-empty
      // secret reach the ledger — anonymous scanners and the Vercel-managed
      // scheduler send nothing, so they never write a row and an
      // unauthenticated caller cannot spam the ledger
      expect(block).toContain('if (provided && provided.length > 0) {');
      // the row lands BEFORE the 403 (write-then-refuse, one await apart)
      expect(block.indexOf('CRON_TICK_DENIED')).toBeGreaterThan(-1);
      expect(block.indexOf('CRON_TICK_DENIED')).toBeLessThan(block.indexOf("status: 403"));
      expect(block).toContain("action: 'CRON_TICK_DENIED'");
      expect(block).toContain('LogSeverity.WARN');
      expect(block).toContain('did not match - refused with 403');
      // the refusal stays deterministic even if the ledger write fails
      expect(block).toContain('.catch(() => {})');
    }
  });

  it('no secret material rides the row - the path names the dispatcher, nothing else', () => {
    expect(denialBlock(nightly)).toContain("metadata: { path: '/api/cron/nightly' }");
    expect(denialBlock(hourly)).toContain("metadata: { path: '/api/cron/hourly' }");
    // scoped to the systemLog CALL (the surrounding prose is allowed to
    // discuss the discriminator): neither the secret, nor its length, nor
    // the provided value is logged
    for (const route of [nightly, hourly]) {
      const block = denialBlock(route);
      const logCall = block.slice(block.indexOf('await systemLog'), block.indexOf('}).catch'));
      expect(logCall).toContain('metadata: { path:');
      expect(logCall).not.toContain('provided');
      expect(logCall).not.toMatch(/providedLength|secret:/);
    }
  });

  it('the 403 body is byte-identical to the pre-v2.170 contract', () => {
    const body =
      "error: 'Forbidden: invalid or missing x-cron-secret header.'";
    for (const route of [nightly, hourly]) {
      const block = denialBlock(route);
      expect(block).toContain(body);
      expect(block).toContain('{ status: 403 }');
    }
  });

  it('the fail-open path above the refusal is untouched (CRON_SECRET_UNSET WARN in both gates)', () => {
    for (const route of [nightly, hourly]) {
      expect(route).toContain("action: 'CRON_SECRET_UNSET'");
      expect(route).toContain('accepted an unauthenticated request');
    }
  });
});

describe('the automation read counts the refusals (API)', () => {
  it('the denial count joins the same 7-day window and the response exposes it', () => {
    expect(automationApi).toContain("const DENIED_ACTION = 'CRON_TICK_DENIED';");
    // v2.171.0 re-anchor: the denial-row feed joined the parallel read, so
    // the destructure now ends `deniedCount, deniedRows]` — the count is
    // still the same query in the same window
    expect(automationApi).toContain('deniedCount, deniedRows] = await Promise.all([');
    expect(automationApi).toContain('where: { action: DENIED_ACTION, createdAt: { gte: since } }');
    expect(automationApi).toContain('deniedTicks7d: deniedCount');
  });

  it('the read stays read-only and the failed-tick contract is untouched', () => {
    expect(automationApi).toContain('runWithoutTenant');
    expect(automationApi).not.toMatch(/\.create\(|\.update\(|\.deleteMany\(|\.updateMany\(|\.upsert\(/);
    // v2.169.0 pins survive verbatim
    expect(automationApi).toContain('failedTickDispatchers,');
    expect(automationApi).toContain('failedTickStamps,');
  });
});

describe('the card grows the amber denied pill', () => {
  it('the interface carries the optional count and the guard reads it tolerantly', () => {
    expect(orgConsole).toContain('deniedTicks7d?: number;');
    // absence (older responses) and zero are equally silent — never a guess
    expect(card).toContain('(automation.deniedTicks7d ?? 0) > 0');
  });

  it('the pill wears the amber family with the full focus treatment', () => {
    expect(card).toContain('data-testid="automation-denied-pill"');
    expect(card).toContain('border-amber-300 bg-amber-50');
    expect(card).toContain('text-amber-700');
    expect(card).toContain('focus-visible:ring-amber-600');
    expect(card).toContain('denied tick');
    expect(card).toContain('in 7d');
    // a real tab stop while the pill exists (it only exists when there is
    // something to say, so the ternary is unnecessary — plain 0)
    expect(card).toContain('tabIndex={0}');
  });

  it('the sentence is one truth on three surfaces via the helper, in order (title, sr-only, bubble)', () => {
    // v2.171.0 re-anchor: the sentence moved into the single-source
    // deniedTickTooltip helper (per-gate clauses joined it), so the static
    // base and cause live ONCE in the helper and the three surfaces read
    // the helper call instead of repeating the string.
    expect(orgConsole.split(DENIED_BASE).length - 1).toBe(1);
    expect(orgConsole.split(DENIED_CAUSE).length - 1).toBe(1);
    expect(card).toContain('data-testid="automation-denied-bubble"');
    const helperUses = (orgConsole.match(/deniedTickTooltip\(automation\)/g) || []).length;
    expect(helperUses).toBeGreaterThanOrEqual(3); // title + sr-only + bubble
    // order within the pill: title attribute, sr-only line, visible bubble
    const pillStart = orgConsole.indexOf('data-testid="automation-denied-pill"');
    const slice = orgConsole.slice(pillStart, orgConsole.indexOf('v2.164.0: the reaper', pillStart));
    const titleAt = slice.indexOf('title={deniedTickTooltip(automation)}');
    const srAt = slice.indexOf('<span className="sr-only">{deniedTickTooltip(automation)}</span>');
    const bubbleAt = slice.indexOf('data-testid="automation-denied-bubble"');
    expect(titleAt).toBeGreaterThan(-1);
    expect(srAt).toBeGreaterThan(titleAt);
    expect(bubbleAt).toBeGreaterThan(srAt);
    expect(slice.indexOf('aria-hidden="true"', srAt)).toBeLessThan(bubbleAt);
  });

  it('the denied bubble rides the shared HINT_BUBBLE constant with the pill override', () => {
    expect(card).toContain('`${HINT_BUBBLE} normal-case tracking-normal`');
    // the constant exists exactly once, at module level, holding the recipe
    expect(orgConsole.match(/const HINT_BUBBLE =/g) || []).toHaveLength(1);
    expect(orgConsole).toContain(
      "'pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-focus-visible:block'",
    );
    // three surfaces reference it: the chip bare, the pill and the denied
    // pill with the normal-case override
    expect(orgConsole.match(/className=\{HINT_BUBBLE\}/g) || []).toHaveLength(1);
    expect(orgConsole.match(/\$\{HINT_BUBBLE\} normal-case tracking-normal/g) || []).toHaveLength(2);
  });
});

describe('the register keeps its chronology (docs)', () => {
  it('cron-operations.md carries the v2.170.0 note, the ledger bullet and the two-read sync', () => {
    expect(cronDoc).toContain('The refused tick speaks (v2.170.0)');
    expect(cronDoc).toContain('The pill names the heartbeat (v2.169.0)');
    expect(cronDoc).toContain('The hints become visible (v2.168.0)');
    expect(cronDoc).toContain('`deniedTicks7d` (v2.170.0)');
    expect(cronDoc).toContain('never secret material');
    expect(cronDoc).toContain('If the two secrets DISAGREE, the card says so since v2.170.0');
    expect(cronDoc).toContain('stale-secret signature');
  });
});
