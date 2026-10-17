import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.69.0 contracts — the desk files its report.
 *
 * Gap: the morning-note family told the org what happened YESTERDAY
 * (v2.67.0 strip, v2.68.0 bell), but a filing desk needs more than
 * yesterday — there was no way to walk out with a per-branch, printable
 * roll-up of the ledger over a real window.
 *
 * Covered here:
 *  1. Pure module (src/lib/hr/desk-report.ts): explicit window resolution
 *     (7/14/30, fallback 7), EAT calendar window arithmetic (today included,
 *     year rollover safe), day keys/labels on the EAT wall clock, and the
 *     one-pass deriveDeskReport — totals, per-branch roll-up, reviewer
 *     roll-up, an every-day series with honest zeros, and capped top
 *     requests. Scope contract: the report re-keys to the caller's explicit
 *     window/branch by design (unlike the org-wide morning note).
 *  2. GET /api/org/desk-report: ORG_ROLES gate (the review-activity
 *     audience), rawDb + runWithoutTenant (v2.57.0 leak class), window +
 *     optional branch narrow in the where, READ-ONLY (no notification
 *     writes — printing never rings), scope line naming the branch.
 *  3. The view (/org/desk-report): server-computed data rendered through
 *     authorizedFetchJson, window + branch chips, the four totals tiles,
 *     per-branch table, day-by-day bar strip, reviewers, top requests,
 *     honest empty state, print via printReceiptElement('desk-report-content')
 *     with a print:hidden toolbar, dark-mode completeness.
 *  4. The Desk activity panel carries the "Report" door (desk-report-link).
 *  5. What's-New 2.69.0 leads the feed; version slots bumped; the
 *     morning-note surfaces are untouched.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

import {
  DESK_REPORT_WINDOW_DAYS,
  DESK_REPORT_DEFAULT_DAYS,
  DESK_REPORT_TOP_REQUESTS_LIMIT,
  DESK_REPORT_ORG_ROLES,
  DESK_REPORT_AVATAR_HUES,
  resolveDeskReportDays,
  deskReportWindow,
  deskReportDayKey,
  deskReportDayLabel,
  deskReportWindowLabel,
  deskReportShortStoreName,
  deskReportAvatarHue,
  deriveDeskReport,
  type DeskReportVisitRow,
} from '@/lib/hr/desk-report';

// ── helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
const row = (over: Partial<DeskReportVisitRow> = {}): DeskReportVisitRow => {
  seq += 1;
  return {
    visitedByName: 'System Administrator',
    createdAt: new Date(Date.UTC(2026, 9, 16, 7, 0, 0)), // 10:00 EAT, Fri 16 Oct
    clearedRecheck: false,
    leaveRequestId: `req-${seq}`,
    leaveRequest: {
      status: 'PENDING',
      storeId: 'store-juja',
      store: { name: 'MBUMAH HARDWARE - Juja Main' },
      employee: { firstName: 'David', lastName: 'Otieno' },
      leaveType: { name: 'Sick Leave' },
    },
    ...over,
  };
};

const EAT_OFFSET_MS = 3 * 3_600_000;

// ── 1a. window resolution ───────────────────────────────────────────────────

describe('resolveDeskReportDays - the explicit window', () => {
  it('accepts exactly the three selectable windows', () => {
    expect(DESK_REPORT_WINDOW_DAYS).toEqual([7, 14, 30]);
    expect(resolveDeskReportDays('7')).toBe(7);
    expect(resolveDeskReportDays('14')).toBe(14);
    expect(resolveDeskReportDays('30')).toBe(30);
  });

  it('falls back to 7 on absent, non-numeric or out-of-range values', () => {
    expect(resolveDeskReportDays(null)).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(resolveDeskReportDays(undefined)).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(resolveDeskReportDays('')).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(resolveDeskReportDays('yesterday')).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(resolveDeskReportDays('3')).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(resolveDeskReportDays('365')).toBe(DESK_REPORT_DEFAULT_DAYS);
    expect(DESK_REPORT_DEFAULT_DAYS).toBe(7);
  });
});

// ── 1b. EAT window arithmetic ───────────────────────────────────────────────

