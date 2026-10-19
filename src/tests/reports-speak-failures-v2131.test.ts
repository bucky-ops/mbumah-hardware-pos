import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.131.0 — "the reports speak their failures".
 *
 * v2.130.0 taught the Privacy tab's three desks to speak; the other eight
 * report loaders still caught into the shared null state — an eternal
 * skeleton with (at best) a generic note ABOVE the tabs and no retry on the
 * tab that actually went dark. This release closes the loop:
 *
 *  1. EVERY REPORT SPEAKS: the six aggregate desks (headcount / cost /
 *     absence / turnover / time-to-hire / statutory — one Promise.all), P10
 *     and leave-utilisation each catch into their own failed flag and render
 *     an honest rose strip with a retry ON THE TAB ITSELF.
 *  2. ONE STRIP FAMILY: the three v2.130.0 privacy strips and the eight new
 *     ones share a single ReportFailureStrip component — same rose frame,
 *     dark twins, warning glyph, in-flight retry spinner.
 *  3. THE REFRESH PATH SPEAKS: the privacy loaders' Refresh/Retry buttons
 *     disable + spin while the fetch is in flight — a slow or dead API can
 *     never read as a dead button.
 *  4. THE HONESTY STAMP: every successfully loaded report says WHEN its
 *     numbers were fetched (Updated HH:MM) — no stamp means not fetched.
 *  5. LOADS LEAVE THE SHARED ERROR ALONE: setError is reserved for actions
 *     (adjust, sweep, hold, drill) — loads speak on their own tab.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const page = () => src('src/app/(shell)/hr/reports/page.tsx');

const AGGREGATE_STRIPS = [
  'hr-reports-headcount-error',
  'hr-reports-cost-error',
  'hr-reports-absence-error',
  'hr-reports-turnover-error',
  'hr-reports-tth-error',
  'hr-reports-statutory-error',
];

