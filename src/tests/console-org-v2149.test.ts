import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBranchesCsv, BRANCHES_CSV_COLUMNS } from '../lib/org/branches-csv';

/**
 * v2.149.0 — the console fits the phone.
 *
 * The acceptance sweep moved onto the unified console pair + the org
 * surfaces. agent-browser + axe-core 4.12 found:
 *  - THE 390px SPEC BROKEN ON THE ORG CONSOLE: documentElement.scrollWidth
 *    measured 1012 at a 390 viewport. Root cause chain, measured live: the
 *    branches table's ~978px intrinsic min-content propagates through the
 *    overflow-x-auto WRAPPER (block scroll containers do NOT zero their
 *    min-content contribution) into the section, into <main> — whose
 *    cross-axis auto margins (mx-auto) size it to fit-content, i.e. its
 *    min-content. The fix is at the shell: main carries w-full min-w-0 so
 *    it stretches to the container instead of to its widest descendant's
 *    intrinsic size, and each scroll wrapper carries min-w-0 itself.
 *  - TWO CRITICAL button-name violations on the expert console: the
 *    Recent Activity Timeline's Action/Role Radix combobox triggers had no
 *    accessible name (the v2.147.0 lesson again: label the TRIGGER).
 *  - A contrast cluster: the 9px ACTIVE chips (emerald-600, 3.65:1) and a
 *    text-slate-400-on-white family (2.9:1) across the console page card
 *    strip, the org panels, the KPI row and the store matrix — plus the
 *    org console's own amber-600 family (3.19:1, and its text-xs cells
 *    need 4.5:1, not the large-text 3:1 the KPI value squeaked by on).
 *  - The org console's HR drill-down wrapper only scrolled vertically —
 *    a six-column table with no horizontal escape (carried defect).
 *  - The Welcome banner's white h1 over the gradient's lightest corner
 *    measured 2.54:1 (carried from v2.148.0's incomplete list).
 *
 * Covered here (source pins — the live sweeps are agent-browser's,
 * recorded in the worklog):
 *  - the shell's w-full min-w-0 on <main> (both consoles inherit),
 *  - both org-console scroll wrappers: min-w-0 + focusable + named,
 *  - the amber-700 sweep (five mounts, dark:amber-400 preserved),
 *  - the branches CSV export (pure builder bytes + the button + the note),
 *  - the expert console chip tokens + the two trigger names,
 *  - the panels/kpi-row/store-matrix slate-500 family (dark pairs kept),
 *  - the Welcome banner's darker light end,
 *  - the release surfaces speak the version.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SHELL = 'src/components/console/unified-console.tsx';
const ORG = 'src/components/workspace/org-console.tsx';
const CONSOLE_PAGE = 'src/app/(shell)/console/page.tsx';
const PANELS = 'src/components/org/panels.tsx';
const KPI = 'src/components/org/kpi-row.tsx';
const MATRIX = 'src/components/org/store-matrix.tsx';
const DASH = 'src/app/(shell)/tabs/dashboard-tab.tsx';

describe('the unified shell main can never be sized by its content again', () => {
  it('main stretches (w-full) and cannot grow past the container (min-w-0)', () => {
    // The measured failure: mx-auto's cross-axis auto margins disabled
    // stretch, so main sized to fit-content = its min-content = the
    // branches table's 978px intrinsic width + padding = 1012px at a 390
    // viewport. w-full re-enables full-width sizing (max-w-7xl still caps
    // it on desktop), min-w-0 kills any residual intrinsic minimum.
    expect(readRepo(SHELL)).toContain('w-full min-w-0 flex-1');
  });

  it('both console modes still ride the same main element', () => {
    const shell = readRepo(SHELL);
    expect(shell).toContain("data-testid={`unified-console-${mode}`}");
    expect(shell).toContain('id="unified-console-main"');
  });
});

describe('the org console scroll wrappers contain their tables and the keyboard', () => {
  it('the branches table wrapper carries min-w-0 + overflow-x-auto', () => {
    // A block scroll container does NOT zero its min-content contribution —
    // without min-w-0 the table's intrinsic width still propagates even
    // though the wrapper itself would scroll.
    expect(readRepo(ORG)).toContain('min-w-0 overflow-x-auto focus-visible:outline-none');
  });

  it('the branches wrapper is a named, keyboard-reachable scroll region', () => {
    // Once the wrapper actually scrolls at 390px, an unfocusable scroller
    // is the exact scrollable-region-focusable violation v2.148.0 fixed
    // on the dashboard — do not reintroduce it here.
    const org = readRepo(ORG);
    expect(org).toContain('aria-label="Branches, scrollable table"');
    expect(org).toContain('tabIndex={0}');
  });

  it('the HR drill-down wrapper scrolls BOTH ways and is focusable (carried defect)', () => {
    const org = readRepo(ORG);
    // Was: `max-h-96 overflow-y-auto` — a six-column table with no
    // horizontal escape.
    expect(org).toContain('max-h-96 min-w-0 overflow-x-auto overflow-y-auto');
    expect(org).toContain('aria-label="People and payroll by branch, scrollable table"');
  });
});

describe('the org console amber family passes at cell size', () => {
  const org = () => readRepo(ORG);

  it('every light-mode amber is amber-700 (4.52:1), never bare amber-600', () => {
    // amber-600 measured 3.19:1 on the white card — the text-xs table
    // cells need 4.5:1 (they are NOT large text); only the text-xl KPI
    // value squeaked by on large-text 3:1 with a thin margin.
    expect(org().match(/text-amber-600/g)?.length ?? 0).toBe(0);
    // eight dark-paired mounts total: four from this round (KPI icon, KPI
    // value, absence cell, expiry cell) + two that predate it (the
    // diagnostics banner chip + the missing-columns line) + the v2.154.0
    // export note's Open link + ONE net new from v2.192.0: the alerts
    // cell's split absorbed the old single conditional class into two
    // adjacent mounts (the docs-beside-assets-door branch + the plain
    // fallback), so 7 + 2 - 1 = 8; the low-stock cell words its classes
    // differently and is pinned separately.
    // v2.193.0 pin evolution (deliberate): the absence cell became the
    // absence door — the amber pair no longer rides as an adjacent string
    // (the door's affordance classes sit between text-amber-700 and
    // dark:text-amber-400), so 8 - 1 = 7; the door's own voice is pinned
    // in hr-absence-door-v2193.
    expect(org().match(/text-amber-700 dark:text-amber-400/g)?.length).toBe(7);
    expect(org()).toContain("tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'");
    expect(org()).toContain('text-amber-700 font-medium dark:text-amber-400');
  });
});

describe('the branches table leaves as CSV (surface parity with the matrix)', () => {
  it('the pure builder emits the documented header, raw numbers, RFC-4180 quoting', () => {
    const csv = buildBranchesCsv(
      [
        {
          name: 'Juja Main',
          code: 'MBH-1',
          location: 'Juja, Kiambu',
          status: 'ACTIVE',
          todayRevenue: 12345.5,
          todayTransactions: 42,
          lowStockCount: 0,
          overdueRentals: 1,
          debtOutstanding: 200340,
          pendingMpesa: 0,
        },
        {
          name: 'Say "cheese" Store',
          code: 'MBH-2',
          location: 'Thika',
          status: 'INACTIVE',
          todayRevenue: 0,
          todayTransactions: 0,
          lowStockCount: 3,
          overdueRentals: 0,
          debtOutstanding: 0,
          pendingMpesa: 2,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Organization Console branches (generated 2026-10-20T00:00:00.000Z)');
    expect(lines[1]).toBe(BRANCHES_CSV_COLUMNS.join(','));
    expect(lines[2]).toBe('Juja Main,MBH-1,"Juja, Kiambu",ACTIVE,12345.5,42,0,1,200340,0');
    // quotes doubled, never broken
    expect(lines[3]).toBe('"Say ""cheese"" Store",MBH-2,Thika,INACTIVE,0,0,3,0,0,2');
    // trailing newline so the file ends cleanly
    expect(csv.endsWith('\n')).toBe(true);
    // numbers are RAW — no thousands separators anywhere
    expect(csv).not.toContain('200,340');
  });

  it('the button, the polite note and the handler are wired on the section header', () => {
    const org = readRepo(ORG);
    expect(org).toContain('data-testid="org-console-export-csv"');
    expect(org).toContain('data-testid="org-console-export-note"');
    expect(org).toContain('aria-live="polite"');
    expect(org).toContain('buildBranchesCsv');
    expect(org).toContain('exportBranchesCsv');
  });
});

describe('the expert console cards and triggers meet the bar', () => {
  it('ACTIVE chips pass on emerald-700; inactive + meta pass on slate-500', () => {
    const page = readRepo(CONSOLE_PAGE);
    expect(page).toContain("s.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'");
    expect(page).toContain('<p className="text-[10px] text-slate-500">{kes(s.todayRevenue)}');
    expect(page).not.toContain('text-emerald-600');
    expect(page).not.toContain('text-slate-400');
  });

  it('the timeline combobox triggers carry their names (label the TRIGGER)', () => {
    const panels = readRepo(PANELS);
    expect(panels).toContain('aria-label="Filter timeline by action"');
    expect(panels).toContain('aria-label="Filter timeline by role"');
  });

  it('the live/streaming chips pass on emerald-700 (dark keeps emerald-400)', () => {
    const panels = readRepo(PANELS);
    expect(panels.match(/text-emerald-600/g)?.length ?? 0).toBe(0);
    expect(panels.match(/text-emerald-700 dark:text-emerald-400/g)?.length).toBe(2);
    expect(panels.match(/text-emerald-700"/g)?.length).toBe(2);
  });
});

describe('the light-surface slate family is swept to passing tokens', () => {
  it('panels, kpi-row and store-matrix carry no bare text-slate-400', () => {
    // ~2.9:1 on white at 10px — the axe incomplete's biggest family.
    // The dark: pairs (dark:text-slate-400 on dark backgrounds, where
    // slate-400 is the CORRECT bright token) are preserved verbatim.
    for (const f of [PANELS, KPI, MATRIX]) {
      const src = readRepo(f);
      const bare = src.match(/(^|[^:-])text-slate-400/g) ?? [];
      expect(bare.length, `${f} bare text-slate-400`).toBe(0);
    }
    // v2.159.0: +3 — the bare light-half slate-600 sites (alert detail, label
    // value, drill-down heading) gained the standing dark:text-slate-400 pair.
    expect(readRepo(PANELS).match(/dark:text-slate-400/g)?.length).toBe(11);
  });

  it('the store matrix zero placeholders pass too (slate-300 was 1.97:1)', () => {
    const matrix = readRepo(MATRIX);
    expect(matrix).not.toContain('<span className="text-slate-300">0</span>');
    expect(matrix.match(/<span className="text-slate-500">0<\/span>/g)?.length).toBe(3);
  });
});

describe('the welcome banner clears 4.5:1 across its whole gradient', () => {
  it('the light end is emerald-700 (#047857), not emerald-500 (#10b981)', () => {
    // The white h1's worst corner measured 2.54:1 over #10b981; over
    // #047857 white computes 5.49:1.
    const dash = readRepo(DASH);
    expect(dash).toContain('from-[#059669] to-[#047857]');
    expect(dash).not.toContain('to-[#10b981]');
  });
});
