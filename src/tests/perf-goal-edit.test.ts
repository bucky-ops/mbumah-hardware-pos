// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.91.0: the HR door is honest — and the goals take edits.
 *
 * Two moves in one release:
 *   1. The /hr/performance page stops showing an interactive shell to
 *      visitors whose role holds no hr.performance.review permission.
 *      The client gate mirrors the server's hrGuard through the SAME
 *      pure map (src/lib/hr/permissions.ts) over the /api/auth/me role —
 *      one truth, no drift. No permission → an honest lock panel that
 *      names the role and points to the self-service portal; the old
 *      behaviour (error note + tabs + write affordances + "No goals
 *      yet" over a list that never loaded) is gone.
 *   2. The goals take edits: the console grows a dedicated edit dialog
 *      backed by PATCH /api/hr/goals/[id] (service updateGoal — title /
 *      target / dueDate / status OPEN-CLOSED / currentValue for
 *      MANUAL-CUSTOM; POS-sourced values stay computed). Employee and
 *      metric source render as read-only meta because the service never
 *      rewrites them. The portal's My goals cards unfold a Details
 *      panel (source / cycle / due / last updated) mirroring the
 *      reviews read-half.
 *
 * File-level contracts (the perf-goal-cycle.test.ts pattern); the
 * service rules live in stage-g-goals.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — updateGoal was always the writer; the UI finally speaks it', () => {
  const service = readRepo('src/lib/hr/goal-service.ts');

  it('updateGoal edits title / target / due / status / currentValue with guards', () => {
    const body = service.split('export async function updateGoal')[1] ?? '';
    expect(body).toContain('data.title = title;');
    expect(body).toContain('data.targetValue = target;');
    expect(body).toContain('data.dueDate =');
    expect(body).toMatch(/status !== 'OPEN' && status !== 'CLOSED'/);
    expect(body).toMatch(/POS_GOAL_READONLY/);
    expect(body).toContain('NOTHING_TO_UPDATE');
  });

  it('the write is audited with the changed fields', () => {
    const body = service.split('export async function updateGoal')[1]?.split('return toDto(')[0] ?? '';
    expect(body).toContain("action: 'GOAL_UPDATED'");
    expect(body).toContain('fields: Object.keys(data)');
  });

  it('the route is guarded by hr.performance.manage', () => {
    const route = readRepo('src/app/api/hr/goals/[id]/route.ts');
    expect(route).toMatch(/hrGuard\('hr\.performance\.manage'\)/);
    expect(route).toMatch(/updateGoal\(id, body, session\)/);
  });
});

