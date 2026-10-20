import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.151.0 — the last slate family.
 *
 * The v2.150.0 re-audit's remaining contrast cluster: 15 text-slate-400
 * nodes at 7-11px on white across the Expert Console's module tiles, empty
 * states and captions (2.9:1) — the family earlier sweeps fixed on panels/
 * kpi-row/store-matrix, hiding in experts.tsx and primitives.tsx.
 *
 * Pinned: the two files carry zero bare text-slate-400 (no dark: pairs
 * existed to preserve), the desk-report's deliberate pairs survive, and
 * the release surfaces speak 2.151.0.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the last slate-400 family is swept', () => {
  it('experts.tsx and primitives.tsx carry no bare text-slate-400', () => {
    for (const f of ['src/components/org/experts.tsx', 'src/components/org/primitives.tsx']) {
      const src = readRepo(f);
      const bare = src.match(/(^|[^:-])text-slate-400/g) ?? [];
      expect(bare.length, `${f} bare text-slate-400`).toBe(0);
      expect(src.match(/text-slate-500/g)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('the desk-report carries no bare text-slate-400 (v2.152.0: pairs unified, dark preserved)', () => {
    const src = readRepo('src/components/org/desk-report-view.tsx');
    const bare = src.match(/(^|[^:-])text-slate-400/g) ?? [];
    expect(bare.length).toBe(0);
    expect((src.match(/dark:text-slate-400/g) ?? []).length).toBeGreaterThan(0);
  });

  it('the release surfaces speak 2.152.0 (re-anchored per release)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.164.0');
    expect(readRepo('CHANGELOG.md')).toContain('## [2.164.0]');
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed.indexOf("'2.164.0'")).toBeLessThan(feed.indexOf("'2.153.0'"));
  });
});
