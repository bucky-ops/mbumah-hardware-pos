// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.95.0: the drawer takes the wheel — lifecycle rides inside.
 *
 * The natural v2.94 sequel: the cycle detail drawer stopped being a
 * read-only window and now DRIVES the cycle:
 *   1. THE STRIP — Activate (DRAFT) and Close (ACTIVE) live beside the
 *      meter, manage-gated by canManageLifecycle (the same three roles the
 *      PATCH guard serves). Reviewers see none of it.
 *   2. THE GUARD EXPLAINS ITSELF — lifecycleBlock carries the EMPTY_CYCLE
 *      guard's own explanation, derived server-side from the SAME count
 *      the guard runs, so the disabled state can never drift from the 409
 *      the next PATCH would raise. The explanation arrives BEFORE the
 *      attempt, not after.
 *   3. CLOSE ASKS TWICE — a closed cycle cannot reopen (CLOSED: [] in the
 *      transition map), so the drawer arms a two-step confirm; the armed
 *      panel says exactly what closing ends.
 *   4. HONEST ERRORS — lifecycle failures report INSIDE the drawer (the
 *      page-level error note sits behind the modal where nobody reads it),
 *      and a clean transition refetches the drawer's own detail so every
 *      element tells the new truth.
 *
 * File-level contracts (the perf-cycle-detail.test.ts pattern).
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — the lifecycle facts ride with the detail', () => {
  const service = readRepo('src/lib/hr/performance-service.ts');

  it('the detail DTO carries the lifecycle affordance and the guard explanation', () => {
    const dto = service.split('export interface CycleDetailDto extends CycleDto')[1]?.split('\n}')[0] ?? '';
    expect(dto).toContain('canManageLifecycle: boolean');
    expect(dto).toContain('lifecycleBlock: string | null');
    // Privacy floor still holds — lifecycle adds no rating fields.
    expect(dto).not.toContain('overallRating');
    expect(dto).not.toContain('strengths');
  });

  it('lifecycleBlock reads the SAME count the EMPTY_CYCLE guard runs — never the scoped list length', () => {
    const body = service.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain("db.performanceReview.count({ where: { cycleId: cycle.id, deletedAt: null } })");
    // The block derives from DRAFT + zero guard-count, manage-only.
    expect(body).toContain("canManage && cycle.status === 'DRAFT' && guardCount === 0");
    expect(body).toContain('Add at least one review before activating');
    // And the flag mirrors the manage trio exactly.
    expect(body).toContain('canManageLifecycle: canManage');
  });

  it('the transition map still owns legality — CLOSED is terminal, EMPTY_CYCLE keeps its arithmetic', () => {
    const map = service.split('const CYCLE_TRANSITIONS')[1]?.split('};')[0] ?? '';
    expect(map).toContain("DRAFT: ['ACTIVE']");
    expect(map).toContain("ACTIVE: ['CLOSED']");
    expect(map).toContain('CLOSED: []');
    const body = service.split('export async function transitionCycle')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('EMPTY_CYCLE');
    expect(body).toContain('ILLEGAL_TRANSITION');
    expect(body).toMatch(/409/);
  });
});