describe('deskReportWindow - EAT calendar math', () => {
  it('covers exactly `days` EAT calendar days, TODAY included', () => {
    // 2026-10-17T14:00Z = 17 Oct 17:00 EAT → window ends at EAT-midnight of 18 Oct.
    const now = new Date('2026-10-17T14:00:00Z');
    const win = deskReportWindow(now, 7);
    expect(win.end.getTime()).toBe(Date.UTC(2026, 9, 18) - EAT_OFFSET_MS);
    expect(win.start.getTime()).toBe(win.end.getTime() - 7 * 86_400_000);
    // The window start is EAT-midnight of 11 Oct (2026-10-10T21:00Z).
    expect(win.start.toISOString()).toBe('2026-10-10T21:00:00.000Z');
  });

  it('keeps the day count stable across the year rollover', () => {
    const now = new Date('2027-01-01T10:00:00Z'); // 13:00 EAT on New Year's Day
    const win = deskReportWindow(now, 14);
    const keys = Array.from({ length: 14 }, (_, i) =>
      deskReportDayKey(new Date(win.start.getTime() + i * 86_400_000)));
    // The last window day is TODAY (EAT, 2027-01-01); the first is 13 EAT
    // days earlier — 2026-12-19, so the series crosses the year boundary.
    expect(keys[13]).toBe('2027-01-01');
    expect(keys[0]).toBe('2026-12-19');
    expect(new Set(keys).size).toBe(14);
  });

  it('labels the window on the EAT wall clock with an arrow', () => {
    const now = new Date('2026-10-17T14:00:00Z');
    const win = deskReportWindow(now, 7);
    const label = deskReportWindowLabel(win.start, win.end);
    expect(label).toBe('Sun 11 Oct → Sat 17 Oct');
  });

  it('derives day keys on the EAT wall clock, not UTC', () => {
    // 2026-10-16T21:30Z is 17 Oct 00:30 EAT — the desk's next day.
    expect(deskReportDayKey(new Date('2026-10-16T21:30:00Z'))).toBe('2026-10-17');
    expect(deskReportDayKey(new Date('2026-10-16T20:59:00Z'))).toBe('2026-10-16');
  });

  it('renders the same en-GB day label the strip uses', () => {
    expect(deskReportDayLabel('2026-10-16')).toMatch(/^Fri 16 Oct$/);
  });
});

// ── 1c. derivation ──────────────────────────────────────────────────────────

