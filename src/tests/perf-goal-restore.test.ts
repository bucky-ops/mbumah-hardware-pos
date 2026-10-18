// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.93.0: the bench remembers — deleted goals come home.
 *
 * The v2.92 sequel that completes the goals CRUD loop. A soft-deleted
 * goal used to be unreachable from every surface (honest, but a one-way
 * door). Now:
 *   1. THE BENCH — GET /api/hr/goals/deleted lists soft-deleted goals in
 *      scope, newest deletion first, each stamped with deletedAt and the
 *      progress it kept. Manage-guarded like the delete itself.
 *   2. RESTORE — POST /api/hr/goals/[id]/restore clears deletedAt: the
 *      goal rejoins every list with the values it left with, audited as
 *      GOAL_RESTORED (who, which goal, what shape). The service refuses
 *      goals that were never deleted (GOAL_NOT_DELETED, 409) and a
 *      separate loader keeps loadGoal's deletedAt: null contract (and the
 *      v2.92 tests anchoring it) untouched.
 *   3. THE CONSOLE DOOR — the Goals tab grows a "Recently deleted"
 *      affordance with a live count; the bench dialog speaks the same
 *      honesty as the delete confirm (nothing hard-deleted, records and
 *      audits stay) and an empty bench says so plainly.
 *
 * File-level contracts (the perf-goal-delete.test.ts pattern); the
 * service rules live in stage-g-goals.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — restore is an honest undo, audited', () => {
  const service = readRepo('src/lib/hr/goal-service.ts');

  it('restoreGoal clears deletedAt (never hard-deletes) and audits GOAL_RESTORED', () => {
    const body = service.split('export async function restoreGoal')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('loadGoalIncludingDeleted(goalId, session)');
    expect(body).toContain('GOAL_NOT_DELETED');
    expect(body).toContain('deletedAt: null');
    expect(body).toContain("action: 'GOAL_RESTORED'");
    expect(body).toContain('title: goal.title');
    expect(body).toContain('metricSource: goal.metricSource');
    expect(body).not.toMatch(/\.delete\(/);
  });

  it('a goal that was never deleted is refused with 409 — restore only undoes removals', () => {
    const body = service.split('export async function restoreGoal')[1]?.split('\n}')[0] ?? '';
    expect(body).toMatch(/goal\.deletedAt === null/);
    expect(body).toContain('This goal is not deleted');
    expect(body).toMatch(/409/);
  });

  it('the restore loader reads past the soft delete but stays scope-aware', () => {
    const loader = service.split('async function loadGoalIncludingDeleted')[1]?.split('\n}')[0] ?? '';
    expect(loader).not.toContain('deletedAt: null');
    expect(loader).toContain('employeeInScope(goal.employee, session)');
    expect(loader).toContain('GOAL_NOT_FOUND');
    // loadGoal keeps its v2.92 contract untouched — live reads never see rows
    const loadGoal = service.split('async function loadGoal(')[1]?.split('\n}')[0] ?? '';
    expect(loadGoal).toContain('deletedAt: null');
  });

  it('the bench lists soft-deleted goals, newest first, with an honest deletedAt stamp', () => {
    const body = service.split('export async function listDeletedGoals')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('deletedAt: { not: null }');
    expect(body).toContain("orderBy: { deletedAt: 'desc' }");
    expect(body).toContain('employeeScopeWhere(session)');
    expect(body).toContain('take: 50');
    expect(body).toContain('deletedAt: g.deletedAt.toISOString()');
    expect(body).not.toMatch(/deletedAt!|\bas Date\b/);
  });

  it('DeletedGoalDto extends the board DTO with the stamp — one shape, no drift', () => {
    const dto = service.split('export interface DeletedGoalDto extends GoalDto')[1]?.split('}')[0] ?? '';
    expect(dto).toMatch(/deletedAt: string/);
  });
});

describe('routes — the bench is manage-gated like the delete', () => {
  it('GET /api/hr/goals/deleted is manage-guarded and calls the service', () => {
    const route = readRepo('src/app/api/hr/goals/deleted/route.ts');
    expect(route).toMatch(/export const GET = hrGuard\('hr\.performance\.manage'\)/);
    expect(route).toContain('listDeletedGoals(session)');
    expect(route).toContain("import { listDeletedGoals } from '@/lib/hr/goal-service'");
  });

  it('POST /api/hr/goals/[id]/restore is manage-guarded with the as-narrow pattern', () => {
    const route = readRepo('src/app/api/hr/goals/[id]/restore/route.ts');
    expect(route).toMatch(/export const POST = hrGuard\('hr\.performance\.manage'\)/);
    expect(route).toContain('restoreGoal(id, session)');
    expect(route).toContain('(context as HrRouteContext).params');
    expect(route).not.toMatch(/context!/);
  });
});