describe('console — the drawer takes the wheel', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const drawer = page.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';

  it('the lifecycle strip renders inside the drawer, manage-gated', () => {
    expect(drawer).toContain('data-testid="cycle-detail-lifecycle"');
    // The whole strip hides behind the service's own flag — reviewers see none of it.
    expect(drawer).toContain('cycleDetail.canManageLifecycle ?');
    expect(drawer).toContain('data-testid="cycle-detail-activate"');
    expect(drawer).toContain("runCycleLifecycle('ACTIVATE')");
  });

  it('Activate rests while the guard blocks — the reason is inline, before any attempt', () => {
    expect(drawer).toContain('disabled={busy || cycleDetail.lifecycleBlock !== null}');
    expect(drawer).toContain('data-testid="cycle-detail-lifecycle-block"');
    expect(drawer).toContain('data-testid="cycle-detail-lifecycle-hint"');
  });

  it('Close asks twice: arm, confirm, cancel — a closed cycle cannot reopen', () => {
    expect(drawer).toContain('data-testid="cycle-detail-close-arm"');
    expect(drawer).toContain('data-testid="cycle-detail-close-confirm-row"');
    expect(drawer).toContain('data-testid="cycle-detail-close-confirm"');
    expect(drawer).toContain('data-testid="cycle-detail-close-cancel"');
    expect(drawer).toContain("runCycleLifecycle('CLOSE')");
    expect(drawer).toContain('cannot reopen');
    expect(drawer).toContain('setCloseArmed(false)');
  });

  it('a closed cycle wears its history honestly in the strip', () => {
    expect(drawer).toContain('data-testid="cycle-detail-history"');
    expect(drawer).toContain('no longer take ink');
  });

  it('lifecycle errors report INSIDE the drawer, not behind it', () => {
    expect(drawer).toContain('data-testid="cycle-detail-action-error"');
    const runner = page.split('const runCycleLifecycle')[1]?.split('\n  };')[0] ?? '';
    expect(runner).toContain('setCycleActionError');
    expect(runner).toContain(`apiSend(\`/api/hr/performance/cycles/\${cycleDetail.id}\`, 'PATCH', { action })`);
    // A clean transition refetches the drawer's own detail — status, meter,
    // notes and the strip all tell the new truth.
    expect(runner).toContain(`apiGet<CycleDetailDto>(\`/api/hr/performance/cycles/\${cycleDetail.id}\`)`);
    expect(runner).toContain('setCycleDetail(d)');
    expect(runner).toContain('await load()');
  });

  it('arm and error memory reset with the drawer — no stale confirm follows the next cycle', () => {
    const open = page.split('const openCycleDetail')[1]?.split('\n  };')[0] ?? '';
    expect(open).toContain('setCloseArmed(false)');
    expect(open).toContain("setCycleActionError('')");
    const close = page.split('const closeCycleDetail')[1]?.split('\n  };')[0] ?? '';
    expect(close).toContain('setCloseArmed(false)');
    expect(close).toContain("setCycleActionError('')");
  });

  it('privacy floor holds — the strip adds no rating fields anywhere', () => {
    expect(drawer).not.toContain('overallRating');
    expect(drawer).not.toContain('editStrengths');
    expect(drawer).not.toContain('editImprovements');
  });

  it('the table obeys the same rule — lifecycle buttons render manage-only, reviewers see an honest dash', () => {
    const actions = page.split('<TableCell className="space-x-2 text-right">')[1]?.split('</TableCell>')[0] ?? '';
    expect(actions).toContain('canManage ?');
    expect(page).toContain('cycle-row-actions-muted-');
    expect(actions).toContain('never offer what the manage guard would');
  });

  it('prior anchors intact — the v2.94 drawer, v2.93 bench, v2.92 doors', () => {
    expect(page).toContain('data-testid="cycle-detail-notes-edit"');
    expect(page).toContain('data-testid="cycle-detail-view-reviews"');
    expect(page).toContain('data-testid="goal-deleted-open"');
    expect(page).toContain('data-testid="goal-delete-dialog"');
    // The table keeps its own row-level lifecycle buttons.
    expect(page).toContain("apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'ACTIVATE' })");
    expect(page).toContain("apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'CLOSE' })");
  });
});

describe('whats-new — 2.95.0 leads the feed', () => {
  const wn = readRepo('src/lib/whats-new.ts');

  it('the head entry is the lifecycle drawer', () => {
    expect(wn).toContain("version: '2.95.0'");
    expect(wn).toContain('The drawer takes the wheel');
    const entry = wn.split("version: '2.95.0'")[1]?.split('version:')[0] ?? '';
    expect(entry).toContain('lifecycle rides inside');
    expect((entry.match(/'/g) ?? []).length).toBeGreaterThan(6);
  });
});
