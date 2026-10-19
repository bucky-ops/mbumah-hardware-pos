import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COL_WIDTH_MIN,
  COL_WIDTH_MAX,
  COL_WIDTHS_STORAGE_KEY,
  EDGE_BAND,
  clampColWidth,
  nudgeColWidth,
  loadColWidths,
} from '@/lib/hr/column-resize';
import { stoodDaysBetween } from '@/lib/hr/data-protection';
import { consentTimelinesCsvFilename } from '@/lib/hr/consent-timeline-csv';

/**
 * v2.132.0 — "the columns bend, the branch files itself".
 *
 * Two things ship under that headline:
 *
 *  1. THE BRANCH FILES ITSELF: the consent ledger grows a branch-level
 *     export — EVERY in-scope employee's timeline as ONE flat CSV, the
 *     export-honesty theme's fourth beat (v2.115 case list → v2.118 access
 *     ledger → v2.130 one drawer's timeline → now the whole branch). The
 *     serializer is the drawer's own; the row type still has no content
 *     field, so a branch-wide extract adds no column the drawer never showed.
 *
 *  2. THE COLUMNS BEND: resizable columns — the EMS spec Phase 4.8
 *     acceptance's last unsatisfied table affordance (sticky headers,
 *     visibility, CSV export and print PDF already shipped). A delegated
 *     pointer handler starts a drag within EDGE_BAND of a th's right edge;
 *     widths clamp to [88, 480], persist per column key in localStorage, and
 *     a double-click on the edge resets.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('clampColWidth — the honest band', () => {
  it('clamps below the minimum, above the maximum, and rounds to whole pixels', () => {
    expect(clampColWidth(10)).toBe(COL_WIDTH_MIN);
    expect(clampColWidth(99_999)).toBe(COL_WIDTH_MAX);
    expect(clampColWidth(200.4)).toBe(200);
    expect(clampColWidth(COL_WIDTH_MIN)).toBe(COL_WIDTH_MIN);
    expect(clampColWidth(COL_WIDTH_MAX)).toBe(COL_WIDTH_MAX);
  });

  it('a non-finite width degrades to the minimum — garbage never breaks the drag', () => {
    expect(clampColWidth(Number.NaN)).toBe(COL_WIDTH_MIN);
    expect(clampColWidth(Number.POSITIVE_INFINITY)).toBe(COL_WIDTH_MIN);
  });
});

describe('nudgeColWidth — one formula for the drag, the tests, and the E2E', () => {
  it('adds the pointer travel and clamps', () => {
    expect(nudgeColWidth(120, 30)).toBe(150);
    expect(nudgeColWidth(120, -500)).toBe(COL_WIDTH_MIN);
    expect(nudgeColWidth(400, 500)).toBe(COL_WIDTH_MAX);
    expect(nudgeColWidth(120, 0)).toBe(120);
  });
});

describe('loadColWidths — a corrupted store renders nothing broken', () => {
  it('null, empty, and garbage JSON degrade to an empty map', () => {
    expect(loadColWidths(null)).toEqual({});
    expect(loadColWidths(undefined)).toEqual({});
    expect(loadColWidths('')).toEqual({});
    expect(loadColWidths('not json at all')).toEqual({});
    expect(loadColWidths('[1,2,3]')).toEqual({});
    expect(loadColWidths('"a string"')).toEqual({});
    expect(loadColWidths('42')).toEqual({});
  });

  it('out-of-band and non-finite entries are dropped — they were never this desk\'s widths', () => {
    expect(loadColWidths(JSON.stringify({ label: 5 }))).toEqual({});
    expect(loadColWidths(JSON.stringify({ label: 99_999 }))).toEqual({});
    expect(loadColWidths(JSON.stringify({ label: 'wide' }))).toEqual({});
    expect(loadColWidths(JSON.stringify({ label: Number.NaN }))).toEqual({});
    expect(loadColWidths(JSON.stringify({ '': 120 }))).toEqual({});
  });

  it('honest widths survive verbatim; an out-of-band sibling is dropped, not clamped', () => {
    expect(loadColWidths(JSON.stringify({ label: 160, 'p10-code': 300 }))).toEqual({ label: 160, 'p10-code': 300 });
    expect(loadColWidths(JSON.stringify({ label: 160, bad: 5 }))).toEqual({ label: 160 });
  });

  it('the edge band and storage key are the constants the page actually uses', () => {
    expect(EDGE_BAND).toBe(8);
    expect(COL_WIDTHS_STORAGE_KEY).toBe('hr-reports-col-widths');
    expect(src('src/app/(shell)/hr/reports/page.tsx')).toContain('COL_WIDTHS_STORAGE_KEY');
  });
});

describe('stoodDaysBetween — the server-side clock, now shared', () => {
  it('a standing consent has no honest day count: null', () => {
    expect(stoodDaysBetween(new Date('2026-01-01T00:00:00.000Z'), null)).toBeNull();
  });

  it('a span shorter than a day floors to 0; multi-day spans floor', () => {
    expect(stoodDaysBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T23:59:59.000Z'))).toBe(0);
    expect(stoodDaysBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-29T12:00:00.000Z'))).toBe(28);
    expect(stoodDaysBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'))).toBe(1);
  });

  it('a nonsense (negative) span clamps to 0, never a negative day count', () => {
    expect(stoodDaysBetween(new Date('2026-01-29T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))).toBe(0);
  });

  it('listConsentHistory AND exportConsentTimelines both ride the same clock (the refactor pin)', () => {
    const s = src('src/lib/hr/data-protection.ts');
    expect(s.split('stoodDaysBetween(c.grantedAt, c.withdrawnAt)').length - 1).toBe(2);
    // the day-math lives ONCE now — inside stoodDaysBetween
    expect(s.split('86_400_000').length - 1).toBe(1);
  });
});

describe('consentTimelinesCsvFilename — the branch file\'s name', () => {
  it('plural, no code: consent-timelines-{day}.csv', () => {
    expect(consentTimelinesCsvFilename(new Date('2026-10-19T09:00:00.000Z'))).toBe('consent-timelines-2026-10-19.csv');
  });
});

describe('the branch export route — a view right taken broadly, guarded like the ledger', () => {
  const route = () => src('src/app/api/hr/privacy/consent/export/route.ts');

  it('GET-only: no mutation verb is exported', () => {
    const s = route();
    expect(s).toContain('export const GET');
    for (const verb of ['export const POST', 'export const PATCH', 'export const PUT', 'export const DELETE']) {
      expect(s.includes(verb)).toBe(false);
    }
  });

  it('same guard trio as the ledger itself — reading is a view right, never a decision right', () => {
    const s = route();
    expect(s).toContain("hrGuard('hr.report.branch'");
    expect(s).toContain("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const");
  });

  it('the CSV rides the service serializer with an attachment disposition and no-store', () => {
    const s = route();
    expect(s).toContain('exportConsentTimelines(session)');
    expect(s).toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(s).toContain('Content-Disposition');
    expect(s).toContain("'Cache-Control': 'no-store'");
  });
});

describe('exportConsentTimelines — the service reads the whole branch honestly', () => {
  const service = () => src('src/lib/hr/data-protection.ts');

  it('same scope where as the ledger: not deleted, inside employeeScopeWhere', () => {
    const s = service();
    const fn = s.slice(s.indexOf('export async function exportConsentTimelines'), s.indexOf('async function consentTargetEmployee'));
    expect(fn).toContain('deletedAt: null');
    expect(fn).toContain('employeeScopeWhere(session)');
  });

  it('rows order employee → cycle: lastName/firstName employees, grantedAt-asc cycles', () => {
    const s = service();
    const fn = s.slice(s.indexOf('export async function exportConsentTimelines'), s.indexOf('async function consentTargetEmployee'));
    expect(fn).toContain("orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]");
    expect(fn).toContain("consentRecords: { orderBy: { grantedAt: 'asc' } }");
    expect(fn).toContain('cycle: i + 1');
  });

  it('the file is the drawer\'s own serializer — the bulk export adds no column', () => {
    const s = service();
    const fn = s.slice(s.indexOf('export async function exportConsentTimelines'), s.indexOf('async function consentTargetEmployee'));
    expect(fn).toContain('buildConsentTimelineCsv(rows)');
    expect(fn).toContain('consentTimelinesCsvFilename()');
    expect(fn).toContain('stoodDaysBetween(c.grantedAt, c.withdrawnAt)');
  });
});

describe('the Export-all door wears the export-honesty manners', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('the door carries its testid, aria-label, and the honesty tooltip', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-export-all"');
    expect(s).toContain('aria-label="Export all consent timelines CSV"');
    expect(s).toContain("One flat CSV: every in-scope employee's consent cycles — who, when, and what purpose. Never content.");
  });

  it('the door renders only when the ledger has rows — an empty ledger files nothing', () => {
    const s = page();
    expect(s).toContain('consent && consent.records.length > 0 ? (');
  });

  it('the fetch rides the cookie session and names the file from the disposition', () => {
    const s = page();
    expect(s).toContain("fetch('/api/hr/privacy/consent/export', { credentials: 'include' })");
    expect(s).toContain("/filename=\"([^\"]+)\"/");
    expect(s).toContain("?? 'consent-timelines.csv'");
  });

  it('a failed export speaks: rose status line, nothing downloaded — never a silent spinner', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-export-error"');
    expect(s).toContain('The export could not be built — nothing was downloaded.');
    expect(s).toContain('{exportAllBusy ? \'Exporting…\' : \'Export all\'}');
  });
});

describe('the columns bend — resizable columns, the spec\'s last table affordance', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('every TableHead but the two headcount minis is resizable — the parity pin', () => {
    const s = page();
    const elements = (s.match(/<TableHead(?!er)/g) ?? []).length;
    const spreads = (s.match(/\{\.\.\.head\('[a-z0-9-]+'\)\}/g) ?? []).length;
    // 63 elements: 59 resizable + 4 mini heads (two 2-column headcount
    // breakdowns a resize affordance would only noise up)
    expect(elements).toBe(63);
    expect(spreads).toBe(59);
    expect(elements - spreads).toBe(4);
  });

  it('the drag is delegated once — the tabs container carries the handlers', () => {
    const s = page();
    expect(s).toContain('onPointerDown={onReportPointerDown}');
    expect(s).toContain('onDoubleClick={onReportDoubleClick}');
    expect(s).toContain('onPointerMove={onReportPointerMove}');
    expect(s).toContain("closest?.('th[data-resize-key]')");
    expect(s).toContain('EDGE_BAND');
  });

  it('widths persist per browser and survive a reload — the ref is the drag\'s source of truth', () => {
    const s = page();
    expect(s).toContain('window.localStorage.getItem(COL_WIDTHS_STORAGE_KEY)');
    expect(s).toContain('window.localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(next))');
    expect(s).toContain('nudgeColWidth(r.startW, e.clientX - r.startX)');
    expect(s).toContain('colWidthsRef.current = { ...colWidthsRef.current, [r.key]: next };');
  });

  it('the affordance is visible: the edge tooltip says drag and double-click', () => {
    const s = page();
    expect(s).toContain('Drag the right edge to resize · double-click the edge to reset');
  });

  it('the head() factory is the one-spread way a head becomes resizable', () => {
    const s = page();
    expect(s).toContain("const head = (key: string) => ({\n    'data-resize-key': key,");
    expect(s).toContain('style: colWidths[key] ? { width: colWidths[key], minWidth: colWidths[key] } : undefined');
  });
});
