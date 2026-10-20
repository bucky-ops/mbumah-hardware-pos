import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.153.0 — the tinted cards tell the truth.
 *
 * The v2.152.0 re-audit's six nodes, probed with the lesson-65 discipline
 * (check the PARENT bg, never assume white):
 *  - the alert-card titles sat on TINTED rows (SEV's bg-red-50 / bg-blue-50),
 *    so text-red-600 measured 4.41:1 and text-blue-600 4.75:1 — both move
 *    to their -700 (5.9:1 / ~6.6:1); the detail line's slate-500 measured
 *    4.27-4.30 on the tints and moves to slate-600 (~6.9:1 on every tint);
 *  - the Live Feed's active filter wore white (the Button default
 *    text-primary-foreground) on bg-orange-500 — 2.15:1; it now wears
 *    text-slate-950 (the v2.148 amber-pill language);
 *  - the KPI row's 60d debt-aging badge wore text-orange-600 (3.2:1) —
 *    orange-800 (7.0:1);
 *  - the People & payroll module's hint line (slate-400, 2.9:1) and its
 *    amber-600 links (3.19:1) finish their own pass.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const PANELS = 'src/components/org/panels.tsx';
const KPI = 'src/components/org/kpi-row.tsx';
const PPB = 'src/components/finance/people-payroll-by-branch.tsx';

describe('the tinted alert cards speak tokens that clear their own tints', () => {
  it('titles: red-700 / amber-700 / blue-700 (each clears its -50 tint)', () => {
    expect(readRepo(PANELS)).toContain(
      "const SEV_TEXT: Record<string, string> = { critical: 'text-red-700', warning: 'text-amber-700', info: 'text-blue-700' };",
    );
  });

  it('the detail line is slate-600 — clears every tint with margin', () => {
    const panels = readRepo(PANELS);
    // v2.159.0: the dark half joined the pair (axe dark re-audit).
    expect(panels).toContain('<p className="text-xs text-slate-600 dark:text-slate-400">{a.detail}</p>');
    expect(panels).not.toContain('<p className="text-xs text-slate-500">{a.detail}</p>');
  });

  it('the Live Feed active filter wears slate-950 on orange-500, never white', () => {
    expect(readRepo(PANELS)).toContain(
      "filter === l ? 'bg-orange-500 text-slate-950 hover:bg-orange-400' : ''",
    );
  });

  it('the 60d debt-aging badge clears on white', () => {
    expect(readRepo(KPI)).toContain('<Badge variant="outline" className="px-1 py-0 text-orange-800">60d');
    expect(readRepo(KPI)).not.toContain('text-orange-600');
  });
});

describe('the People & payroll module finishes its own pass', () => {
  it('the hint line and the links pass on white with dark halves kept', () => {
    const src = readRepo(PPB);
    expect(src).toContain('hidden text-xs font-normal text-slate-500 dark:text-slate-400 sm:inline');
    expect((src.match(/(^|[^:-])text-amber-600/g) ?? []).length).toBe(0);
    expect((src.match(/text-amber-700/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(src.includes('hover:text-orange-600')).toBe(false);
  });
});

describe('the release surfaces speak 2.154.0 (re-anchored per release)', () => {
  it('package.json, changelog and the feed lead with 2.154.0', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.177.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.177.0');
    expect(pkg.mbumah.baseVersion).toBe('2.177.0');
    expect(readRepo('CHANGELOG.md')).toContain('## [2.177.0]');
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed.indexOf("'2.177.0'")).toBeLessThan(feed.indexOf("'2.153.0'"));
  });
});