describe('console — the bench door and the restore rows', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('a manage-gated "Recently deleted" affordance carries the live count', () => {
    expect(page).toMatch(/data-testid="goal-deleted-open"/);
    expect(page).toMatch(/data-testid="goal-deleted-count"/);
    expect(page).toContain('Recently deleted');
    expect(page).toContain('openDeletedBench');
    // the door sits inside a canManage block, beside the other manage actions
    expect(page).toMatch(/canManage \? \(\s*<Button\s+size="sm"\s+variant="outline"\s+data-testid="goal-deleted-open"/);
  });

  it('the bench refetches fresh on open — the count never lies', () => {
    const fn = page.split('const openDeletedBench')[1]?.split('\n  };')[0] ?? '';
    expect(fn).toContain("apiGet<DeletedGoalDto[]>('/api/hr/goals/deleted')");
    expect(fn).toContain('setDeletedGoals(null)');
    // and the page load rides the bench along (reviewers 403 into an empty bench)
    expect(page).toMatch(/apiGet<DeletedGoalDto\[\]>\('\/api\/hr\/goals\/deleted'\)\.catch\(\(\) => \[\] as DeletedGoalDto\[\]\)/);
  });

  it('the dialog speaks the delete\u2019s honesty and lists restorable rows', () => {
    expect(page).toMatch(/data-testid="goal-deleted-dialog"/);
    expect(page).toContain('Recently deleted goals');
    expect(page).toContain('nothing is ever\n              hard-deleted');
    expect(page).toContain('same target, same progress, same status');
    expect(page).toMatch(/data-testid=\{`goal-deleted-row-\$\{g\.id\}`\}/);
    expect(page).toMatch(/data-testid=\{`goal-restore-\$\{g\.id\}`\}/);
    expect(page).toMatch(/aria-label=\{`Restore goal \$\{g\.title\}`\}/);
    // the row says when it left and what it kept
    expect(page).toContain('deleted {formatDate(g.deletedAt)}');
    expect(page).toContain('kept');
    // the POST verb is the only writer
    expect(page).toMatch(/apiSend\(`\/api\/hr\/goals\/\$\{g\.id\}\/restore`, 'POST'\)/);
  });

  it('an empty bench says so plainly; the restore affordance wears emerald', () => {
    expect(page).toMatch(/data-testid="goal-deleted-empty"/);
    expect(page).toContain('The bench is clear.');
    expect(page).toMatch(/border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950\/40 dark:hover:text-emerald-200/);
    // the dialog stays open through a restore — run() reloads, the row leaves, the board regains
    expect(page).toMatch(/void run\(\(\) => apiSend\(`\/api\/hr\/goals\/\$\{g\.id\}\/restore`, 'POST'\)\)/);
  });
});

describe('privacy floor + release anchors', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
  const wn = readRepo('src/lib/whats-new.ts');

  it('no ratings or narratives anywhere in the goal family (bench included)', () => {
    const goalSlice = page.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
    expect(goalSlice).not.toMatch(/overallRating|strengths|improvements/i);
    const benchSlice = page.split('data-testid="goal-deleted-dialog"')[1]?.split('</Dialog>')[0] ?? '';
    expect(benchSlice).not.toMatch(/overallRating|strengths|improvements/i);
    const goalsHalf = view.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
    expect(goalsHalf).not.toMatch(/overallRating|strengths|improvements/i);
  });

  it("What's-New 2.93.0 leads the feed", () => {
    const at = wn.indexOf("version: '2.93.0'");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(wn.indexOf("version: '2.92.0'"));
    expect(wn).toMatch(/The bench remembers/);
    expect(wn).toMatch(/Recently deleted/);
    expect(wn).toMatch(/same target, same progress, same status/);
    expect(wn).toMatch(/manage-gated like the delete/);
  });

  it('prior anchors hold — v2.92 delete + custom, v2.91 door + edit, v2.90 picker, v2.89 chips', () => {
    expect(page).toMatch(/data-testid="goal-delete-dialog"/);
    expect(page).toMatch(/data-testid="goal-custom-label"/);
    expect(page).toMatch(/data-testid="perf-auth"/);
    expect(page).toMatch(/data-testid="goal-edit-dialog"/);
    expect(page).toMatch(/data-testid="goal-cycle-picker"/);
    expect(page).toMatch(/data-testid=\{`goal-filter-status-\$\{s\}`\}/);
    expect(view).toMatch(/data-testid=\{`my-goal-panel-\$\{g\.id\}`\}/);
  });
});