describe('deriveDeskReport - one pass over the window rows', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };

  it('totals visits, clears, distinct reviewers and distinct requests', () => {
    const rows = [
      row({ clearedRecheck: true }),
      row({ visitedByName: 'Mbumah Hardware Owner', clearedRecheck: true }),
      row({ leaveRequestId: 'req-1' }), // same request as the first row
    ];
    const report = deriveDeskReport(rows, win7);
    expect(report.totals).toEqual({ visits: 3, clears: 2, reviewers: 2, requests: 2 });
  });

  it('rolls up per branch: visits, clears, reviewers, requests, last visit', () => {
    const rows = [
      row({ clearedRecheck: true, createdAt: new Date('2026-10-16T09:00:00Z') }),
      row({ createdAt: new Date('2026-10-16T10:00:00Z') }),
      row({
        visitedByName: 'System',
        createdAt: new Date('2026-10-15T08:00:00Z'),
        leaveRequest: {
          status: 'APPROVED', storeId: 'store-nak',
          store: { name: 'MBUMAH HARDWARE - Nakuru Branch' },
          employee: { firstName: 'Grace', lastName: 'Achieng' },
          leaveType: { name: 'Annual Leave' },
        },
      }),
    ];
    const report = deriveDeskReport(rows, win7);
    expect(report.branches).toHaveLength(2);
    const juja = report.branches.find((b) => b.storeId === 'store-juja');
    expect(juja).toMatchObject({
      storeId: 'store-juja',
      storeName: 'MBUMAH HARDWARE - Juja Main',
      visits: 2, clears: 1, reviewers: 1, requests: 2,
      lastVisitAt: new Date('2026-10-16T10:00:00Z').toISOString(),
    });
    const nak = report.branches.find((b) => b.storeId === 'store-nak');
    expect(nak).toMatchObject({ visits: 1, clears: 0, reviewers: 1, requests: 1 });
  });

  it('sorts branches by visits desc, ties by name', () => {
    const mk = (storeId: string, storeName: string) =>
      row({ leaveRequest: { status: 'PENDING', storeId, store: { name: storeName }, employee: { firstName: 'A', lastName: 'B' }, leaveType: { name: 'Leave' } } });
    const rows = [
      mk('store-b', 'MBUMAH HARDWARE - Thika'),
      mk('store-a', 'MBUMAH HARDWARE - Juja'),
      mk('store-c', 'MBUMAH HARDWARE - Nakuru'),
      mk('store-c', 'MBUMAH HARDWARE - Nakuru'),
    ];
    const report = deriveDeskReport(rows, win7);
    expect(report.branches.map((b) => b.storeId)).toEqual(['store-c', 'store-a', 'store-b']);
  });

  it('rolls up reviewers with branch spread and last visit', () => {
    const rows = [
      row({ clearedRecheck: true }),
      row({ leaveRequest: { status: 'PENDING', storeId: 'store-nak', store: { name: 'Nakuru' }, employee: { firstName: 'G', lastName: 'A' }, leaveType: { name: 'Leave' } } }),
    ];
    const report = deriveDeskReport(rows, win7);
    expect(report.reviewers).toEqual([
      {
        name: 'System Administrator',
        visits: 2, clears: 1, branches: 2,
        lastVisitAt: rows[1].createdAt.toISOString(),
      },
    ]);
  });

  it('keeps every series day present with honest zeros, oldest first', () => {
    const rows = [
      row({ createdAt: new Date('2026-10-16T09:00:00Z') }),
      row({ createdAt: new Date('2026-10-16T10:00:00Z') }),
      row({ createdAt: new Date('2026-10-12T09:00:00Z'), clearedRecheck: true }),
    ];
    const report = deriveDeskReport(rows, win7);
    expect(report.series).toHaveLength(7);
    expect(report.series.map((p) => p.key)).toEqual([
      '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
    ]);
    expect(report.series.map((p) => p.visits)).toEqual([0, 1, 0, 0, 0, 2, 0]);
    expect(report.series[1].clears).toBe(1);
    expect(report.series[0].label).toBe('Sun 11 Oct');
  });

  it('caps top requests at five, sorted by visits then recency', () => {
    const rows: DeskReportVisitRow[] = [];
    for (let i = 0; i < 7; i += 1) rows.push(row({ leaveRequestId: 'hot' }));
    for (let i = 0; i < 3; i += 1) rows.push(row({ leaveRequestId: 'warm' }));
    for (let i = 0; i < 6; i += 1) rows.push(row({ leaveRequestId: `cold-${i}` }));
    const report = deriveDeskReport(rows, win7);
    expect(report.topRequests).toHaveLength(DESK_REPORT_TOP_REQUESTS_LIMIT);
    expect(report.topRequests[0]).toMatchObject({ requestId: 'hot', visits: 7 });
    expect(report.topRequests[1]).toMatchObject({ requestId: 'warm', visits: 3 });
    const cold = report.topRequests.slice(2).map((r) => r.visits);
    expect(cold).toEqual([1, 1, 1]);
    expect(report.totals.requests).toBe(8);
  });

  it('derives an all-zero report from an empty window (honest quiet)', () => {
    const report = deriveDeskReport([], win7);
    expect(report.totals).toEqual({ visits: 0, clears: 0, reviewers: 0, requests: 0 });
    expect(report.branches).toEqual([]);
    expect(report.reviewers).toEqual([]);
    expect(report.topRequests).toEqual([]);
    expect(report.series).toHaveLength(7);
    expect(report.series.every((p) => p.visits === 0 && p.clears === 0)).toBe(true);
  });

  it('carries the window label and days into the payload', () => {
    const report = deriveDeskReport([], win7);
    expect(report.window.days).toBe(7);
    expect(report.window.label).toBe('Sun 11 Oct → Sat 17 Oct');
    expect(new Date(report.window.start).getTime()).toBe(win7.start.getTime());
    expect(new Date(report.window.end).getTime()).toBe(win7.end.getTime());
  });
});

// ── 1d. presentation helpers ────────────────────────────────────────────────

