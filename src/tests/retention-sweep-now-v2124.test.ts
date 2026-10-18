import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.124.0 — "the broom answers the desk".
 *
 * The dry run (v2.123.0) shows what the nightly sweep WOULD anonymise; the
 * settings manager still had to WAIT for the cron to act. This round gives
 * the decision a door:
 *  1. THE ROUTE: POST /api/hr/privacy/retention-sweep — same read guard as
 *     the desk, in-handler DECISION_FORBIDDEN 403 (the erasure / consent /
 *     legal-hold decision pattern verbatim), then runHrRetentionSweep with
 *     actor attribution — the EXACT function the nightly cron runs, so a
 *     manual run can never diverge from the nightly one (holds skip, redacted
 *     rows stay invisible, every batch audits RETENTION_*).
 *  2. THE TWO-STEP: anonymising now is destructive — Sweep now… arms a rose
 *     confirm row that quotes the live backlog ("N rows would be anonymised
 *     immediately") or the honest zero ("Nothing is in scope — held scopes
 *     are skipped, in-window rows are untouched"); Confirm sweep / Cancel;
 *     arming one action disarms the other.
 *  3. THE PURE OUTCOME: describeSweepOutcome (client-safe pure module) turns
 *     the per-scope results into the card's own note — emerald "Sweep ran —
 *     N rows anonymised (applicant records …)." with held scopes named as
 *     skipped, and the ROSE truth when the answer is unreadable (never a
 *     fake success). The desk refetches after, so the dry-run counts drop to
 *     the honest zero.
 *  4. NON-DECIDERS SEE NOTHING NEW: the button only renders for canDecide —
 *     absence of the door must never read as absence of the capability.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

import { describeSweepOutcome } from '@/lib/hr/sweep-outcome';

const RESULTS = [
  { scope: 'hr_applicant_rejection_data', held: false, anonymised: 2 },
  { scope: 'hr_disciplinary_closed', held: false, anonymised: 0 },
  { scope: 'hr_attendance_daily', held: true, anonymised: 0 },
];

describe('describeSweepOutcome — the pure humaniser', () => {
  it('total zero reads as the honest nothing; held scopes are named as skipped', () => {
    const view = describeSweepOutcome(RESULTS.map((r) => ({ ...r, anonymised: 0 })));
    expect(view.ok).toBe(true);
    expect(view.text).toBe('Sweep ran — nothing to anonymise; every scope sits inside its window. Held scopes were skipped (1).');
  });

  it('positive totals name the per-scope parts with shop-floor labels', () => {
    const view = describeSweepOutcome(RESULTS);
    expect(view.ok).toBe(true);
    expect(view.text).toBe('Sweep ran — 2 rows anonymised (2 applicant records). Held scopes were skipped (1).');
  });

  it('singular runs pluralise honestly — 1 row, 1 applicant record', () => {
    const view = describeSweepOutcome([
      { scope: 'hr_applicant_rejection_data', held: false, anonymised: 1 },
      { scope: 'hr_disciplinary_closed', held: false, anonymised: 0 },
      { scope: 'hr_attendance_daily', held: false, anonymised: 0 },
    ]);
    expect(view.text).toBe('Sweep ran — 1 row anonymised (1 applicant record).');
  });

  it('multiple nonzero scopes join the parts; unknown scopes fall back to the raw key', () => {
    const view = describeSweepOutcome([
      { scope: 'hr_applicant_rejection_data', held: false, anonymised: 2 },
      { scope: 'hr_attendance_daily', held: false, anonymised: 5 },
      { scope: 'something_new', held: false, anonymised: 1 },
    ]);
    expect(view.text).toContain('2 applicant records, 5 attendance rows, 1 something_new');
    expect(view.text).not.toContain('skipped');
  });

  it('garbage degrades to the rose truth — never a fake success', () => {
    expect(describeSweepOutcome(null).ok).toBe(false);
    expect(describeSweepOutcome([]).ok).toBe(false);
    expect(describeSweepOutcome('nope').text).toContain('nothing readable');
    expect(describeSweepOutcome([{ scope: 42 }]).text).toContain('cannot read');
  });
});

describe('the route — the manual run rides the cron\u2019s own function', () => {
  const route = src('src/app/api/hr/privacy/retention-sweep/route.ts');

  it('read-guarded like the desk, decision-gated like its siblings', () => {
    expect(route).toContain("hrGuard('hr.report.branch')");
    expect(route).toContain("code: 'DECISION_FORBIDDEN'");
    expect(route).toContain('Only settings managers can run the retention sweep early.');
    expect(route).toContain('canDecideErasure(session.role)');
  });

  it('calls the EXACT nightly function with actor attribution; sweptAt rides the envelope', () => {
    expect(route).toContain('runHrRetentionSweep(session.organizationId, session.userId)');
    expect(route).toContain('sweptAt: new Date().toISOString()');
    expect(route).toContain('toErrorResponse(error)');
  });
});

describe('the sweep stays the single executing truth', () => {
  it('the cron function still honours holds, redaction, and its RETENTION_* audits', () => {
    const lib = src('src/lib/hr/data-protection.ts');
    expect(lib).toContain('export async function runHrRetentionSweep(');
    expect(lib).toContain("action: 'RETENTION_APPLICANTS_ANONYMISED'");
    expect(lib).toContain("action: 'RETENTION_DISCIPLINARY_ANONYMISED'");
    expect(lib).toContain("action: 'RETENTION_ATTENDANCE_ANONYMISED'");
    expect(lib).toContain('where: applicantSweepWhere(now, orgStoreIds)');
  });

  it('the outcome humaniser is a PURE module — no db import rides along', () => {
    const pure = src('src/lib/hr/sweep-outcome.ts');
    expect(pure).not.toContain("@/lib/db");
    expect(pure).toContain('export function describeSweepOutcome(');
  });
});

describe('the Privacy tab card — the door on the desk', () => {
  const page = src('src/app/(shell)/hr/reports/page.tsx');

  it('Sweep now… renders ONLY for deciders and arms a rose confirm row', () => {
    expect(page).toContain('data-testid="hr-retention-sweep-now"');
    expect(page).toContain('Sweep now…');
    expect(page).toContain('data-testid="hr-retention-sweep-arm"');
    expect(page).toContain('Confirm sweep');
    expect(page).toContain('would be anonymised immediately.');
    expect(page).toContain('retention !== null && retention.canDecide');
  });

  it('the honest zero has its own arm-row truth; arming one action disarms the other', () => {
    expect(page).toContain('Nothing is in scope — held scopes are skipped, in-window rows are untouched.');
    expect(page).toContain('setSweepArm(true); setReleaseArm(null); setRetentionNote(null)');
    expect(page).toContain('setReleaseArm(p.scope); setSweepArm(false); setRetentionNote(null)');
  });

  it('the run posts to the new route, reports where the action lives, and refetches the desk', () => {
    expect(page).toContain("apiSend<");
    expect(page).toContain("'/api/hr/privacy/retention-sweep'");
    expect(page).toContain('describeSweepOutcome(res.results)');
    expect(page).toContain('await loadRetention()');
    expect(page).toContain("from '@/lib/hr/sweep-outcome'");
  });

  it('the page still never imports the db-backed service module', () => {
    expect(page).not.toContain("from '@/lib/hr/data-protection'");
    expect(page).toContain('data-testid="hr-retention-note"');
  });
});

describe('prior anchors — the desk stands beside the door', () => {
  it('the dry run, the holds, and the three posture cards all stay', () => {
    const page = src('src/app/(shell)/hr/reports/page.tsx');
    expect(page).toContain('data-testid="hr-retention-preview-col"');
    expect(page).toContain('data-testid="hr-privacy-retention-sweep-count"');
    expect(page).toContain('nothing to sweep tonight — every scope sits inside its window');
    expect(page).toContain('Retention &amp; legal holds (Data Protection Act posture)');
  });
});
