// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.92.0: the goals can leave — and the custom metric has a name.
 *
 * Three moves in one release:
 *   1. GOAL DELETE — a draft mistake used to pollute the team board
 *      forever. deleteGoal soft-deletes (deletedAt set, row stays, audits
 *      stay), guarded by hr.performance.manage with a GOAL_DELETED audit
 *      carrying title/status/metricSource. The console pairs the Delete
 *      action with a confirm dialog that names the goal and states what
 *      a removal means — never a bare one-click vanish.
 *   2. CUSTOM end-to-end — GOAL_SOURCES always included CUSTOM, but the
 *      dialog never offered it. Now it does, and a custom goal must name
 *      its metric (metricConfig.label, 2-120 chars — the service refuses
 *      an anonymous custom goal). The label rides toDto on the row (no
 *      fold, no mapping-path risk) onto GoalDto.metricLabel, and shows on
 *      the console card, the portal meta line, and the details panel.
 *   3. THE HONEST SIGN-IN DOOR — a signed-out visitor used to get tabs
 *      rendering fake empty states over lists that never loaded (the same
 *      lie v2.91 fixed for wrong-role visitors). The /me 401 now yields a
 *      sign-in panel instead.
 *
 * File-level contracts (the perf-goal-edit.test.ts pattern); the
 * service rules live in stage-g-goals.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — a soft delete, audited, never a hard one', () => {
  const service = readRepo('src/lib/hr/goal-service.ts');

  it('deleteGoal soft-deletes through loadGoal (scope-aware) and audits the removal', () => {
    const body = service.split('export async function deleteGoal')[1]?.split('\n}')[0] ?? '';
    expect(body).toContain('loadGoal(goalId, session)');
    expect(body).toContain('deletedAt: new Date()');
    expect(body).toContain("action: 'GOAL_DELETED'");
    expect(body).toContain('title: goal.title');
    expect(body).toContain('status: goal.status');
    expect(body).not.toMatch(/\.delete\(/);
  });

  it('every read already filters deletedAt — the goal leaves all lists honestly', () => {
    const list = service.split('export async function listGoals')[1]?.split('// ── POS computation')[0] ?? '';
    expect(list).toContain('deletedAt: null');
    const mine = service.split('export async function listMyGoals')[1]?.split('export async function listMyGoalProgress')[0] ?? '';
    expect(mine).toContain('deletedAt: null');
    const loads = service.split('async function loadGoal')[1]?.split('async function employeeNameFor')[0] ?? '';
    expect(loads).toContain('deletedAt: null');
  });

  it('the DELETE route is manage-guarded like the other writes', () => {
    const route = readRepo('src/app/api/hr/goals/[id]/route.ts');
    expect(route).toMatch(/export const DELETE = hrGuard\('hr\.performance\.manage'\)/);
    expect(route).toContain('deleteGoal(id, session)');
    expect(route).toContain("import { deleteGoal, updateGoal }");
  });
});

describe('service — a custom goal must say what it counts', () => {
  const service = readRepo('src/lib/hr/goal-service.ts');

  it('CUSTOM requires a metric label (2-120 chars) at the door', () => {
    const body = service.split("if (metricSource === 'CUSTOM')")[1] ?? '';
    expect(body).toContain('CUSTOM_METRIC_LABEL_REQUIRED');
    expect(body).toMatch(/length < 2/);
    expect(body).toMatch(/length > 120/);
    expect(body).toContain('metric description');
  });

  it('metricLabel rides toDto on the row — no mapping-path risk', () => {
    const toDto = service.split('function toDto(')[1]?.split('\n}')[0] ?? '';
    expect(toDto).toContain('parseMetricConfig(goal.metricConfig)');
    expect(toDto).toMatch(/metricLabel/);
    const dto = service.split('export interface GoalDto')[1]?.split('}')[0] ?? '';
    expect(dto).toMatch(/metricLabel: string \| null/);
  });
});

