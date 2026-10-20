import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBranchesCsv, type BranchDeskCsvBlock } from '../lib/org/branches-csv';

/**
 * v2.154.0 — the pair the dark theme got wrong, and the note that follows up.
 *
 * QA this round rode the a11y campaign to the surfaces the console sweeps
 * never reached: the unauthenticated login screen and /hr/reports dark mode.
 *
 *  - /hr/reports dark mode held ONE real axe violation: color-contrast
 *    3.15:1 — `bg-primary` + near-white `--primary-foreground`. The dark
 *    block's primary is a mid blue (lab L 58 ≈ #568de9); the near-white
 *    foreground failed on EVERY dark primary button in the app (36
 *    text-primary-foreground usages). The foreground flips to a cool
 *    near-black (~5.5:1 on the same blue); every usage sits on a
 *    primary(-ish) fill, so nothing regresses. The 108 text-primary
 *    usages are WHY the background token never moved: darkening --primary
 *    would have broken primary-as-text on dark cards app-wide.
 *  - The dark `--accent-orange-foreground` had the same disease: the orange
 *    fill never changes between themes, but the dark override flipped the
 *    text to near-white — every bg-accent-orange CTA (login submit,
 *    customers/inventory actions) measured ~2.2:1 in dark mode. The dark
 *    block now mirrors the light block's warm near-black.
 *  - The login screen (unauthenticated) measured 0 axe violations but the
 *    gradient masked the arithmetic: on the light glass card (white/60 over
 *    the navy gradient ≈ #ababb5) the footer's muted/70 links measured
 *    ~1.7:1 and the muted/30 separators ~1.2:1; on the dark gradient the
 *    branding white/40 measured ~3.55:1 and the support-critical version
 *    badge white/25 ~2.26:1. All four move to tokens that pass on BOTH
 *    glass variants; the destructive dismiss icon drops its 70% alpha.
 *
 * FEATURE: the branches CSV grows its third section — the desk's yesterday
 * digest (headline figures + per-branch visits) fetched org-wide from the
 * review-activity read — and the export note grows an Open link to the
 * fresh blob (previous URL revoked; one live blob at a time).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const DESK: BranchDeskCsvBlock = {
  label: 'Monday 19 October 2026',
  visits: 7,
  clears: 3,
  reviewers: 2,
  requests: 5,
  busiestBranch: { storeName: 'Juja Main', visits: 4 },
  topReviewer: { name: 'Grace W', visits: 4 },
  branches: [
    { storeName: 'Juja Main', visits: 4 },
    { storeName: 'Thika Town', visits: 3 },
  ],
};

describe('the dark primary pair reads on its own blue', () => {
  it('dark --primary-foreground is the cool near-black, light keeps near-white', () => {
    const css = readRepo('src/app/globals.css');
    // the dark block: the primary-foreground DIRECTLY under the mid-blue primary
    const darkPrimary = css.indexOf('--primary: oklch(0.65 0.15 260);');
    expect(darkPrimary).toBeGreaterThan(0);
    const darkFg = css.slice(darkPrimary, darkPrimary + 800);
    expect(darkFg).toContain('--primary-foreground: oklch(0.155 0.03 260);');
    // the light block keeps its navy + near-white pair
    expect(css).toContain('--primary: oklch(0.295 0.1 260);\n  --primary-foreground: oklch(0.985 0 0);');
  });

  it('dark --accent-orange-foreground mirrors the light block exactly', () => {
    const css = readRepo('src/app/globals.css');
    const darkBlock = css.slice(css.indexOf('.dark {'));
    expect(darkBlock).toContain('--accent-orange-foreground: oklch(0.175 0.05 55);');
    // and the light block still carries the same value — one pair, both themes
    const lightBlock = css.slice(0, css.indexOf('.dark {'));
    expect(lightBlock).toContain('--accent-orange-foreground: oklch(0.175 0.05 55);');
  });

  it('every text-primary-foreground usage in the app sits on a primary-family fill', () => {
    // guard the flip's safety claim: no primary-foreground text on a foreign bg.
    // Icon-ternary lines inside a bg-primary chip (notification-center) inherit
    // the chip's fill — the chip line itself carries the bg and sits within a
    // few lines above, so proximity counts.
    const files = [
      'src/components/pos/category-chips.tsx',
      'src/components/notification-center.tsx',
    ];
    for (const f of files) {
      const src = readRepo(f);
      const lines = src.split('\n');
      const uses = lines.filter((l) => l.includes('text-primary-foreground'));
      expect(uses.length).toBeGreaterThan(0);
      uses.forEach((line) => {
        const own = /bg-primary|from-primary|bg-white\/20/.test(line);
        if (own) return;
        const lineNo = lines.indexOf(line);
        const chipNearby = lines
          .slice(Math.max(0, lineNo - 10), lineNo + 10)
          .some((l) => /'bg-primary text-primary-foreground'/.test(l));
        expect(
          chipNearby,
          `${f} uses text-primary-foreground without a primary-family bg nearby: ${line.trim().slice(0, 120)}`,
        ).toBe(true);
      });
    }
  });
});

describe('the login screen passes on both glass variants', () => {
  it('the footer line drops the muted alphas for theme-adaptive foreground alphas', () => {
    const src = readRepo('src/components/login-screen.tsx');
    expect(src).toContain('text-[11px] text-foreground/80');
    expect(src).not.toContain('text-muted-foreground/70');
    expect(src).not.toContain('text-muted-foreground/30');
    // v2.162.0 re-anchor: the two separator dots joined the /80 family —
    // the blend-math audit measured /50 at 2.71:1 on the light glass; they
    // are aria-hidden decoratives now (5.25:1). ZERO /50 remains.
    expect((src.match(/text-foreground\/50/g) ?? []).length).toBe(0);
    expect((src.match(/<span className="text-foreground\/80" aria-hidden="true">·<\/span>/g) ?? []).length).toBe(2);
  });

  it('the dark-gradient texts keep their readability margins', () => {
    const src = readRepo('src/components/login-screen.tsx');
    expect(src).toContain('text-xs text-white/70 font-medium tracking-wider');
    expect(src).toContain('text-[10px] text-white/55 tracking-wider');
    expect(src).not.toContain('text-white/40');
    expect(src).not.toContain('text-white/25');
    // the eyebrow and h2 were already passing — untouched
    expect(src).toContain('text-white/60 mb-1.5');
    expect(src).toContain('text-white/90 flex items-center justify-center gap-2');
  });

  it('the destructive dismiss icon drops its alpha', () => {
    const src = readRepo('src/components/login-screen.tsx');
    // v2.162.0 re-anchor: on the light glass the `destructive` token
    // (oklch 0.577) measured 1.81:1 — under the 3:1 non-text bar; the X
    // now uses red-800 light / destructive dark (3.34:1 / 5.84:1).
    expect(src).toContain('rounded-md p-1 text-red-800 dark:text-destructive transition-colors');
    // no CLASS attribute carries the 70% alpha (comments may narrate the fix)
    expect(src).not.toMatch(/className="[^"]*text-destructive\/70/);
  });
});

describe('the branches CSV carries the desk report too', () => {
  it('appends the desk section: headline figures then per-branch visits', () => {
    const csv = buildBranchesCsv(
      [
        {
          name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
          todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
          overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
      null,
      DESK,
    );
    const lines = csv.split('\n');
    const head = lines.indexOf('Desk report — Monday 19 October 2026');
    expect(head).toBeGreaterThan(0);
    expect(lines[head + 1]).toBe('Desk activity,Value');
    expect(lines[head + 2]).toBe('Visits,7');
    expect(lines[head + 3]).toBe('Corrections cleared,3');
    expect(lines[head + 4]).toBe('Distinct reviewers,2');
    expect(lines[head + 5]).toBe('Requests visited,5');
    expect(lines[head + 6]).toBe('Busiest branch,Juja Main (4 visits)');
    expect(lines[head + 7]).toBe('Most active reviewer,Grace W (4 visits)');
    expect(lines[head + 8]).toBe('');
    expect(lines[head + 9]).toBe('Branch,Visits (yesterday)');
    expect(lines[head + 10]).toBe('Juja Main,4');
    expect(lines[head + 11]).toBe('Thika Town,3');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('a quiet desk is an honest zero, not an absence — empty branch list prints headlines', () => {
    const csv = buildBranchesCsv(
      [
        {
          name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
          todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
          overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
      null,
      { ...DESK, visits: 0, clears: 0, busiestBranch: null, topReviewer: null, branches: [] },
    );
    const lines = csv.split('\n');
    const head = lines.indexOf('Desk report — Monday 19 October 2026');
    expect(head).toBeGreaterThan(0);
    expect(lines[head + 2]).toBe('Visits,0');
    expect(lines[head + 6]).toBe('Busiest branch,None');
    expect(lines[head + 7]).toBe('Most active reviewer,None');
    expect(lines[head + 9]).toBe('Branch,Visits (yesterday)');
    expect(lines[head + 10]).toBe('');
  });

  it('names that carry commas survive as quoted RFC-4180 fields', () => {
    const csv = buildBranchesCsv(
      [
        {
          name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
          todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
          overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
      null,
      {
        ...DESK,
        busiestBranch: { storeName: 'Juja Main, Kenbridge', visits: 4 },
        branches: [{ storeName: 'Juja Main, Kenbridge', visits: 4 }],
      },
    );
    expect(csv).toContain('Busiest branch,"Juja Main, Kenbridge (4 visits)"');
    expect(csv).toContain('"Juja Main, Kenbridge",4');
  });

  it('stays byte-identical to the v2.152.0 shape when desk is absent, null, or the hr rows vary', () => {
    const stores = [
      {
        name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
        todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
        overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
      },
    ] as const;
    const at = new Date('2026-10-20T00:00:00.000Z');
    const without = buildBranchesCsv(stores, at);
    const nullish = buildBranchesCsv(stores, at, null, null);
    const withHr = buildBranchesCsv(stores, at, [
      {
        storeName: 'Juja Main',
        headcountActive: 5,
        monthEmploymentCost: 182500,
        monthAbsenceRatePct: 2.4,
        latestPayroll: { periodName: 'October 2026', status: 'DRAFT' },
        expiryAlerts: 3,
      },
    ]);
    const withHrAndDesk = buildBranchesCsv(stores, at, [
      {
        storeName: 'Juja Main',
        headcountActive: 5,
        monthEmploymentCost: 182500,
        monthAbsenceRatePct: 2.4,
        latestPayroll: { periodName: 'October 2026', status: 'DRAFT' },
        expiryAlerts: 3,
      },
    ], null);
    expect(without).toBe(nullish);
    expect(withHr).toBe(withHrAndDesk);
    expect(without).not.toContain('Desk report');
    expect(withHr).not.toContain('Desk report');
  });
});

describe('the export handler rides the review-activity read and follows up', () => {
  it('fetches org-wide desk activity, tolerates refusal, passes the block through', () => {
    const org = readRepo('src/components/workspace/org-console.tsx');
    expect(org).toContain("authorizedFetchJson('/api/org/review-activity')");
    expect(org).toContain('if (!desk) deskNote');
    // v2.178.0 pin evolution (deliberate): the call grew its fifth argument —
    // the week by branch rides the same download as the fourth section.
    expect(org).toContain('      trendRows,\n    );');
  });

  it('the note grows an Open link to the live blob, one URL at a time', () => {
    const org = readRepo('src/components/workspace/org-console.tsx');
    expect(org).toContain('data-testid="org-console-export-open"');
    expect(org).toContain('aria-label="Open the exported CSV in a new tab"');
    expect(org).toContain('rel="noopener noreferrer"');
    expect(org).toContain('if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);');
    expect(org).toContain('setExporting(false);');
    expect(org).toContain('disabled={exporting}');
    // the old always-revoke is gone — the Open link needs the URL alive
    expect(org).not.toContain('    URL.revokeObjectURL(url);\n    setExportNote');
  });
});

describe('the release surfaces speak 2.154.0', () => {
  it('package.json, changelog and the feed lead with 2.154.0', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.187.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.187.0');
    expect(pkg.mbumah.baseVersion).toBe('2.187.0');
    expect(readRepo('CHANGELOG.md')).toContain('## [2.187.0]');
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed.indexOf("'2.187.0'")).toBeLessThan(feed.indexOf("'2.153.0'"));
  });
});
