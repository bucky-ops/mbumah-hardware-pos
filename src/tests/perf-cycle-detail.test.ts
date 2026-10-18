// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.94.0: the cycle opens up — and calibration takes notes.
 *
 * The carried-x5 sequel that turns a review cycle row into a door:
 *   1. DETAIL — GET /api/hr/performance/cycles/[id] (read permission)
 *      returns the cycle's meta, its OWN reviews (list-item shape; the
 *      spec rule 7 privacy line holds — no ratings in the drawer), the
 *      statusCounts the meter already speaks, and canEditNotes so the UI
 *      never offers a form the service would refuse.
 *   2. NOTES — PATCH with action CALIBRATION_NOTES (manage) writes the
 *      cycle's calibrationNotes: trimmed, 4000-char ceiling, empty clears
 *      to null, audited with FIELD NAMES ONLY. A CLOSED cycle is history
 *      and refuses new ink (CYCLE_FROZEN, 409).
 *   3. THE DRAWER — the cycle's name is the door on the console row; the
 *      drawer shows meter + reviews + notes, cross-links each review into
 *      the gated review dialog (single-drawer rule) and "View in the
 *      Reviews tab" reuses the v2.88 pre-filter walk.
 *
 * File-level contracts (the perf-goal-restore.test.ts pattern); the
 * service rules live alongside stage-g-goals.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — the cycle detail reads scoped and honest', () => {
  const service = readRepo('src/lib/hr/performance-service.ts');

  it('getCycleDetail loads by id + org + deletedAt: null and 404s safely', () => {
    const loader = service.split('async function loadScopedCycle')[1]?.split('\n}')[0] ?? '';
    expect(loader).toContain('deletedAt: null');
    expect(loader).toContain('organizationId: session.organizationId');
    expect(loader).toContain('CYCLE_NOT_FOUND');
    expect(loader).toMatch(/404/);
  });

  it('the drawer never smuggles ratings: reviews keep their list-item shape', () => {
    const body = service.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('listReviews(session, { cycleId: cycle.id })');
    expect(body).toContain('canEditNotes: canManage && cycle.status !==');
    expect(body).toContain('statusCountsFor([cycle.id])');
    // The detail DTO deliberately extends the list CycleDto — no rating
    // fields join it.
    const dto = service.split('export interface CycleDetailDto extends CycleDto')[1]?.split('\n}')[0] ?? '';
    expect(dto).toContain('reviews: ReviewListItemDto[]');
    expect(dto).toContain('canEditNotes: boolean');
    expect(dto).not.toContain('overallRating');
    expect(dto).not.toContain('strengths');
  });

  it('status counts are ONE shared query — the meter cannot drift between table and drawer', () => {
    expect(service).toContain('async function statusCountsFor(cycleIds: string[])');
    // Both readers call the helper (listCycles since v2.88, detail since 2.94).
    const listBody = service.split('export async function listCycles')[1]?.split('\n}')[0] ?? '';
    expect(listBody).toContain('statusCountsFor(cycles.map((c) => c.id))');
    const detailBody = service.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
    expect(detailBody).toContain('statusCountsFor([cycle.id])');
  });
});

describe('service — calibration notes take ink, then freeze', () => {
  const service = readRepo('src/lib/hr/performance-service.ts');

  it('updateCycleCalibration trims, caps at 4000, and clears empty to null', () => {
    const body = service.split('export async function updateCycleCalibration')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('CALIBRATION_NOTES_MAX');
    expect(body).toContain('raw.trim()');
    expect(body).toContain('TEXT_TOO_LONG');
    expect(body).toContain('calibrationNotes: notes.length > 0 ? notes : null');
    expect(service).toContain('export const CALIBRATION_NOTES_MAX = 4000');
  });

  it('a CLOSED cycle refuses new ink — CYCLE_FROZEN 409', () => {
    const body = service.split('export async function updateCycleCalibration')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain("cycle.status === 'CLOSED'");
    expect(body).toContain('CYCLE_FROZEN');
    expect(body).toMatch(/409/);
  });

  it('the write is audited with field names only — the text never enters the audit log', () => {
    const body = service.split('export async function updateCycleCalibration')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain("action: 'PERFORMANCE_CYCLE_CALIBRATION_NOTES'");
    expect(body).toContain('HrEntityType.REVIEW_CYCLE');
    expect(body).toContain("metadata: { fields: ['calibrationNotes'] }");
  });

  it('a non-string payload is refused with NOTHING_TO_UPDATE, never coerced', () => {
    const body = service.split('export async function updateCycleCalibration')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain("typeof raw !== 'string'");
    expect(body).toContain('NOTHING_TO_UPDATE');
  });
});

