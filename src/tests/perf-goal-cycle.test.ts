// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.90.0: the goals meet their cycles — and the portal reads the shape.
 *
 * The Goal model has carried a bare cycleId since v2.19.0, but nothing
 * ever offered it: the New goal dialog had no picker, no card named its
 * cycle, and the portal's goals half had no visible heading, no chips,
 * no counts. This round:
 *   1. The service folds cycleName into every goal read through ONE
 *      findMany-in query (no schema change — the Goal model keeps its
 *      SQLite-parity bare column).
 *   2. The console's New goal dialog gains an optional cycle picker
 *      (non-CLOSED cycles) and linked cards wear an amber cycle chip.
 *   3. The portal's My goals half grows a visible heading, the same
 *      status chips with live counts, an honest "Showing X of Y" line,
 *      a filtered-empty way back, and the cycle name on linked cards.
 *
 * File-level contracts (the perf-goal-shape.test.ts pattern); the
 * service rules live in stage-g-goals.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — the cycle name folds, the schema stays put', () => {
  const service = readRepo('src/lib/hr/goal-service.ts');
  const schema = readRepo('prisma/schema.prisma');

  it('GoalDto carries cycleName; the fold is one deduped in-query', () => {
    expect(service).toMatch(/cycleName:\s*string \| null/);
    expect(service).toContain('async function cycleNamesFor');
    expect(service).toMatch(/id:\s*\{\s*in:\s*ids\s*\}/);
    expect(service).toMatch(/deletedAt: null/);
    expect(service).toMatch(/select:\s*\{\s*id: true, name: true\s*\}/);
  });

  it('the fold short-circuits when nothing is cycled (zero-cost read)', () => {
    expect(service).toMatch(/if \(ids\.length === 0\) return new Map\(\)/);
  });

  it('every read path passes a cycle name — list, mine, create, update, recompute', () => {
    const list = service.split('export async function listGoals')[1]?.split('export async function recomputeGoal')[0] ?? '';
    expect(list).toContain('cycleNamesFor(goals.map((g) => g.cycleId))');
    const mine = service.split('export async function listMyGoals')[1] ?? '';
    expect(mine).toContain('cycleNamesFor(goals.map((g) => g.cycleId))');
    expect(service).toMatch(/cycleName = cycle\.name;/);
    expect((service.match(/cycleNamesFor\(\[goal\.cycleId\]\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('NO schema migration — the Goal model keeps its bare cycleId column', () => {
    const goalModel = schema.split('model Goal ')[1]?.split('}')[0] ?? '';
    expect(goalModel).toContain('cycleId      String?');
    expect(goalModel).not.toMatch(/cycle\s+ReviewCycle\s+@relation/);
  });
});

describe('console — the New goal dialog offers the cycle', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('an optional cycle picker joins the dialog (closed cycles are history)', () => {
    expect(page).toMatch(/data-testid="goal-cycle-picker"/);
    expect(page).toMatch(/aria-label="Goal review cycle"/);
    expect(page).toContain('<SelectItem value="none">No cycle</SelectItem>');
    expect(page).toMatch(/\.filter\(\(c\) => c\.status !== 'CLOSED'\)/);
  });

  it('the POST carries cycleId only when one is picked; the dialog resets', () => {
    expect(page).toMatch(/\.\.\.\(goalCycleId !== 'none' \? \{ cycleId: goalCycleId \} : \{\}\)/);
    expect(page).toMatch(/const \[goalCycleId, setGoalCycleId\] = useState\('none'\)/);
    expect(page).toMatch(/setGoalCycleId\('none'\)/);
  });

  it('linked goal cards wear the amber cycle chip', () => {
    expect(page).toMatch(/\{g\.cycleName \? \(/);
    expect(page).toMatch(/border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300/);
    expect(page).toMatch(/title="Linked review cycle"/);
    expect(page).toMatch(/<CalendarRange className="h-3 w-3" aria-hidden \/> \{g\.cycleName\}/);
  });

  it('the v2.89.0 shape stays intact (chips, recompute-all, filters)', () => {
    expect(page).toMatch(/data-testid=\{`goal-filter-status-\$\{s\}`\}/);
    expect(page).toMatch(/data-testid="goal-recompute-all"/);
    expect(page).toMatch(/data-testid="goal-filter-count"/);
    expect(page).toMatch(/data-testid="goal-filters"/);
  });
});

describe('portal — My goals speaks the same shape', () => {
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
  const selfService = readRepo('src/lib/hr/self-service.ts');

  it('the heading is VISIBLE now (it was aria-only), in both empty and populated states', () => {
    // empty state wears the padded variant, the populated chip row the tight one
    expect(view).toMatch(/<h2 className="px-1 text-sm font-semibold">My goals<\/h2>/);
    expect(view).toMatch(/<h2 className="text-sm font-semibold">My goals<\/h2>/);
  });

  it('status chips with live counts from the FULL list, pressed-aware', () => {
    expect(view).toMatch(/data-testid=\{`my-goal-filter-\$\{s\}`\}/);
    expect(view).toMatch(/aria-pressed=\{active\}/);
    expect(view).toMatch(/const count = s === 'ALL' \? initialGoals\.length : goalStatusCounts\[s\] \?\? 0;/);
    expect(view).toMatch(/goalStatusCounts\[s\] \?\? 0/);
  });

  it('chips wear the console\u2019s badge families, light and dark', () => {
    expect(view).toMatch(/OPEN: 'bg-sky-100 text-sky-800 border-sky-300/);
    expect(view).toMatch(/ACHIEVED: 'bg-emerald-100 text-emerald-800 border-emerald-300/);
    expect(view).toMatch(/MISSED: 'bg-rose-100 text-rose-800 border-rose-300/);
    expect(view).toMatch(/CLOSED: 'bg-slate-100 text-slate-800 border-slate-300/);
  });

  it('the honest line and the filtered-empty way back', () => {
    expect(view).toMatch(/data-testid="my-goal-count"/);
    expect(view).toMatch(/Showing \{visibleGoals\.length\} of \{initialGoals\.length\} goals/);
    expect(view).toContain('No goals match the current filter.');
    expect(view).toMatch(/data-testid="my-goal-filter-clear"/);
    expect(view).toContain('Show all goals');
  });

  it('cards carry anchors and the cycle name rides the meta line', () => {
    expect(view).toMatch(/data-testid=\{`my-goal-card-\$\{g\.id\}`\}/);
    expect(view).toMatch(/cycleName\?:\s*string \| null/);
    expect(view).toMatch(/\{g\.cycleName \? \(/);
    expect(view).toMatch(/<CalendarRange className="h-3 w-3" aria-hidden \/> \{g\.cycleName\}/);
  });

  it('the v2.87.0 read half stays intact (panel + acknowledge flow)', () => {
    expect(view).toContain('data-testid="my-review-panel"');
    expect(view).toMatch(/data-testid=\{`my-review-read-\$\{r\.id\}`\}/);
  });

  it('the self-service mapping passes cycleName through', () => {
    expect(selfService).toMatch(/cycleName: g\.cycleName,/);
  });
});

describe("prior anchors hold — What's-New 2.90.0 leads", () => {
  const whatsNew = readRepo('src/lib/whats-new.ts');

  it('2.90.0 entry exists and leads the feed', () => {
    expect(whatsNew).toMatch(/version: '2\.90\.0'/);
    expect(whatsNew.indexOf("version: '2.90.0'")).toBeLessThan(whatsNew.indexOf("version: '2.89.0'"));
    expect(whatsNew).toMatch(/goals meet their cycles/);
    expect(whatsNew).toMatch(/cycle picker/);
  });

  it('v2.89.0 and v2.88.0 entries remain', () => {
    expect(whatsNew).toMatch(/version: '2\.89\.0'/);
    expect(whatsNew).toMatch(/version: '2\.88\.0'/);
  });
});