describe('report presentation helpers', () => {
  it('shortens store names exactly like the strip chips', () => {
    expect(deskReportShortStoreName('MBUMAH HARDWARE - Juja Main')).toBe('Juja Main');
    expect(deskReportShortStoreName('MBUMAH HARDWARE - Nairobi CBD Branch')).toBe('Nairobi CBD Branch');
    expect(deskReportShortStoreName('Juja')).toBe('Juja');
  });

  it('keeps a deterministic six-hue avatar palette', () => {
    expect(DESK_REPORT_AVATAR_HUES).toHaveLength(6);
    expect(deskReportAvatarHue('System Administrator')).toBe(deskReportAvatarHue('System Administrator'));
    expect(deskReportAvatarHue('a')).not.toBe(deskReportAvatarHue('b'));
  });
});

// ── 2. GET /api/org/desk-report — the read-only route ────────────────────────

describe('GET /api/org/desk-report - the read-only report route', () => {
  const RT = readRepo('src/app/api/org/desk-report/route.ts');

  it('gates to the same org roles the desk panel serves', () => {
    expect(DESK_REPORT_ORG_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER']);
    expect(RT).toContain('DESK_REPORT_ORG_ROLES');
    expect(RT).toMatch(/roles: \[\.\.\.DESK_REPORT_ORG_ROLES\]/);
  });

  it('reads through rawDb inside runWithoutTenant (v2.57.0 leak class)', () => {
    expect(RT).toContain("import { rawDb, runWithoutTenant } from '@/lib/db';");
    expect(RT).toMatch(/return runWithoutTenant\(async \(\) => \{/);
    expect(RT).toContain('rawDb.leaveReviewVisit.findMany(');
  });

  it('derives the window and days from the pure module', () => {
    expect(RT).toContain('resolveDeskReportDays(url.searchParams.get(\'days\'))');
    expect(RT).toContain('deskReportWindow(now, days)');
    expect(RT).toMatch(/const branch = url\.searchParams\.get\('branch'\)\?\.trim\(\) \|\| null;/);
  });

  it('narrows by branch only when the caller explicitly picked one', () => {
    expect(RT).toContain('...(branch ? { leaveRequest: { storeId: branch } } : {})');
  });

  it('is a pure READ: no bell, no notification writes', () => {
    expect(RT).not.toContain('notification.');
    expect(RT).not.toContain('createMany');
    expect(RT).not.toContain('ensureDeskDigestNote');
    expect(RT).toContain('READ-ONLY by contract');
  });

  it('returns generatedAt, the scope line and the full derived report', () => {
    expect(RT).toContain('generatedAt: now.toISOString()');
    expect(RT).toContain('scope: { branch, branchName }');
    expect(RT).toMatch(/\.\.\.report,/);
  });

  it('stays force-dynamic behind the error boundary', () => {
    expect(RT).toContain("export const dynamic = 'force-dynamic';");
    expect(RT).toContain('withErrorBoundary(');
    expect(RT).toContain('LogComponent.API');
  });
});

// ── 3. the view (/org/desk-report) ──────────────────────────────────────────

describe('DeskReportView - the printable report page', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');
  const PAGE = readRepo('src/app/(shell)/org/desk-report/page.tsx');

  it('mounts at /org/desk-report behind a force-dynamic wrapper', () => {
    expect(PAGE).toContain('export const dynamic = \'force-dynamic\';');
    expect(PAGE).toContain('DeskReportView');
    expect(PAGE).toContain("title: 'Desk Report | Mbumah Hardware POS'");
  });

  it('fetches through authorizedFetchJson with the explicit scope', () => {
    expect(VIEW).toContain("authorizedFetchJson(`/api/org/desk-report${query}`)");
    expect(VIEW).toMatch(/const query = `\?days=\$\{d\}\$\{b \? `&branch=\$\{encodeURIComponent\(b\)\}` : ''\}`;/);
  });

  it('offers exactly the three window chips and an all-branches chip', () => {
    expect(VIEW).toContain('DESK_REPORT_WINDOW_DAYS.map');
    expect(VIEW).toContain('data-testid="desk-report-window-chips"');
    expect(VIEW).toContain('data-testid="desk-report-branch-chip-all"');
    expect(VIEW).toMatch(/data-testid=\{`desk-report-window-\$\{d\}`\}/);
    expect(VIEW).toMatch(/data-testid=\{`desk-report-branch-chip-\$\{b\.storeId\}`\}/);
  });

  it('renders the four totals tiles with stable testids', () => {
    expect(VIEW).toContain('data-testid="desk-report-totals"');
    expect(VIEW).toMatch(/data-testid=\{`desk-report-tot-\$\{id\}`\}/);
    expect(VIEW).toContain("'Corrections answered'");
  });

  it('renders the per-branch table, reviewers and top requests', () => {
    expect(VIEW).toContain('data-testid="desk-report-branches"');
    expect(VIEW).toContain('data-testid="desk-report-branch-row"');
    expect(VIEW).toContain('data-testid="desk-report-reviewers"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-row"');
    expect(VIEW).toContain('data-testid="desk-report-top-requests"');
    expect(VIEW).toContain('data-testid="desk-report-request-row"');
  });

  it('draws the day-by-day bar strip with every day present', () => {
    expect(VIEW).toContain('data-testid="desk-report-series"');
    expect(VIEW).toMatch(/data-testid=\{`desk-report-day-\$\{p\.key\}`\}/);
    expect(VIEW).toContain('bg-gradient-to-t from-amber-400 to-emerald-500');
    expect(VIEW).toContain("'bg-slate-100 dark:bg-slate-800'");
  });

  it('prints through the print-root pipeline, toolbar excluded', () => {
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    expect(VIEW).toContain('id="desk-report-content"');
    expect(VIEW).toContain('data-testid="desk-report-print"');
    expect(VIEW).toMatch(/import \{ printReceiptElement \} from '@\/lib\/receipt-pdf';/);
  });

  it('says the quiet window honestly', () => {
    expect(VIEW).toContain('data-testid="desk-report-empty"');
    expect(VIEW).toContain('The desk was quiet for this window');
  });

  it('degrades honestly on 401 and 403', () => {
    expect(VIEW).toContain('Sign in to file the desk report.');
    expect(VIEW).toContain('The desk report is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).');
    expect(VIEW).toContain('data-testid="desk-report-error"');
  });

  it('is dark-mode complete (dawn header echoes the strip)', () => {
    expect(VIEW).toContain('dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10');
    expect(VIEW).toContain('dark:border-slate-800 dark:bg-slate-900');
    expect(VIEW).toMatch(/deskReportAvatarHue\(r\.name\)/);
  });

  it('links back to the desk activity panel', () => {
    expect(VIEW).toContain('data-testid="desk-report-back"');
    expect(VIEW).toMatch(/href="\/console"/);
  });
});

// ── 4. the panel door ───────────────────────────────────────────────────────

describe('Desk activity panel - the Report door', () => {
  const PANELS = readRepo('src/components/org/panels.tsx');

  it('links the panel header to the report page', () => {
    expect(PANELS).toContain('data-testid="desk-report-link"');
    expect(PANELS).toMatch(/import Link from 'next\/link';/);
    expect(PANELS).toMatch(/href="\/org\/desk-report"/);
    expect(PANELS).toContain('Open the printable desk report');
  });
});

// ── 5. release metadata ─────────────────────────────────────────────────────

describe('release metadata - v2.69.0', () => {
  it('leads What\'s-New with the report story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.69.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.69.0'")).toBeLessThan(WN.indexOf("version: '2.68.0'"));
    expect(WN).toContain('The desk files its report');
    expect(WN).toMatch(/printable per-branch/);
    expect(WN).toMatch(/Most-visited|most-visited/i);
  });

  it('bumps package.json to 2.69.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    expect(PKG.version).toBe('2.69.0');
    expect(PKG.mbumah.releaseVersion).toBe('2.69.0');
    expect(PKG.mbumah.baseVersion).toBe('2.69.0');
    expect(PKG.scripts['verify:v2-69-0']).toBe('node scripts/verify-v2-69-0.mjs');
  });

  it('keeps the morning-note surfaces intact (strip, bell, panel)', () => {
    const PANELS = readRepo('src/components/org/panels.tsx');
    expect(PANELS).toContain('data-testid="desk-digest"');
    expect(PANELS).toContain('Yesterday at the desk');
    const RA = readRepo('src/app/api/org/review-activity/route.ts');
    expect(RA).toContain('await ensureDeskDigestNote({');
    expect(RA).toContain("const EAT_OFFSET_MS = 3 * 3_600_000;");
  });
});