describe('routes — read opens wider than write, exactly as designed', () => {
  const route = readRepo('src/app/api/hr/performance/cycles/[id]/route.ts');

  it('GET serves the detail behind hr.performance.review', () => {
    expect(route).toContain("hrGuard('hr.performance.review')");
    expect(route).toContain('getCycleDetail(id, session)');
  });

  it('PATCH stays manage-gated and accepts CALIBRATION_NOTES beside ACTIVATE/CLOSE', () => {
    expect(route).toContain("hrGuard('hr.performance.manage')");
    expect(route).toContain("action === 'CALIBRATION_NOTES'");
    expect(route).toContain('updateCycleCalibration(id, body, session)');
    expect(route).toContain('transitionCycle(id, action, session)');
    expect(route).toContain('action must be ACTIVATE, CLOSE or CALIBRATION_NOTES.');
  });

  it('the as-narrow pattern replaces context! — honest and warning-free', () => {
    expect(route).toContain('(context as HrRouteContext).params');
    expect(route).not.toContain('context!');
  });
});

describe('console — the cycle name is the door, the drawer keeps the promises', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('every cycle name opens the detail drawer', () => {
    expect(page).toContain('data-testid={`cycle-open-${c.id}`}');
    expect(page).toContain('openCycleDetail(c.id)');
  });

  it('the drawer fetches honestly: loading skeleton, never a fake empty state', () => {
    expect(page).toContain("useState<CycleDetailDto | 'loading' | null>(null)");
    expect(page).toContain("setCycleDetail('loading')");
    expect(page).toContain('data-testid="cycle-detail-loading"');
    expect(page).toContain('data-testid="cycle-detail-dialog"');
  });

  it('the drawer speaks the meter and lists the cycle reviews', () => {
    const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
    expect(drawer).toContain('data-testid="cycle-detail-meter-text"');
    expect(drawer).toContain('data-testid="cycle-detail-reviews"');
    expect(drawer).toContain('data-testid={`cycle-detail-review-row-${r.id}`}');
    expect(drawer).toContain('data-testid="cycle-detail-no-reviews"');
  });

  it('opening a review hands the conversation over — one drawer at a time', () => {
    const open = page.split('const openCycleReview')[1]?.split('\n  });')[0] ?? '';
    expect(open).toContain('setDetail(d)');
    expect(open).toContain('setCycleDetail(null)');
  });

  it('the v2.88 walk survives: View in the Reviews tab pre-filters and closes the drawer', () => {
    const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
    expect(drawer).toContain('data-testid="cycle-detail-view-reviews"');
    expect(drawer).toContain('viewCycleReviews(cycleDetail.id)');
  });

  it('notes take ink inline: edit, counter, save, cancel, honest empty', () => {
    const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
    expect(drawer).toContain('data-testid="cycle-detail-notes-edit"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-input"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-save"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-cancel"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-counter"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-empty"');
    expect(drawer).toContain('data-testid="cycle-detail-notes-body"');
    expect(drawer).toContain('maxLength={CALIBRATION_NOTES_MAX}');
    expect(drawer).toContain('{notesDraft.length} / {CALIBRATION_NOTES_MAX}');
  });

  it('a frozen cycle says so — closed cycles keep notes readable but fixed', () => {
    const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
    expect(drawer).toContain('data-testid="cycle-detail-frozen"');
    expect(drawer).toContain('no longer take ink');
    expect(drawer).toContain('canEditNotes');
  });

  it('privacy floor holds: the drawer renders no rating fields anywhere', () => {
    const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
    expect(drawer).not.toContain('overallRating');
    expect(drawer).not.toContain('editStrengths');
    expect(drawer).not.toContain('editImprovements');
  });

  it('prior anchors intact — bench, delete confirm, honest doors (2.93 / 2.92 / 2.91)', () => {
    expect(page).toContain('data-testid="goal-deleted-open"');
    expect(page).toContain('data-testid="goal-delete-dialog"');
    expect(page).toContain('data-testid="perf-auth"');
    expect(page).toContain('data-testid="perf-lock"');
  });
});

describe('whats-new — 2.94.0 leads the feed', () => {
  const wn = readRepo('src/lib/whats-new.ts');

  it('the head entry is the cycle drawer', () => {
    expect(wn).toContain("version: '2.94.0'");
    expect(wn).toContain('The cycle opens up');
    const entry = wn.split("version: '2.94.0'")[1]?.split('version:')[0] ?? '';
    expect(entry).toContain('calibration takes notes');
    expect((entry.match(/'/g) ?? []).length).toBeGreaterThan(6);
  });
});