describe('console — the honest HR door', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const permissions = readRepo('src/lib/hr/permissions.ts');

  it('the client gate uses the SAME pure map the server guard uses', () => {
    expect(page).toContain("import { hasHrPermission } from '@/lib/hr/permissions';");
    expect(permissions).toMatch(/export function hasHrPermission\(/);
    expect(permissions).toMatch(/role === 'SUPER_ADMIN'\) return true/);
    expect(page).toMatch(/hasHrPermission\(viewerRole, 'hr\.performance\.review'\)/);
    expect(page).toMatch(/hasHrPermission\(viewerRole, 'hr\.performance\.manage'\)/);
  });

  it('the viewer role resolves from /api/auth/me before any gate decision', () => {
    expect(page).toMatch(/apiGet<\{ role\?: string \}>\('\/api\/auth\/me'\)/);
    expect(page).toMatch(/const \[viewerRole, setViewerRole\] = useState<string \| null>\(null\)/);
  });

  it('no review permission → the lock panel names the role and the key', () => {
    expect(page).toMatch(/data-testid="perf-lock"/);
    expect(page).toMatch(/data-testid="perf-lock-role"/);
    expect(page).toContain('HR performance is locked for your role');
    expect(page).toContain('hr.performance.review');
    expect(page).toContain('self-service portal');
    expect(page).toMatch(/href="\/employees\/me"/);
    expect(page).toContain('LockKeyhole');
  });

  it('the lock replaces the tabs entirely — never tabs + a lie', () => {
    // The ternary gates the whole Tabs block; the skeleton shows only
    // while the role is still resolving (v2.92 added the sign-in door
    // ahead of the lock in the same chain).
    expect(page).toMatch(/viewerRole !== null && !canReview \? \(/);
    expect(page).toMatch(/viewerRole === null && !authRequired && !cycles && !reviews && !goals \? \(/);
  });

  it('write affordances hide without hr.performance.manage', () => {
    // New cycle button gated (v2.97.0: the action row always renders for
    // the read-level CSV door; the create button after it stays gated)
    expect(page).toMatch(/\{canManage \? \(\n\s*<Button size="sm" onClick=\{\(\) => setCycleOpen\(true\)\}>/);
    // New goal button gated
    expect(page).toMatch(/\{canManage \? \(\n\s*<Button size="sm" onClick=\{\(\) => setGoalOpen\(true\)\}>/);
    // recompute-all gated (manage key, matching the route)
    expect(page).toMatch(/\{canManage && posGoalCount > 0 \? \(/);
  });
});

describe('console — the goals take edits', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('every goal card carries an Edit action, manage-gated', () => {
    expect(page).toMatch(/data-testid=\{`goal-edit-\$\{g\.id\}`\}/);
    expect(page).toMatch(/aria-label=\{`Edit goal \$\{g\.title\}`\}/);
    expect(page).toMatch(/const openGoalEdit = \(g: GoalDto\)/);
    // v2.92: Edit and Delete share one manage-gated row on the card
    expect((page.match(/\{canManage \? \(\n\s*<div className="flex w-full gap-2">/g) ?? []).length).toBe(1);
  });

  it('the edit dialog prefills and PATCHes the audited route', () => {
    expect(page).toMatch(/data-testid="goal-edit-dialog"/);
    expect(page).toMatch(/apiSend\(`\/api\/hr\/goals\/\$\{editGoal\.id\}`, 'PATCH'/);
    expect(page).toMatch(/data-testid="goal-edit-save"/);
    expect(page).toMatch(/data-testid="goal-edit-cancel"/);
    // payload carries the editable fields; dueDate '' clears honestly
    expect(page).toMatch(/title: editGoalTitle/);
    expect(page).toMatch(/targetValue: editGoalTarget/);
    expect(page).toMatch(/status: editGoalStatus/);
    expect(page).toMatch(/dueDate: editGoalDue \? new Date\(editGoalDue\)\.toISOString\(\) : ''/);
  });

  it('employee and source are read-only meta — the service never rewrites them', () => {
    expect(page).toMatch(/data-testid="goal-edit-meta"/);
    const payload = page.split('apiSend(`/api/hr/goals/${editGoal.id}`')[1]?.split('setEditGoal(null)')[0] ?? '';
    expect(payload.length).toBeGreaterThan(0);
    expect(payload).not.toMatch(/employeeId\s*:/);
    expect(payload).not.toMatch(/(^|[^.])metricSource\s*:/);
  });

  it('POS-sourced goals refuse a typed value — recompute stays the only writer', () => {
    expect(page).toMatch(/data-testid="goal-edit-pos-note"/);
    expect(page).toContain('Computed from POS sales — use recompute, never a typed value.');
    // currentValue only rides along for MANUAL / CUSTOM
    expect(page).toMatch(
      /\.\.\.\(editGoal\.metricSource === 'MANUAL' \|\| editGoal\.metricSource === 'CUSTOM' \? \{ currentValue: editGoalCurrent \} : \{\}\)/,
    );
  });

  it('status is a park-or-reopen switch — achieved and missed stay computed', () => {
    expect(page).toMatch(/data-testid=\{`goal-edit-status-\$\{s\.toLowerCase\(\)\}`\}/);
    expect(page).toMatch(/\(\['OPEN', 'CLOSED'\] as const\)\.map/);
    expect(page).toMatch(/aria-pressed=\{active\}/);
    expect(page).toContain('ACHIEVED and MISSED are computed from progress — you can only park or reopen a goal.');
    // the switch wears the same chip families the filter chips speak
    expect(page).toMatch(/active \? GOAL_CHIP_ACTIVE\[s\]/);
  });
});

describe('portal — the details unfold in place', () => {
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');

  it('each card grows a Details toggle with aria-expanded', () => {
    expect(view).toMatch(/data-testid=\{`my-goal-details-\$\{g\.id\}`\}/);
    expect(view).toMatch(/aria-expanded=\{isOpen\}/);
    expect(view).toMatch(/setOpenGoalId\(isOpen \? null : g\.id\)/);
  });

  it('the panel shows source, cycle, due, and last-updated honestly', () => {
    expect(view).toMatch(/data-testid=\{`my-goal-panel-\$\{g\.id\}`\}/);
    expect(view).toContain('Metric source');
    expect(view).toContain('Review cycle');
    expect(view).toContain('Last updated');
    expect(view).toMatch(/g\.cycleName \|\| 'No cycle'/);
    expect(view).toMatch(/g\.dueDate \? formatDate\(g\.dueDate\) : 'No due date'/);
    expect(view).toMatch(/g\.updatedAt \? formatDate\(g\.updatedAt\) : '—'/);
  });

  it('the POS-sourced honesty note carries over; updatedAt joins the DTO', () => {
    expect(view).toContain('This goal reads POS sales directly — the number moves when sales move, never by hand.');
    expect(view).toContain('A manual goal: your manager keeps the progress value current.');
    expect(view).toMatch(/updatedAt\?: string;/);
  });

  it('one goal unfolds at a time — the reviews read-half pattern', () => {
    expect(view).toMatch(/const \[openGoalId, setOpenGoalId\] = useState<string \| null>\(null\)/);
  });

  it('listMyGoalProgress folds updatedAt through the portal mapping (per-path rule)', () => {
    // The v2.90 lesson: a new DTO field is asserted on EVERY path that
    // maps it — the portal's whitelist silently dropped updatedAt once
    // already, and the panel read "—" until the fold was pinned here.
    const self = readRepo('src/lib/hr/self-service.ts');
    const mapper = self.split('export async function listMyGoalProgress')[1]?.split('export async function listMyPerformanceReviews')[0] ?? '';
    expect(mapper.length).toBeGreaterThan(0);
    expect(mapper).toMatch(/updatedAt:\s*g\.updatedAt/);
  });
});

describe('privacy floor + release anchors', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
  const wn = readRepo('src/lib/whats-new.ts');

  it('no ratings or narratives anywhere in the goal family', () => {
    const goalSlice = page.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
    expect(goalSlice).not.toMatch(/overallRating|strengths|improvements/i);
    // portal: scope to the goals section (the reviews read-half legitimately
    // carries overallRating since v2.87; its interface sits above it).
    const goalsHalf = view.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
    expect(goalsHalf.length).toBeGreaterThan(0);
    expect(goalsHalf).not.toMatch(/overallRating|strengths|improvements/i);
  });

  it("What's-New 2.91.0 leads the feed with the honest-door story", () => {
    const at = wn.indexOf("version: '2.91.0'");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(wn.indexOf("version: '2.90.0'"));
    expect(wn).toMatch(/The HR door is honest/);
    expect(wn).toMatch(/goals take edits/);
    expect(wn).toMatch(/Details panel/);
  });

  it('prior anchors hold — v2.90 picker, v2.89 chips, v2.87 review write', () => {
    expect(page).toMatch(/data-testid="goal-cycle-picker"/);
    expect(page).toMatch(/data-testid=\{`goal-filter-status-\$\{s\}`\}/);
    expect(page).toMatch(/data-testid="perf-review-edit"/);
  });
});