describe('console — the goals can leave', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('every goal card carries a manage-gated, rose-dressed Delete action', () => {
    expect(page).toMatch(/data-testid=\{`goal-delete-\$\{g\.id\}`\}/);
    expect(page).toMatch(/aria-label=\{`Delete goal \$\{g\.title\}`\}/);
    expect(page).toMatch(/text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950\/40 dark:hover:text-rose-300/);
    // sits in the same canManage block as Edit — read-only viewers see neither
    expect((page.match(/\{canManage \? \(\n\s*<div className="flex w-full gap-2">/g) ?? []).length).toBe(1);
  });

  it('the confirm dialog names the goal and states what a removal means', () => {
    expect(page).toMatch(/data-testid="goal-delete-dialog"/);
    expect(page).toContain('Delete this goal?');
    expect(page).toContain('this is a removal from the lists, never a hard delete');
    expect(page).toMatch(/data-testid="goal-delete-summary"/);
    expect(page).toMatch(/data-testid="goal-delete-confirm"/);
    expect(page).toMatch(/data-testid="goal-delete-cancel"/);
    expect(page).toContain('Keep goal');
    // the DELETE verb is the only writer
    expect(page).toMatch(/apiSend\(`\/api\/hr\/goals\/\$\{deleteTarget\.id\}`, 'DELETE'\)/);
  });
});

describe('console — the custom metric has a name', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('the dialog offers Custom and demands a metric description', () => {
    expect(page).toContain('<SelectItem value="CUSTOM">Custom metric</SelectItem>');
    expect(page).toMatch(/data-testid="goal-custom-label"/);
    expect(page).toContain('What does the metric count?');
    // the create button stays disabled until the label earns its keep
    expect(page).toMatch(/goalSource === 'CUSTOM' && goalCustomLabel\.trim\(\)\.length < 2/);
  });

  it('the POST carries metricConfig only for CUSTOM; the label resets', () => {
    expect(page).toMatch(/\.\.\.\(goalSource === 'CUSTOM' \? \{ metricConfig: \{ label: goalCustomLabel \} \} : \{\}\)/);
    expect(page).toMatch(/setGoalCustomLabel\(''\)/);
  });

  it('the card names the metric next to the source chip', () => {
    expect(page).toMatch(/g\.metricSource === 'CUSTOM' && g\.metricLabel \? <span className="ml-1 opacity-80">· \{g\.metricLabel\}<\/span> : null/);
    expect(page).toMatch(/title=\{g\.metricLabel \?\? undefined\}/);
  });
});

describe('the honest sign-in door', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('a /me 401 yields a sign-in panel, never fake empty states', () => {
    expect(page).toMatch(/data-testid="perf-auth"/);
    expect(page).toMatch(/data-testid="perf-auth-signin"/);
    expect(page).toContain('Sign in to view this workspace');
    expect(page).toMatch(/status === 401/);
    expect(page).toMatch(/setAuthRequired\(true\)/);
    // the panel wins over the tabs entirely
    expect(page).toMatch(/authRequired \? \(/);
  });

  it('the skeleton respects the auth gate — no flash of tabs for visitors', () => {
    expect(page).toMatch(/viewerRole === null && !authRequired && !cycles && !reviews && !goals \? \(/);
  });
});

describe('portal — the custom metric speaks', () => {
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
  const self = readRepo('src/lib/hr/self-service.ts');

  it('the whitelist carries metricLabel (per-path rule)', () => {
    const mapper = self.split('export async function listMyGoalProgress')[1]?.split('export async function listMyPerformanceReviews')[0] ?? '';
    expect(mapper).toMatch(/metricLabel:\s*g\.metricLabel/);
    expect(view).toMatch(/metricLabel\?: string \| null;/);
  });

  it('the meta line and details panel name the custom metric', () => {
    expect(view).toMatch(/Custom metric · \{g\.metricLabel\}/);
    expect(view).toMatch(/`Custom · \$\{g\.metricLabel\}`/);
    expect(view).toContain('A custom goal: progress is kept current by hand, counting what the metric names.');
  });
});

describe('privacy floor + release anchors', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
  const wn = readRepo('src/lib/whats-new.ts');

  it('no ratings or narratives anywhere in the goal family', () => {
    const goalSlice = page.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
    expect(goalSlice).not.toMatch(/overallRating|strengths|improvements/i);
    const goalsHalf = view.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
    expect(goalsHalf.length).toBeGreaterThan(0);
    expect(goalsHalf).not.toMatch(/overallRating|strengths|improvements/i);
  });

  it("What's-New 2.92.0 leads the feed", () => {
    const at = wn.indexOf("version: '2.92.0'");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(wn.indexOf("version: '2.91.0'"));
    expect(wn).toMatch(/The goals can leave/);
    expect(wn).toMatch(/never a hard one/);
    expect(wn).toMatch(/Custom metrics go end-to-end/);
  });

  it('prior anchors hold — v2.91 door + edit, v2.90 picker, v2.89 chips, v2.87 write', () => {
    expect(page).toMatch(/data-testid="perf-lock"/);
    expect(page).toMatch(/data-testid="goal-edit-dialog"/);
    expect(page).toMatch(/data-testid="goal-cycle-picker"/);
    expect(page).toMatch(/data-testid=\{`goal-filter-status-\$\{s\}`\}/);
    expect(page).toMatch(/data-testid="perf-review-edit"/);
    expect(view).toMatch(/data-testid=\{`my-goal-panel-\$\{g\.id\}`\}/);
  });
});