describe('v2.131.0 — every report speaks its failures', () => {
  it('the six aggregate desks + P10 + leave carry their own strip doors', () => {
    const s = page();
    for (const id of [...AGGREGATE_STRIPS, 'hr-reports-leave-error', 'hr-reports-p10-error']) {
      expect(s).toContain(`testId="${id}"`);
    }
    // the privacy three keep their v2.130.0 doors, now riding the family
    expect(s).toContain('testId="hr-privacy-consent-error"');
    expect(s).toContain('testId="hr-privacy-erasure-error"');
    expect(s).toContain('testId="hr-privacy-retention-error"');
  });

  it('every failed loader nulls its data before speaking — strip replaces skeleton, never data', () => {
    const s = page();
    // the aggregate catch nulls all six desks together (one Promise.all)
    const loadBody = s.slice(s.indexOf('const load = useCallback'), s.indexOf('const loadP10 = useCallback'));
    for (const nuller of ['setHeadcount(null)', 'setCost(null)', 'setAbsence(null)', 'setTurnover(null)', 'setTth(null)', 'setStatutory(null)']) {
      expect(loadBody).toContain(nuller);
    }
    expect(loadBody).toContain('setAggregateFailed(true)');
    expect(s).toContain('setP10(null)');
    expect(s).toContain('setLeaveUtil(null)');
    expect(s).toContain('setP10Failed(true)');
    expect(s).toContain('setLeaveFailed(true)');
  });

  it('a failed flag clears on success — the strip can recover', () => {
    const s = page();
    expect(s).toContain('setAggregateFailed(false)');
    expect(s).toContain('setP10Failed(false)');
    expect(s).toContain('setLeaveFailed(false)');
  });

  it('strip copy stays in the house voice — dark rather than guess, eleven doors', () => {
    const s = page();
    const copies = s.match(/copy="([^"]+)"/g) ?? [];
    expect(copies.length).toBe(11);
    for (const c of copies) expect(c).toContain('dark rather than guess');
  });

  it('retry labels are named and distinct — eleven of them', () => {
    const s = page();
    const labels = (s.match(/retryLabel="([^"]+)"/g) ?? []).map((l) => l.replace('retryLabel=', ''));
    expect(labels.length).toBe(11);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('the strip family is ONE component — rose frame, dark twins, status role, spinner', () => {
    const s = page();
    const at = s.indexOf('const ReportFailureStrip');
    expect(at).toBeGreaterThan(-1);
    const def = s.slice(at, at + 1200);
    expect(def).toContain('role="status"');
    expect(def).toContain('border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40');
    expect(def).toContain('AlertTriangle');
    expect(def).toContain('animate-spin');
    expect(def).toContain('disabled={busy}');
    // the family is the ONLY rose strip on the surface (the v2.130.0 inline
    // trio joined it — no second frame anywhere)
    expect(s.match(/border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950\/40/g)?.length).toBe(1);
  });

  it('the refresh path speaks — privacy loaders spin their buttons while fetching', () => {
    const s = page();
    expect(s).toContain('disabled={consentBusy}');
    expect(s).toContain('busy={consentBusy}');
    expect(s).toContain('busy={erasureBusy}');
    expect(s).toContain('busy={retentionBusy}');
    // the refresh button swaps its icon for a spinner while in flight
    const btn = s.slice(s.indexOf('Refresh consent records') - 400, s.indexOf('Refresh consent records') + 200);
    expect(btn).toContain('consentBusy ? <Loader2');
  });

  it('P10 and leave retries get their own in-flight state too', () => {
    const s = page();
    expect(s).toContain('busy={p10Busy}');
    expect(s).toContain('busy={leaveBusy}');
    expect(s).toContain('setP10Busy(true)');
    expect(s).toContain('setLeaveBusy(true)');
    expect(s).toContain('setP10Busy(false)');
    expect(s).toContain('setLeaveBusy(false)');
  });

  it('every loaded report leaves an honesty stamp — Updated HH:MM', () => {
    const s = page();
    for (const id of ['headcount', 'cost', 'absence', 'leave', 'turnover', 'tth', 'statutory', 'p10']) {
      expect(s).toContain(`hr-reports-updated-${id}`);
    }
    // the privacy three stamp their headers/counts too
    expect(s).toContain('formatStamp(consentLoadedAt)');
    expect(s).toContain('hr-privacy-updated-erasure');
    expect(s).toContain('hr-privacy-updated-retention');
    // 24-hour clock, tabular digits, muted
    expect(s).toContain("d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })");
  });

  it('loads no longer borrow the shared action error — setError is for actions', () => {
    const s = page();
    const loadBody = s.slice(s.indexOf('const load = useCallback'), s.indexOf('const loadP10 = useCallback'));
    expect(loadBody).not.toContain('setError(');
    const p10Body = s.slice(s.indexOf('const loadP10 = useCallback'), s.indexOf('const loadErasure = useCallback'));
    expect(p10Body).not.toContain('setError(');
    const leaveBody = s.slice(s.indexOf('const loadLeaveUtil = useCallback'), s.indexOf('}, [leaveYear, storeId]);'));
    expect(leaveBody).not.toContain('setError(');
    // the action surfaces keep the shared note
    expect(s.slice(s.indexOf('const run = async'), s.indexOf('const runHold'))).toContain('setError(');
    expect(s.slice(s.indexOf('const openDrill = useCallback'), s.indexOf('const closeDrill'))).toContain('setError(');
  });

  it('the stamp renders only over data — no stamp on a dark desk', () => {
    const s = page();
    // stamps ride the data branch (after the ternary resolves), not the strip
    const head = s.slice(s.indexOf('hr-reports-updated-headcount'), s.indexOf('hr-reports-updated-headcount') + 80);
    expect(head).toContain('at={aggregateLoadedAt}');
    // and the aggregate stamp sits INSIDE the success fragment (after `) : (`)
    const tab = s.slice(s.indexOf('<TabsContent value="headcount"'), s.indexOf('<TabsContent value="cost"'));
    expect(tab.indexOf('hr-reports-updated-headcount')).toBeGreaterThan(tab.indexOf('aggregateFailed ? ('));
  });
});
