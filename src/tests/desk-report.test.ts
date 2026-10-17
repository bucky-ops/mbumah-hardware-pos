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
  deskReportHasRequestDoor,
  deskReportRequestLedger,
  deskReportRequestSubject,
  deskReportDrawerParam,
  deskReportDrawerHref,
  deskReportResolveDeepLink,
  deskReportReviewerLedger,
  deskReportChipStep,
  deskReportScopeAnnouncement,
  deskReportVisitTime,
  deskReportSliceToCsv,
  deskReportSliceCsvFilename,
  deriveDeskReport,
  type DeskReportVisitEntry,
  type DeskReportVisitRow,
} from '@/lib/hr/desk-report';

// ── helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
const row = (over: Partial<DeskReportVisitRow> = {}): DeskReportVisitRow => {
  seq += 1;
  return {
    id: `visit-${seq}`,
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
    const first = row({ clearedRecheck: true });
    const rows = [
      first,
      row({ visitedByName: 'Mbumah Hardware Owner', clearedRecheck: true }),
      row({ leaveRequestId: first.leaveRequestId }), // same request as the first row
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

  it('bumps package.json to at least 2.69.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    // v2.70.0 precedent: prior-release version pins loosen every round.
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.69.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.69.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.69.0')).toBe(true);
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

// ── 6. the CSV voice (v2.70.0) ──────────────────────────────────────────────

import {
  deskReportCsvFilename,
  deskReportToCsv,
} from '@/lib/hr/desk-report';

describe('deskReportToCsv - the report files itself', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };
  const report = deriveDeskReport(
    [
      row({ clearedRecheck: true, createdAt: new Date('2026-10-16T09:00:00Z') }),
      row({ createdAt: new Date('2026-10-16T10:00:00Z') }),
      row({
        visitedByName: 'System',
        createdAt: new Date('2026-10-12T08:00:00Z'),
        leaveRequest: {
          status: 'APPROVED', storeId: 'store-nak',
          store: { name: 'MBUMAH HARDWARE - Nakuru Branch' },
          employee: { firstName: 'Grace', lastName: 'Achieng' },
          leaveType: { name: 'Annual Leave' },
        },
      }),
    ],
    win7,
  );

  it('keeps the same derivation as the JSON voice (totals match)', () => {
    expect(deskReportToCsv(report, { organizationName: 'MBUMAH Hardware', scopeLabel: 'All branches' }))
      .toContain('Visits,3');
    expect(deskReportToCsv(report, { organizationName: 'MBUMAH Hardware', scopeLabel: 'All branches' }))
      .toContain('Corrections answered,1');
  });

  it('opens with the house header block and scope line', () => {
    const csv = deskReportToCsv(report, { organizationName: 'MBUMAH Hardware', scopeLabel: 'Branch: MBUMAH HARDWARE - Juja Main' });
    const head = csv.split('\r\n').slice(0, 5);
    expect(head[0]).toBe('Report,Desk report');
    expect(head[1]).toBe('Organization,MBUMAH Hardware');
    expect(head[2]).toBe('Scope,Branch: MBUMAH HARDWARE - Juja Main');
    expect(head[3]).toBe(`Window,${report.window.label} (7 EAT days)`);
    expect(head[4]).toMatch(/^Generated \(UTC\),2026-10-17T/);
  });

  it('carries a Summary block with the four totals', () => {
    const csv = deskReportToCsv(report, { organizationName: 'O', scopeLabel: 'S' });
    expect(csv).toContain('Summary\r\nMetric,Value\r\nVisits,3\r\nCorrections answered,1\r\nReviewers,2\r\nRequests touched,3');
  });

  it('files every window day with honest zeros, oldest first', () => {
    const csv = deskReportToCsv(report, { organizationName: 'O', scopeLabel: 'S' });
    const daySection = csv.slice(csv.indexOf('Day by day'), csv.indexOf('By branch'));
    expect(daySection).toContain('Date,Day,Visits,Corrections answered');
    expect(daySection).toContain('2026-10-11,Sun 11 Oct,0,0');
    expect(daySection).toContain('2026-10-12,Mon 12 Oct,1,0');
    expect(daySection).toContain('2026-10-16,Fri 16 Oct,2,1');
    expect(daySection).toContain('2026-10-17,Sat 17 Oct,0,0');
  });

  it('serializes the per-branch, reviewer and request sections', () => {
    const csv = deskReportToCsv(report, { organizationName: 'O', scopeLabel: 'S' });
    expect(csv).toContain('Branch,Visits,Corrections answered,Reviewers,Requests,Last visit (UTC)');
    expect(csv).toContain('MBUMAH HARDWARE - Juja Main,2,1,1,2,');
    expect(csv).toContain('Name,Visits,Corrections answered,Branches,Last visit (UTC)');
    expect(csv).toContain('System Administrator,2,1,1,');
    expect(csv).toContain('Employee,Leave type,Branch,Status,Visits,Last visit (UTC)');
    expect(csv).toContain('David Otieno,Sick Leave,MBUMAH HARDWARE - Juja Main,PENDING,1,');
    expect(csv).toContain('Grace Achieng,Annual Leave,MBUMAH HARDWARE - Nakuru Branch,APPROVED,1,');
  });

  it('guards the formula-injection class through the shared escaper', () => {
    const evil = deriveDeskReport(
      [row({
        visitedByName: '=HYPERLINK("http://evil")',
        leaveRequest: {
          status: 'PENDING', storeId: 'store-evil',
          store: { name: '+cmd|\' /C calc\'!A0' },
          employee: { firstName: 'A', lastName: 'B' },
          leaveType: { name: 'Leave' },
        },
      })],
      win7,
    );
    const csv = deskReportToCsv(evil, { organizationName: 'O', scopeLabel: 'S' });
    // The guard prefixes the apostrophe (leading only), then RFC-4180
    // quoting wraps the cell and doubles the inner quotes:
    // "'=HYPERLINK(""http://evil"")"
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(csv).toContain("'+cmd|' /C calc'!A0");
  });

  it('quotes cells that carry commas (RFC-4180)', () => {
    const csv = deskReportToCsv(
      deriveDeskReport([row({ leaveRequest: { status: 'PENDING', storeId: 's', store: { name: 'Juja, Main' }, employee: { firstName: 'A', lastName: 'B' }, leaveType: { name: 'Leave' } } })], win7),
      { organizationName: 'O', scopeLabel: 'S' },
    );
    expect(csv).toContain('"Juja, Main",1,');
  });

  it('uses CRLF records and ends with a trailing CRLF', () => {
    const csv = deskReportToCsv(report, { organizationName: 'O', scopeLabel: 'S' });
    expect(csv).toContain('\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.slice(-2)).not.toBe('\n\n');
  });

  it('files a quiet window honestly (header + zero series, no crash)', () => {
    const quiet = deriveDeskReport([], win7);
    const csv = deskReportToCsv(quiet, { organizationName: 'O', scopeLabel: 'All branches' });
    expect(csv).toContain('Visits,0');
    expect(csv).toContain('2026-10-11,Sun 11 Oct,0,0');
    expect(csv).not.toContain('MBUMAH HARDWARE - Juja Main,');
  });
});

describe('deskReportCsvFilename - filenames tell the truth', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };

  it('carries the window length, bounds and org-wide scope', () => {
    const report = deriveDeskReport([], win7);
    const payload = { ...report, generatedAt: now.toISOString(), scope: { branch: null, branchName: null } };
    expect(deskReportCsvFilename(payload)).toBe('mbumah-desk-report-7d-2026-10-11_2026-10-17-all-branches.csv');
  });

  it('uses the branch slug when narrowed', () => {
    const report = deriveDeskReport([], win7);
    const payload = { ...report, generatedAt: now.toISOString(), scope: { branch: 'store_juja_main', branchName: 'MBUMAH HARDWARE - Juja Main' } };
    expect(deskReportCsvFilename(payload)).toBe('mbumah-desk-report-7d-2026-10-11_2026-10-17-store-juja-main.csv');
  });
});

describe('GET /api/org/desk-report - the CSV voice (v2.70.0)', () => {
  const RT = readRepo('src/app/api/org/desk-report/route.ts');

  it('serves ?format=csv through the shared builder', () => {
    expect(RT).toContain("url.searchParams.get('format') === 'csv'");
    expect(RT).toContain('deskReportToCsv(data, {');
    expect(RT).toContain('deskReportCsvFilename(data)');
  });

  it('stamps text/csv + attachment disposition + no-store', () => {
    expect(RT).toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(RT).toMatch(/'Content-Disposition': `attachment; filename="\$\{deskReportCsvFilename\(data\)\}"`/);
    expect(RT).toContain("'Cache-Control': 'no-store'");
  });

  it('resolves the organization name with the digest fallback', () => {
    expect(RT).toContain('rawDb.organization.findFirst({ select: { name: true } })');
    expect(RT).toContain("?? 'MBUMAH Hardware'");
  });

  it('stays READ-ONLY and keeps JSON the default voice', () => {
    expect(RT).not.toContain('createMany');
    expect(RT).toContain('scopeLabel: branchName ? `Branch: ${branchName}` : \'All branches\'');
    expect(RT).toMatch(/return Response\.json\(\{\s*success: true,\s*data,\s*\}\);/);
  });
});

describe('DeskReportView - the CSV button (v2.70.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('downloads through ?format=csv with the session cookie', () => {
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("&format=csv`");
    expect(VIEW).toMatch(/fetch\(`\/api\/org\/desk-report\$\{query\}`, \{ credentials: 'include' \}\)/);
  });

  it('honors the route-stamped filename and cleans up the object URL', () => {
    expect(VIEW).toMatch(/\/filename="(.+?)"\/\.exec\(disposition\)/);
    expect(VIEW).toContain('URL.createObjectURL(blob)');
    expect(VIEW).toContain('URL.revokeObjectURL(href)');
  });

  it('degrades honestly and keeps the busy state', () => {
    expect(VIEW).toContain('Desk report CSV unavailable.');
    expect(VIEW).toMatch(/disabled=\{csvBusy\}/);
    expect(VIEW).toContain('Filing…');
  });

  it('keeps the CSV button out of the print clone', () => {
    const toolbar = VIEW.slice(VIEW.indexOf('print:hidden'), VIEW.indexOf('desk-report-error'));
    expect(toolbar).toContain('desk-report-csv');
  });
});

// ── 7. the drill-down ledger (v2.71.0) ──────────────────────────────────────

describe('deriveDeskReport - the drill-down ledger (v2.71.0)', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };

  it('derives one entry per row, mapped UI-ready, in the same pass', () => {
    const report = deriveDeskReport(
      [
        row({ visitedByName: 'Grace Achieng', clearedRecheck: true }),
        row({ visitedByName: 'System Administrator' }),
      ],
      win7,
    );
    expect(report.ledger).toHaveLength(2);
    expect(report.totals.visits).toBe(report.ledger.length);
    const first = report.ledger[0];
    expect(first.id).toMatch(/^visit-/);
    expect(first.dayKey).toBe('2026-10-16');
    expect(first.storeId).toBe('store-juja');
    expect(first.storeName).toBe('MBUMAH HARDWARE - Juja Main');
    expect(first.employeeName).toBe('David Otieno');
    expect(first.leaveTypeName).toBe('Sick Leave');
    expect(first.status).toBe('PENDING');
    expect(first.requestId).toMatch(/^req-/);
    const cleared = report.ledger.find((e) => e.cleared);
    expect(cleared?.reviewer).toBe('Grace Achieng');
  });

  it('orders the ledger newest first regardless of input order', () => {
    const report = deriveDeskReport(
      [
        row({ id: 'visit-old', createdAt: new Date(Date.UTC(2026, 9, 12, 6, 0, 0)) }),
        row({ id: 'visit-new', createdAt: new Date(Date.UTC(2026, 9, 16, 12, 0, 0)) }),
        row({ id: 'visit-mid', createdAt: new Date(Date.UTC(2026, 9, 14, 9, 0, 0)) }),
      ],
      win7,
    );
    expect(report.ledger.map((e) => e.id)).toEqual(['visit-new', 'visit-mid', 'visit-old']);
  });

  it('breaks exact ties deterministically by id (never db-order dependent)', () => {
    const same = new Date(Date.UTC(2026, 9, 16, 7, 0, 0));
    const report = deriveDeskReport(
      [row({ id: 'visit-b', createdAt: same }), row({ id: 'visit-a', createdAt: same })],
      win7,
    );
    expect(report.ledger.map((e) => e.id)).toEqual(['visit-a', 'visit-b']);
  });

  it('an empty window derives an honest empty ledger', () => {
    const report = deriveDeskReport([], win7);
    expect(report.ledger).toEqual([]);
  });

  it('falls back honestly: no store name → the store id; no leave type → Leave', () => {
    const report = deriveDeskReport(
      [
        row({
          leaveRequest: {
            status: 'PENDING',
            storeId: 'store-raw-id',
            store: null,
            employee: { firstName: 'Ada', lastName: 'Wanjiku' },
            leaveType: null,
          },
        }),
      ],
      win7,
    );
    expect(report.ledger[0].storeName).toBe('store-raw-id');
    expect(report.ledger[0].leaveTypeName).toBe('Leave');
  });
});

describe('deskReportReviewerLedger + deskReportVisitTime (v2.71.0)', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };

  it('filters one reviewer out of the ledger, preserving the newest-first order', () => {
    const report = deriveDeskReport(
      [
        row({ id: 'v1', visitedByName: 'Grace Achieng', createdAt: new Date(Date.UTC(2026, 9, 12, 6, 0, 0)) }),
        row({ id: 'v2', visitedByName: 'System Administrator', createdAt: new Date(Date.UTC(2026, 9, 13, 6, 0, 0)) }),
        row({ id: 'v3', visitedByName: 'Grace Achieng', createdAt: new Date(Date.UTC(2026, 9, 16, 6, 0, 0)) }),
      ],
      win7,
    );
    const grace = deskReportReviewerLedger(report.ledger, 'Grace Achieng');
    expect(grace.map((e) => e.id)).toEqual(['v3', 'v1']);
    expect(grace.every((e) => e.reviewer === 'Grace Achieng')).toBe(true);
    expect(deskReportReviewerLedger(report.ledger, 'Nobody')).toEqual([]);
  });

  it('reads the EAT wall clock, not a UTC slice (07:00Z is 10:00 in Nairobi)', () => {
    expect(deskReportVisitTime('2026-10-16T07:00:00.000Z')).toBe('10:00');
    expect(deskReportVisitTime('2026-10-16T21:00:00.000Z')).toBe('00:00'); // next day EAT
  });
});

describe('GET /api/org/desk-report - the ledger rides the payload (v2.71.0)', () => {
  const RT = readRepo('src/app/api/org/desk-report/route.ts');

  it('selects the visit id so the ledger can key its rows', () => {
    expect(RT).toContain('id: true,');
    expect(RT).toContain('the visit\'s own id rides along');
  });

  it('keeps JSON the default voice, the CSV voice untouched, and READ-ONLY', () => {
    expect(RT).toMatch(/return Response\.json\(\{\s*success: true,\s*data,\s*\}\);/);
    expect(RT).toContain("url.searchParams.get('format') === 'csv'");
    expect(RT).not.toContain('createMany');
  });
});

describe('DeskReportView - the reviewer drill-down (v2.71.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('imports the ledger helpers and the chevron', () => {
    expect(VIEW).toContain('deskReportReviewerLedger,');
    expect(VIEW).toContain('deskReportVisitTime,');
    expect(VIEW).toContain('deskReportDayLabel,');
    expect(VIEW).toContain('ChevronDown,');
  });

  it('toggles one drawer at a time and closes it on a scope change', () => {
    expect(VIEW).toContain('const toggleReviewer = (name: string)');
    expect(VIEW).toContain('setOpenReviewer((cur) => (cur === name ? null : name));');
    const pickDays = VIEW.split('const pickDays =')[1].split('const pickBranch =')[0];
    const pickBranch = VIEW.split('const pickBranch =')[1].split('const toggleReviewer =')[0];
    // v2.74.0 — scope changes go through the shared reset (drawers + memory).
    expect(pickDays).toContain('clearDrawers();');
    expect(pickBranch).toContain('clearDrawers();');
  });

  it('exposes the door semantics (aria-expanded + testids)', () => {
    expect(VIEW).toContain('aria-expanded={open}');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-panel"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-visits"');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-visit"');
  });

  it('renders visit rows with day + EAT time, branch, request, chips', () => {
    expect(VIEW).toContain('{deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT');
    expect(VIEW).toContain('{deskReportShortStoreName(v.storeName)}');
    expect(VIEW).toContain("{v.employeeName}&apos;s {v.leaveTypeName}");
    expect(VIEW).toContain('recheck cleared');
    expect(VIEW).toContain('REPORT_STATUS_CHIP[v.status] ?? STATUS_CHIP_FALLBACK');
  });

  it('stays honest: count line, empty state, rotating chevron', () => {
    expect(VIEW).toContain('in this window');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-empty"');
    expect(VIEW).toContain('No visits recorded for this reviewer in this window.');
    expect(VIEW).toContain('rotate-180');
  });

  it('keeps the drawer off the paper and hints the interaction on screen', () => {
    const panel = VIEW.split('data-testid="desk-report-reviewer-panel"')[1].split('data-testid="desk-report-reviewer-visits"')[0];
    expect(panel).toContain('print:hidden');
    expect(VIEW).toContain('click a reviewer to read their visits');
  });

  it('wears the emerald family in dark mode', () => {
    expect(VIEW).toContain('dark:border-emerald-500/20 dark:bg-emerald-500/5');
    expect(VIEW).toContain('dark:bg-slate-900/60');
  });
});

describe('release metadata - v2.71.0', () => {
  it('leads What\'s-New with the drill-down story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.71.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.71.0'")).toBeLessThan(WN.indexOf("version: '2.70.0'"));
    expect(WN).toContain('The report opens its ledger');
    expect(WN).toMatch(/newest first/);
    expect(WN).toMatch(/print:hidden|never reaches paper/i);
  });

  it('bumps package.json to at least 2.71.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.71.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.71.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.71.0')).toBe(true);
    expect(PKG.scripts['verify:v2-71-0']).toBe('node scripts/verify-v2-71-0.mjs');
  });

  it('keeps the prior report surfaces intact (CSV voice, panel door, print)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    const PANELS = readRepo('src/components/org/panels.tsx');
    expect(PANELS).toContain('data-testid="desk-report-link"');
    const MOD = readRepo('src/lib/hr/desk-report.ts');
    expect(MOD).toContain("row(['Report', 'Desk report']);");
  });
});

// ── 8. the request drill-down (v2.72.0) ─────────────────────────────────────

describe('deskReportRequestLedger - the report reads the file (v2.72.0)', () => {
  const now = new Date('2026-10-17T14:00:00Z');
  const win7 = { ...deskReportWindow(now, 7), days: 7 };

  it('filters one request out of the ledger, preserving the newest-first order', () => {
    const report = deriveDeskReport(
      [
        row({ id: 'v1', leaveRequestId: 'req-a', createdAt: new Date(Date.UTC(2026, 9, 12, 6, 0, 0)) }),
        row({ id: 'v2', leaveRequestId: 'req-b', createdAt: new Date(Date.UTC(2026, 9, 13, 6, 0, 0)) }),
        row({ id: 'v3', leaveRequestId: 'req-a', createdAt: new Date(Date.UTC(2026, 9, 16, 6, 0, 0)) }),
      ],
      win7,
    );
    const fileA = deskReportRequestLedger(report.ledger, 'req-a');
    expect(fileA.map((e) => e.id)).toEqual(['v3', 'v1']);
    expect(fileA.every((e) => e.requestId === 'req-a')).toBe(true);
    expect(deskReportRequestLedger(report.ledger, 'req-unknown')).toEqual([]);
  });

  it('keeps every visit fact the drawer needs (reviewer, branch, day, cleared)', () => {
    const report = deriveDeskReport(
      [
        row({
          id: 'v1', leaveRequestId: 'req-a', visitedByName: 'Grace Achieng', clearedRecheck: true,
          createdAt: new Date(Date.UTC(2026, 9, 15, 9, 30, 0)),
        }),
      ],
      win7,
    );
    const [entry] = deskReportRequestLedger(report.ledger, 'req-a');
    expect(entry.reviewer).toBe('Grace Achieng');
    expect(entry.cleared).toBe(true);
    expect(entry.dayKey).toBe('2026-10-15'); // 12:30 EAT, Thu 15 Oct
    expect(entry.storeName).toBe('MBUMAH HARDWARE - Juja Main');
  });

  it('agrees with the request roll-up by construction (same ledger)', () => {
    const report = deriveDeskReport(
      [
        row({ id: 'v1', leaveRequestId: 'req-a', createdAt: new Date(Date.UTC(2026, 9, 12, 6, 0, 0)) }),
        row({ id: 'v2', leaveRequestId: 'req-a', createdAt: new Date(Date.UTC(2026, 9, 13, 6, 0, 0)) }),
        row({ id: 'v3', leaveRequestId: 'req-b', createdAt: new Date(Date.UTC(2026, 9, 14, 6, 0, 0)) }),
      ],
      win7,
    );
    const hot = report.topRequests[0];
    expect(hot.visits).toBe(2);
    expect(deskReportRequestLedger(report.ledger, hot.requestId)).toHaveLength(2);
  });
});

describe('DeskReportView - the request drill-down (v2.72.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('imports the request ledger helper', () => {
    expect(VIEW).toContain('deskReportRequestLedger,');
  });

  it('holds ONE drawer across both families (a request door closes the reviewer drawer and vice versa)', () => {
    const toggleReviewer = VIEW.split('const toggleReviewer =')[1].split('const toggleRequest =')[0];
    const toggleRequest = VIEW.split('const toggleRequest =')[1].split('  // v2.70.0')[0];
    expect(toggleReviewer).toContain('setOpenRequest(null);');
    expect(toggleRequest).toContain('setOpenReviewer(null);');
    expect(toggleRequest).toContain('setOpenRequest((cur) => (cur === id ? null : id));');
  });

  it('closes BOTH drawers on a scope change (window + branch)', () => {
    const pickDays = VIEW.split('const pickDays =')[1].split('const pickBranch =')[0];
    const pickBranch = VIEW.split('const pickBranch =')[1].split('  // v2.71.0')[0];
    // v2.74.0 — the shared reset closes both drawers and clears the memory.
    expect(pickDays).toContain('clearDrawers();');
    expect(pickBranch).toContain('clearDrawers();');
    const reset = VIEW.split('const clearDrawers = useCallback(() => {')[1].split('const toggleReviewer =')[0]; // memoized since v2.76.0
    expect(reset).toContain('setOpenReviewer(null);');
    expect(reset).toContain('setOpenRequest(null);');
  });

  it('exposes the request door semantics (aria-expanded + testids)', () => {
    expect(VIEW).toContain('data-testid="desk-report-request-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-request-panel"');
    expect(VIEW).toContain('data-testid="desk-report-request-visits"');
    expect(VIEW).toContain('data-testid="desk-report-request-visit"');
    const door = VIEW.split('const open = openRequest === r.requestId;')[1].split('data-testid="desk-report-request-toggle"')[0];
    expect(door).toContain('aria-expanded={open}');
  });

  it('renders request visit rows with day + EAT time, branch, reviewer door, cleared chip', () => {
    expect(VIEW).toContain('visited by{\' \'}');
    const visits = VIEW.split('data-testid="desk-report-request-visits"')[1].split('</ul>')[0];
    expect(visits).toContain('{deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT');
    expect(visits).toContain('{deskReportShortStoreName(v.storeName)}');
    expect(visits).toContain('recheck cleared');
    // v2.74.0 — the reviewer the row names is a door now.
    expect(visits).toContain('data-testid="desk-report-request-visit-reviewer"');
    expect(visits).toContain('jumpToReviewer(v.reviewer, r.requestId)');
  });

  it('stays honest: count line names the request, empty state instead of pretending', () => {
    expect(VIEW).toContain("&apos;s {r.leaveTypeName} · {num(visits.length)} visit{visits.length === 1 ? '' : 's'} in this window");
    expect(VIEW).toContain('data-testid="desk-report-request-empty"');
    expect(VIEW).toContain('No visits recorded for this request in this window.');
  });

  it('keeps the drawer off the paper and hints the interaction on screen', () => {
    const panel = VIEW.split('data-testid="desk-report-request-panel"')[1].split('data-testid="desk-report-request-visits"')[0];
    expect(panel).toContain('print:hidden');
    expect(VIEW).toContain('click a request to read its visits');
  });

  it('wears the same emerald family in dark mode as the reviewer drawer', () => {
    const panel = VIEW.split('data-testid="desk-report-request-panel"')[1].split('data-testid="desk-report-request-visits"')[0];
    expect(panel).toContain('dark:border-emerald-500/20 dark:bg-emerald-500/5');
    const visits = VIEW.split('data-testid="desk-report-request-visits"')[1].split('</ul>')[0];
    expect(visits).toContain('dark:bg-slate-900/60');
  });
});

describe('release metadata - v2.72.0', () => {
  it('leads What\'s-New with the request-drill-down story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.72.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.72.0'")).toBeLessThan(WN.indexOf("version: '2.71.0'"));
    expect(WN).toContain('The report reads the file');
    expect(WN).toMatch(/One drawer at a time across the whole report/);
    expect(WN).toMatch(/never reaches paper/i);
  });

  it('bumps package.json to at least 2.72.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.72.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.72.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.72.0')).toBe(true);
    expect(PKG.scripts['verify:v2-72-0']).toBe('node scripts/verify-v2-72-0.mjs');
  });

  it('keeps the prior report surfaces intact (reviewer drawer, CSV voice, panel door)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    const MOD = readRepo('src/lib/hr/desk-report.ts');
    expect(MOD).toContain('export function deskReportRequestLedger(');
    expect(MOD).toContain('export function deskReportReviewerLedger(');
  });
});

// ── 9. the cross-links (v2.74.0) ─────────────────────────────────────────────

describe('deskReportRequestSubject - the file behind a reviewer row (v2.74.0)', () => {
  const LEDGER: DeskReportVisitEntry[] = [
    {
      id: 'visit-newest', at: '2026-10-17T09:15:00.000Z', dayKey: '2026-10-17',
      storeId: 'store-juja', storeName: 'MBUMAH HARDWARE - Juja Main',
      reviewer: 'Grace Wanjiku', employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
      status: 'PENDING', cleared: false, requestId: 'req-1',
    },
    {
      id: 'visit-older', at: '2026-10-16T09:15:00.000Z', dayKey: '2026-10-16',
      storeId: 'store-juja', storeName: 'MBUMAH HARDWARE - Juja Main',
      reviewer: 'Peter Kimani', employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
      status: 'PENDING', cleared: true, requestId: 'req-1',
    },
    {
      id: 'visit-other', at: '2026-10-15T10:00:00.000Z', dayKey: '2026-10-15',
      storeId: 'store-nak', storeName: 'MBUMAH HARDWARE - Nakuru Branch',
      reviewer: 'Grace Wanjiku', employeeName: 'Mary Achieng', leaveTypeName: 'Annual Leave',
      status: 'APPROVED', cleared: false, requestId: 'req-2',
    },
  ];

  it('recovers the human title of a request from its own ledger entries', () => {
    expect(deskReportRequestSubject(LEDGER, 'req-1')).toEqual({
      employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
    });
    expect(deskReportRequestSubject(LEDGER, 'req-2')).toEqual({
      employeeName: 'Mary Achieng', leaveTypeName: 'Annual Leave',
    });
  });

  it('entries of one request share the subject - the first match answers', () => {
    const a = deskReportRequestSubject(LEDGER, 'req-1');
    const again = deskReportRequestSubject([LEDGER[1], LEDGER[0]], 'req-1');
    expect(a).toEqual(again);
  });

  it('stays honest: unknown request ids derive to null, never a guess', () => {
    expect(deskReportRequestSubject(LEDGER, 'req-404')).toBeNull();
    expect(deskReportRequestSubject([], 'req-1')).toBeNull();
  });

  it('reads without disturbing the ledger (the newest-first order is sacred)', () => {
    const frozen = Object.freeze([...LEDGER]) as readonly DeskReportVisitEntry[];
    deskReportRequestSubject(frozen, 'req-1');
    expect(frozen[0].id).toBe('visit-newest');
    expect(frozen[2].id).toBe('visit-other');
  });
});

describe('deskReportHasRequestDoor - a door is promised only where one exists (v2.74.0)', () => {
  const TOP = [
    { requestId: 'req-1', visits: 7 },
    { requestId: 'req-2', visits: 3 },
  ] as const;

  it('a request on the most-visited list has a drawer beneath it', () => {
    expect(deskReportHasRequestDoor(TOP, 'req-1')).toBe(true);
    expect(deskReportHasRequestDoor(TOP, 'req-2')).toBe(true);
  });

  it('a file outside the capped digest stays text - no broken promise', () => {
    expect(deskReportHasRequestDoor(TOP, 'req-404')).toBe(false);
    expect(deskReportHasRequestDoor([], 'req-1')).toBe(false);
  });

  it('answers by identity, not by position (order-independent)', () => {
    expect(deskReportHasRequestDoor([{ requestId: 'req-9' }, { requestId: 'req-1' }], 'req-1')).toBe(true);
  });
});

describe('DeskReportView - the drawers talk to each other (v2.74.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('imports the cross-link helpers and the jump affordance icons', () => {
    expect(VIEW).toContain('deskReportHasRequestDoor,');
    expect(VIEW).toContain('deskReportRequestSubject,');
    expect(VIEW).toContain('ArrowUpRight');
    expect(VIEW).toContain('CornerUpLeft');
  });

  it('holds the two jump handlers alongside the toggles', () => {
    expect(VIEW).toContain('const jumpToReviewer = (name: string, fromRequestId: string) => {');
    expect(VIEW).toContain('const jumpToRequest = (id: string, fromReviewer: string) => {');
  });

  it('a jump obeys the one-drawer rule: the other family closes first', () => {
    const jumpToReviewer = VIEW.split('const jumpToReviewer =')[1].split('const jumpToRequest =')[0];
    const jumpToRequest = VIEW.split('const jumpToRequest =')[1].split('const jumpBackToReviewer =')[0];
    expect(jumpToReviewer).toContain('setOpenRequest(null);');
    expect(jumpToReviewer).toContain('setOpenReviewer(name);');
    expect(jumpToRequest).toContain('setOpenReviewer(null);');
    expect(jumpToRequest).toContain('setOpenRequest(id);');
  });

  it('a jump remembers where it came from (the via state is set, the opposite cleared)', () => {
    const jumpToReviewer = VIEW.split('const jumpToReviewer =')[1].split('const jumpToRequest =')[0];
    const jumpToRequest = VIEW.split('const jumpToRequest =')[1].split('const jumpBackToReviewer =')[0];
    expect(jumpToReviewer).toContain('setViaReviewer(fromRequestId);');
    expect(jumpToReviewer).toContain('setViaRequest(null);');
    expect(jumpToRequest).toContain('setViaRequest(fromReviewer);');
    expect(jumpToRequest).toContain('setViaReviewer(null);');
  });

  it('the way back: one click on the via chip returns, and the memory clears', () => {
    expect(VIEW).toContain('const jumpBackToReviewer = () => {');
    expect(VIEW).toContain('const jumpBackToRequest = () => {');
    const backToRequest = VIEW.split('const jumpBackToRequest =')[1].split('// v2.70.0')[0];
    expect(backToRequest).toContain('if (!viaReviewer) return;');
    expect(backToRequest).toContain('setViaReviewer(null);');
    expect(backToRequest).toContain('setOpenRequest(id);');
  });

  it('plain toggles clear the memory - a via chip never survives a manual open', () => {
    const toggleReviewer = VIEW.split('const toggleReviewer =')[1].split('// v2.72.0 — the report reads the file')[0];
    const toggleRequest = VIEW.split('const toggleRequest =')[1].split('// v2.74.0 — the cross-links')[0];
    expect(toggleReviewer).toContain('setViaRequest(null);');
    expect(toggleReviewer).toContain('setViaReviewer(null);');
    expect(toggleRequest).toContain('setViaRequest(null);');
    expect(toggleRequest).toContain('setViaReviewer(null);');
  });

  it('scope changes reset the whole cross-link state (drawers + memory)', () => {
    const clearDrawers = VIEW.split('const clearDrawers = useCallback(() => {')[1].split('const toggleReviewer =')[0]; // memoized since v2.76.0
    expect(clearDrawers).toContain('setOpenReviewer(null);');
    expect(clearDrawers).toContain('setOpenRequest(null);');
    expect(clearDrawers).toContain('setViaRequest(null);');
    expect(clearDrawers).toContain('setViaReviewer(null);');
    const pickDays = VIEW.split('const pickDays =')[1].split('const pickBranch =')[0];
    const pickBranch = VIEW.split('const pickBranch =')[1].split('// v2.71.0')[0];
    expect(pickDays).toContain('clearDrawers();');
    expect(pickBranch).toContain('clearDrawers();');
  });

  it('request visit rows open the reviewer they name (with the hue echo)', () => {
    const door = VIEW.split('data-testid="desk-report-request-visit-reviewer"')[1].split('</button>')[0];
    expect(door).toContain('{v.reviewer}');
    expect(door).toContain('deskReportAvatarHue(v.reviewer)');
    expect(door).toContain('ArrowUpRight');
    expect(VIEW).toContain('onClick={() => jumpToReviewer(v.reviewer, r.requestId)}');
    expect(VIEW).toContain("aria-label={`Open ${v.reviewer}'s visits`}");
  });

  it('reviewer visit rows open the file they name - but ONLY when the file has a drawer', () => {
    expect(VIEW).toContain('{deskReportHasRequestDoor(data.topRequests, v.requestId) ? (');
    const guard = VIEW.split('{deskReportHasRequestDoor(data.topRequests, v.requestId) ? (')[1].split(") : (")[0];
    expect(guard).toContain('data-testid="desk-report-reviewer-visit-request"');
    expect(guard).toContain('jumpToRequest(v.requestId, r.name)');
    expect(guard).toContain('ArrowUpRight');
    expect(VIEW).toContain("<>{v.employeeName}&apos;s {v.leaveTypeName}</>");
  });

  it('both drawers wear the via chip, and the chip is the way back', () => {
    const reviewerVia = VIEW.split('data-testid="desk-report-reviewer-via"')[1].split('</button>')[0];
    const requestVia = VIEW.split('data-testid="desk-report-request-via"')[1].split('</button>')[0];
    expect(reviewerVia).toContain('CornerUpLeft');
    expect(reviewerVia).toContain('via {viaBackSubject.employeeName}');
    expect(VIEW).toContain('onClick={jumpBackToRequest}');
    expect(requestVia).toContain('CornerUpLeft');
    expect(requestVia).toContain('via {viaRequest}');
    expect(VIEW).toContain('onClick={jumpBackToReviewer}');
  });

  it('the reviewer via chip reads its label from the SAME ledger (no second read)', () => {
    expect(VIEW).toContain('const viaBackSubject = viaReviewer ? deskReportRequestSubject(data.ledger, viaReviewer) : null;');
  });

  it('the jump language is the drawer\u2019s emerald family, complete in dark mode', () => {
    const door = VIEW.split('data-testid="desk-report-request-visit-reviewer"')[1].split('</button>')[0];
    expect(door).toContain('text-emerald-700');
    expect(door).toContain('dark:text-emerald-300');
    expect(door).toContain('focus-visible:ring-emerald-400');
    const chip = VIEW.split('data-testid="desk-report-request-via"')[1].split('</button>')[0];
    expect(chip).toContain('dark:bg-slate-900/60');
    expect(chip).toContain('dark:hover:bg-emerald-500/15');
    expect(chip).toContain('hover:bg-emerald-100');
  });

  it('the drawers stay off the paper (the cross-links ride panels that never print)', () => {
    const reviewerPanel = VIEW.split('data-testid="desk-report-reviewer-panel"')[1].split('desk-report-reviewer-visits')[0];
    const requestPanel = VIEW.split('data-testid="desk-report-request-panel"')[1].split('desk-report-request-visits')[0];
    expect(reviewerPanel).toContain('print:hidden');
    expect(requestPanel).toContain('print:hidden');
  });

  it('the section hints tell the reader the rows are doors now', () => {
    expect(VIEW).toContain('file names inside a drawer jump across');
    expect(VIEW).toContain('reviewer names inside a drawer jump across');
  });
});

describe('release metadata - v2.74.0', () => {
  it('leads What\'s-New with the cross-links story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.74.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.74.0'")).toBeLessThan(WN.indexOf("version: '2.73.0'"));
    expect(WN).toContain('The drawers talk to each other');
    expect(WN).toMatch(/one click on it takes you straight back/);
    expect(WN).toMatch(/a door is only promised where one exists/i);
  });

  it('bumps package.json to at least 2.74.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.74.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.74.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.74.0')).toBe(true);
    expect(PKG.scripts['verify:v2-74-0']).toBe('node scripts/verify-v2-74-0.mjs');
  });

  it('keeps every prior surface intact (both drawer families, CSV, print, palette jump)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-reviewer-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-request-toggle"');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    const MOD = readRepo('src/lib/hr/desk-report.ts');
    expect(MOD).toContain('export function deskReportRequestLedger(');
    expect(MOD).toContain('export function deskReportReviewerLedger(');
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid={`palette-release-${r.version}`}');
    expect(CHROME).toContain('data-testid="changelog-jump-pill"');
  });
});

// ── the keyboard walks the doors (v2.76.0) ──────────────────────────────────

describe('DeskReportView - the keyboard walks the doors (v2.76.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('every door carries the walk key - rows, cross-links, and via chips (6 of them)', () => {
    expect((VIEW.match(/data-desk-door\n/g) || []).length).toBe(6); // attribute form only (the comment + selector mention it too)
    const anchors = [
      'desk-report-reviewer-toggle',
      'desk-report-reviewer-via',
      'desk-report-reviewer-visit-request',
      'desk-report-request-toggle',
      'desk-report-request-via',
      'desk-report-request-visit-reviewer',
    ];
    for (const a of anchors) {
      const seg = VIEW.split(`data-testid="${a}"`)[1].slice(0, 300);
      expect(seg).toContain('data-desk-door');
    }
  });

  it('binds one document-level keydown listener (and removes it again)', () => {
    expect(VIEW).toContain("document.addEventListener('keydown', onKeyDown);");
    expect(VIEW).toContain("document.removeEventListener('keydown', onKeyDown);");
  });

  it('j is next, k is previous, and both wrap - including the cold start from nowhere', () => {
    const handler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1].split('    };')[0];
    expect(handler).toContain("e.key !== 'j' && e.key !== 'k'");
    expect(handler).toContain("e.key === 'j' ? 0 : doors.length - 1"); // cold start (v2.77.0 index form)
    expect(handler).toContain("(idx + 1) % doors.length");
    expect(handler).toContain("(idx - 1 + doors.length) % doors.length");
    expect(handler).toContain('next.focus({ preventScroll: true })'); // smooth scroll took over the jump (v2.77.0)
    expect(handler).toContain('e.preventDefault()');
  });

  it('stays out of the way: no modifiers, never inside an input', () => {
    const handler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1].split('    };')[0];
    expect(handler).toContain('e.metaKey || e.ctrlKey || e.altKey');
    expect(handler).toContain('target.closest(\'input, textarea, select, [contenteditable="true"]\')');
  });

  it('escape closes the open drawer and its via memory (the shared reset)', () => {
    const handler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1].split('    };')[0];
    expect(handler).toContain("if (e.key === 'Escape')");
    expect(handler).toContain('clearDrawers();');
  });

  it('the keyboard hint lives at the footnote - screen only, never on paper', () => {
    const hint = VIEW.split('data-testid="desk-report-kbd-hint"')[1].split('</span>')[0];
    expect(hint).toContain('hidden');
    expect(hint).toContain('sm:flex');
    expect(hint).toContain('print:hidden');
    expect(hint).toContain('walk the doors');
    expect(hint).toContain('closes a drawer');
    // v2.78.0 — the hint grew the chips' keys (arrows + enter): six chips now.
    expect(hint).toContain('move the chips');
    expect(hint).toContain('re-keys the report');
    expect((hint.match(/<kbd /g) || []).length).toBe(6);
  });

  it('walks in DOM order: reviewers section renders before the most-visited requests', () => {
    expect(VIEW.indexOf('data-testid="desk-report-reviewers"')).toBeLessThan(VIEW.indexOf('data-testid="desk-report-top-requests"'));
  });
});

describe('release metadata - v2.76.0', () => {
  it('bumps package.json to at least 2.76.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.76.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.76.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.76.0')).toBe(true);
    expect(PKG.scripts['verify:v2-76-0']).toBe('node scripts/verify-v2-76-0.mjs');
  });

  it('keeps every prior surface intact (both families, CSV, print, cross-links, palette inbox)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    expect(VIEW).toContain('onClick={() => jumpToReviewer(v.reviewer, r.requestId)}');
    expect(VIEW).toContain('onClick={jumpBackToRequest}');
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid="palette-mark-all-read"');
    expect(CHROME).toContain('data-testid={`palette-release-${r.version}`}');
  });
});

// ── the walk can be followed (v2.77.0) ──────────────────────────────────────

describe('DeskReportView - the walk can be followed (v2.77.0)', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('the walk glides: focus without the jump, then a smooth nearest-edge scroll', () => {
    const handler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1].split('    };')[0];
    expect(handler).toContain('next.focus({ preventScroll: true })');
    expect(handler).toContain("next.scrollIntoView({ block: 'nearest', behavior: 'smooth' })");
  });

  it('an aria-live announcer exists, mounted unconditionally at the root', () => {
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('role="status"');
    expect(VIEW).toContain('aria-live="polite"');
    expect(VIEW).toContain('className="sr-only"');
    const announcer = VIEW.split('data-testid="desk-report-walk-announcer"')[1].split('</span>')[0];
    expect(announcer).toContain('{walkAnnouncement}');
    // mounted before any conditional content: it sits directly in the root div
    // (v2.78.0 re-anchored: the mount comment grew, and the scope announcer
    // joins AFTER the walk announcer — the walk keeps the first slot)
    const root = VIEW.split('mx-auto w-full max-w-5xl px-4 py-6')[1].split('data-testid="desk-report-walk-announcer"')[0];
    expect(root.length).toBeLessThan(700);
  });

  it('every j/k move is named: position and label from the door itself', () => {
    const handler = VIEW.split('const onKeyDown = (e: KeyboardEvent) => {')[1].split('    };')[0];
    expect(handler).toContain('announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`)');
    expect(handler).toContain("next.getAttribute('aria-label') ?? next.textContent?.trim() ?? 'door'");
  });

  it('the rows that own drawers carry their identity for focus restoration', () => {
    const reviewerToggle = VIEW.split('data-testid="desk-report-reviewer-toggle"')[1].split('</button>')[0];
    expect(reviewerToggle).toContain('data-reviewer-name={r.name}');
    const requestToggle = VIEW.split('data-testid="desk-report-request-toggle"')[1].split('</button>')[0];
    expect(requestToggle).toContain('data-request-id={r.requestId}');
    expect(requestToggle).toContain("data-desk-row-label={`${r.employeeName}'s ${r.leaveTypeName}`}");
  });

  it('escape restores focus to the row that owned the drawer (APG dialog pattern)', () => {
    const escape = VIEW.split("if (e.key === 'Escape') {")[1].split('        return;')[0];
    expect(escape).toContain('const wasReviewer = openReviewer;');
    expect(escape).toContain('const wasRequest = openRequest;');
    expect(escape).toContain('if (!wasReviewer && !wasRequest) return; // nothing open: silence is honest');
    expect(escape).toContain('clearDrawers();');
    expect(escape).toContain('requestAnimationFrame(');
    expect(escape).toContain('data-reviewer-name="${CSS.escape(wasReviewer)}"');
    expect(escape).toContain('data-request-id="${CSS.escape(wasRequest)}"');
    expect(escape).toContain("row.focus({ preventScroll: true })");
    expect(escape).toContain("row.getAttribute('data-desk-row-label')");
  });

  it('the escape announcement names the place, and the effect reads the drawer state live', () => {
    expect(VIEW).toContain('Drawer closed — back on ${row.getAttribute(\'data-desk-row-label\') ?? \'its row\'}.');
    expect(VIEW).toContain('[clearDrawers, openReviewer, openRequest]');
  });
});

describe('release metadata - v2.77.0', () => {
  it('bumps package.json to at least 2.77.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.77.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.77.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.77.0')).toBe(true);
    expect(PKG.scripts['verify:v2-77-0']).toBe('node scripts/verify-v2-77-0.mjs');
  });

  it('keeps every prior surface intact (walk, doors, announcer predecessor, shortcuts rows)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-desk-door');
    expect(VIEW).toContain('data-testid="desk-report-kbd-hint"');
    expect((VIEW.match(/data-desk-door\n/g) || []).length).toBe(6);
    const CHROME = readRepo('src/components/org/chrome.tsx');
    expect(CHROME).toContain('data-testid="palette-mark-all-read"');
    expect(CHROME).toContain("['j', 'Desk report: walk to the next door']");
  });
});

// ── v2.78.0 — the scope speaks the keyboard ─────────────────────────────────
// The window and branch chips were mouse-only scope: the walk (j/k) covered
// the doors, but the chips answered neither the arrows nor the announcer.
// v2.78.0 completes the a11y arc: the chips are APG roving groups (arrows
// move, Enter/Space commit, one tab stop per group) and every re-key is
// announced through a second sr-only live region.

describe('v2.78.0 - the roving step (pure module)', () => {
  it('arrows move forward, wrapping at the end', () => {
    expect(deskReportChipStep('ArrowRight', 0, 3)).toBe(1);
    expect(deskReportChipStep('ArrowRight', 2, 3)).toBe(0); // wrap
    expect(deskReportChipStep('ArrowDown', 1, 3)).toBe(2);
  });

  it('arrows move back, wrapping to the end', () => {
    expect(deskReportChipStep('ArrowLeft', 2, 3)).toBe(1);
    expect(deskReportChipStep('ArrowLeft', 0, 3)).toBe(2); // wrap
    expect(deskReportChipStep('ArrowUp', 1, 3)).toBe(0);
  });

  it('Home and End jump to the ends', () => {
    expect(deskReportChipStep('Home', 2, 3)).toBe(0);
    expect(deskReportChipStep('End', 0, 3)).toBe(2);
  });

  it('keys that are not the group\'s business move nothing', () => {
    expect(deskReportChipStep('Enter', 0, 3)).toBeNull();
    expect(deskReportChipStep('Tab', 0, 3)).toBeNull();
    expect(deskReportChipStep('j', 0, 3)).toBeNull();
  });

  it('a focus outside the group (or an empty group) moves nothing', () => {
    expect(deskReportChipStep('ArrowRight', -1, 3)).toBeNull();
    expect(deskReportChipStep('ArrowRight', 3, 3)).toBeNull();
    expect(deskReportChipStep('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('v2.78.0 - the re-key sentence (pure module)', () => {
  it('a window re-key names the window', () => {
    expect(deskReportScopeAnnouncement('window', '14 days')).toBe('Window: 14 days — report re-keyed.');
  });

  it('a branch re-key names the branch', () => {
    expect(deskReportScopeAnnouncement('branch', 'MBUMAH HARDWARE - Juja Main')).toBe('Branch: MBUMAH HARDWARE - Juja Main — report re-keyed.');
  });

  it('clearing the scope is its own honest sentence, not a branch with an empty name', () => {
    expect(deskReportScopeAnnouncement('branch', null)).toBe('All branches — report re-keyed.');
  });
});

describe('v2.78.0 - the view: the chips answer the arrows', () => {
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('imports both new helpers', () => {
    expect(VIEW).toContain('deskReportChipStep,');
    expect(VIEW).toContain('deskReportScopeAnnouncement,');
  });

  it('the scope announcer is a second sr-only live region beside the walk announcer', () => {
    expect(VIEW).toContain("const [scopeAnnouncement, setScopeAnnouncement] = useState('');");
    const root = VIEW.split('mx-auto w-full max-w-5xl px-4 py-6')[1];
    const walkIdx = root.indexOf('data-testid="desk-report-walk-announcer"');
    const scopeIdx = root.indexOf('data-testid="desk-report-scope-announcer"');
    expect(walkIdx).toBeGreaterThan(-1);
    expect(scopeIdx).toBeGreaterThan(walkIdx);
    const span = root.split('data-testid="desk-report-scope-announcer"')[1].split('</span>')[0];
    expect(span).toContain('role="status"');
    expect(span).toContain('aria-live="polite"');
    expect(span).toContain('sr-only');
  });

  it('pickDays announces the window before re-keying (the no-op guard stays silent)', () => {
    const pick = VIEW.split('const pickDays = (d: number) => {')[1].split('};')[0];
    expect(pick).toContain('if (d === days) return;');
    expect(pick).toContain("setScopeAnnouncement(deskReportScopeAnnouncement('window', WINDOW_LABELS[d] ?? `${d} days`))");
  });

  it('pickBranch announces the named branch, and clearing the scope its own sentence', () => {
    const pick = VIEW.split('const pickBranch = (id: string | null) => {')[1].split('};')[0];
    expect(pick).toContain('if (id === branch) return;');
    expect(pick).toContain("data?.branches.find((b) => b.storeId === id)?.storeName ?? null");
    expect(pick).toContain("setScopeAnnouncement(deskReportScopeAnnouncement('branch', label))");
  });

  it('the chipNav handler walks the sibling chips through the pure step', () => {
    const nav = VIEW.split('const chipNav = (e: React.KeyboardEvent<HTMLButtonElement>) => {')[1].split('  };')[0];
    expect(nav).toContain('const group = e.currentTarget.parentElement;');
    expect(nav).toContain("Array.from(group.querySelectorAll<HTMLButtonElement>('button'))");
    expect(nav).toContain('const next = deskReportChipStep(e.key, idx, chips.length);');
    expect(nav).toContain('if (next === null) return;');
    expect(nav).toContain('e.preventDefault();');
    expect(nav).toContain('chips[next].focus();');
  });

  it('the handler is shared by all three chip families (one JSX anchor per family)', () => {
    expect((VIEW.match(/onKeyDown=\{chipNav\}/g) || []).length).toBe(3);
  });

  it('the window chips wear the roving tabindex (one tab stop, on the active chip)', () => {
    expect(VIEW).toContain('tabIndex={days === d ? 0 : -1}');
  });

  it('the branch chips wear the roving tabindex on both families', () => {
    expect(VIEW).toContain('tabIndex={!branch ? 0 : -1}');
    expect(VIEW).toContain('tabIndex={active ? 0 : -1}');
  });

  it('the footnote hint names the arrows and the commit key', () => {
    const hint = VIEW.split('data-testid="desk-report-kbd-hint"')[1].split('</span>')[0];
    expect(hint).toContain('>←</kbd>');
    expect(hint).toContain('>→</kbd>');
    expect(hint).toContain('>enter</kbd>');
    expect(hint).toContain('move the chips');
  });

  it('the picks ride the same quiet channel: the live regions are for ears, the rings for eyes', () => {
    // Both announcers are sr-only; the chips keep their emerald focus rings.
    const root = VIEW.split('mx-auto w-full max-w-5xl px-4 py-6')[1].split('desk-report-content')[0];
    expect((root.match(/className="sr-only"/g) || []).length).toBe(2);
    expect(VIEW).toContain('focus-visible:ring-2 focus-visible:ring-emerald-400');
  });
});

describe('release metadata - v2.78.0', () => {
  it('bumps package.json to at least 2.78.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.78.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.78.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.78.0')).toBe(true);
    expect(PKG.scripts['verify:v2-78-0']).toBe('node scripts/verify-v2-78-0.mjs');
  });

  it('whats-new 2.78.0 leads the feed with the scope-keyboard story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.78.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.78.0'")).toBeLessThan(WN.indexOf("version: '2.77.0'"));
    expect(WN).toContain('The scope speaks the keyboard');
    expect(WN).toContain('All branches \\u2014 report re-keyed.');
  });

  it('keeps every prior surface intact (walk, announcer, drawers, roving neighbors)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`)');
    expect(VIEW).toContain('const clearDrawers = useCallback(');
    expect((VIEW.match(/data-desk-door\n/g) || []).length).toBe(6);
  });
});

// ── 10. the drawers file themselves (v2.79.0) ────────────────────────────────

describe('deskReportSliceToCsv - the drawer files itself (v2.79.0)', () => {
  const LEDGER: DeskReportVisitEntry[] = [
    {
      id: 'visit-newest', at: '2026-10-17T09:15:00.000Z', dayKey: '2026-10-17',
      storeId: 'store-juja', storeName: 'MBUMAH HARDWARE - Juja Main',
      reviewer: 'Grace Wanjiku', employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
      status: 'PENDING', cleared: false, requestId: 'req-1',
    },
    {
      id: 'visit-older', at: '2026-10-16T21:00:00.000Z', dayKey: '2026-10-17',
      storeId: 'store-nak', storeName: 'MBUMAH HARDWARE - Nakuru Branch',
      reviewer: 'Peter Kimani', employeeName: 'Mary Achieng', leaveTypeName: 'Annual Leave',
      status: 'APPROVED', cleared: true, requestId: 'req-2',
    },
  ];
  const META = { scopeLabel: 'Branch: MBUMAH HARDWARE - Juja Main', windowLabel: 'Fri, 10 Oct → Sat, 17 Oct', windowDays: 7, generatedAt: new Date(Date.UTC(2026, 9, 17, 12, 0, 0)) };

  it('names the slice: report voice, subject, scope, window, generated stamp', () => {
    const csv = deskReportSliceToCsv('reviewer', 'Grace Wanjiku', LEDGER, META);
    const head = csv.split('\r\n').slice(0, 5);
    expect(head[0]).toBe('Report,Desk report — reviewer visits');
    expect(head[1]).toBe('Subject,Grace Wanjiku');
    expect(head[2]).toBe('Scope,Branch: MBUMAH HARDWARE - Juja Main');
    expect(head[3]).toBe('Window,"Fri, 10 Oct → Sat, 17 Oct (7 EAT days)"');
    expect(head[4]).toBe('Generated (UTC),2026-10-17T12:00:00.000Z');
  });

  it('one row per visit in the LEDGER\'s own order (newest first, never re-sorted)', () => {
    const csv = deskReportSliceToCsv('request', "David Otieno's Sick Leave", LEDGER, META);
    const lines = csv.split('\r\n');
    expect(lines[6]).toBe('Visits');
    expect(lines[7]).toBe('Date,Day,Time (EAT),Branch,Reviewer,Employee,Leave type,Status,Recheck cleared');
    // The ledger's first entry files first — the slice never re-orders.
    // The en-GB day label ('Sat 17 Oct') carries no comma, so no quoting.
    expect(lines[8]).toBe('2026-10-17,Sat 17 Oct,12:15,MBUMAH HARDWARE - Juja Main,Grace Wanjiku,David Otieno,Sick Leave,PENDING,no');
    expect(lines[9]).toBe('2026-10-17,Sat 17 Oct,00:00,MBUMAH HARDWARE - Nakuru Branch,Peter Kimani,Mary Achieng,Annual Leave,APPROVED,yes');
    expect(lines[10]).toBe('');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('the request voice names the request family, same column shape', () => {
    const csv = deskReportSliceToCsv('request', "Mary Achieng's Annual Leave", [], META);
    expect(csv).toContain('Report,Desk report — request visits');
    expect(csv.split('\r\n')[7]).toBe('Date,Day,Time (EAT),Branch,Reviewer,Employee,Leave type,Status,Recheck cleared');
  });

  it('rides the digest escaper: formula-injection guards survive the drawer', () => {
    const hostile: DeskReportVisitEntry[] = [{
      ...LEDGER[0], reviewer: '=SUM(A1)', employeeName: '@ cmd',
    }];
    const csv = deskReportSliceToCsv('reviewer', '=HYPERLINK("x")', hostile, META);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'@ cmd");
  });

  it('reads the frozen ledger without disturbing it', () => {
    const frozen = Object.freeze([...LEDGER]) as readonly DeskReportVisitEntry[];
    deskReportSliceToCsv('reviewer', 'Grace Wanjiku', frozen, META);
    expect(frozen[0].id).toBe('visit-newest');
    expect(frozen[1].id).toBe('visit-older');
  });
});

describe('deskReportSliceCsvFilename - filed copies never overwrite each other (v2.79.0)', () => {
  const PAYLOAD = {
    window: { start: '2026-10-10T21:00:00.000Z', end: '2026-10-17T21:00:00.000Z', label: 'Fri, 10 Oct → Sat, 17 Oct', days: 7 },
    scope: { branch: null, branchName: null },
  } as unknown as Parameters<typeof deskReportSliceCsvFilename>[2];

  it('stamps kind + subject + window bounds + scope into the filename', () => {
    expect(deskReportSliceCsvFilename('reviewer', 'Grace Wanjiku', PAYLOAD))
      .toBe('mbumah-desk-reviewer-grace-wanjiku-7d-2026-10-11_2026-10-17-all-branches.csv');
    expect(deskReportSliceCsvFilename('request', "David Otieno's Sick Leave", PAYLOAD))
      .toBe('mbumah-desk-request-david-otieno-s-sick-leave-7d-2026-10-11_2026-10-17-all-branches.csv');
  });

  it('a narrowed scope names the branch slug (the branch ID, same as the report filename)', () => {
    const narrowed = { ...PAYLOAD, scope: { branch: 'store-juja', branchName: 'MBUMAH HARDWARE - Juja Main' } } as typeof PAYLOAD;
    expect(deskReportSliceCsvFilename('reviewer', 'Peter Kimani', narrowed))
      .toBe('mbumah-desk-reviewer-peter-kimani-7d-2026-10-11_2026-10-17-store-juja.csv');
  });

  it('an all-punctuation subject falls back to the kind — never an anonymous file', () => {
    expect(deskReportSliceCsvFilename('reviewer', '***', PAYLOAD))
      .toBe('mbumah-desk-reviewer-reviewer-7d-2026-10-11_2026-10-17-all-branches.csv');
  });
});

describe('the drawer CSV buttons in the view (v2.79.0)', () => {
  const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  const VIEW = readRepo('src/components/org/desk-report-view.tsx');

  it('the view imports the slice builders and their types', () => {
    expect(VIEW).toContain('deskReportSliceCsvFilename,');
    expect(VIEW).toContain('deskReportSliceToCsv,');
    expect(VIEW).toContain('type DeskReportSliceKind,');
    expect(VIEW).toContain('type DeskReportVisitEntry,');
  });

  it('the downloader is a client-side Blob from the ledger — no fetch, instant', () => {
    const body = VIEW.split('const downloadSliceCsv = useCallback(')[1].split('[data],')[0];
    expect(body).toContain('if (!data) return;');
    expect(body).toContain('deskReportSliceToCsv(kind, subject, entries, {');
    expect(body).toContain("scopeLabel: data.scope.branchName ? `Branch: ${data.scope.branchName}` : 'All branches'");
    expect(body).toContain('windowLabel: data.window.label,');
    expect(body).toContain('windowDays: data.window.days,');
    expect(body).toContain("new Blob([csv], { type: 'text/csv; charset=utf-8' })");
    expect(body).toContain('URL.createObjectURL(blob)');
    expect(body).toContain('deskReportSliceCsvFilename(kind, subject, data)');
    expect(body).not.toContain('fetch(');
  });

  it('both drawers carry their own CSV button, wired to the downloader', () => {
    const rev = VIEW.split("downloadSliceCsv('reviewer'")[1].split('</button>')[0];
    expect(rev).toContain('data-testid="desk-report-reviewer-csv"');
    expect(rev).toContain("aria-label={`File ${r.name}'s visits as CSV`}");
    expect(rev).toContain("title=\"File this reviewer's visits as CSV (RFC-4180, formula-injection guarded)\"");
    const req = VIEW.split("downloadSliceCsv('request'")[1].split('</button>')[0];
    expect(req).toContain('data-testid="desk-report-request-csv"');
    expect(req).toContain("aria-label={`File ${r.employeeName}'s ${r.leaveTypeName} visits as CSV`}");
    // The wiring itself sits BEFORE the split point (the slice-trap class):
    // assert it against the whole file, not the post-onClick slice.
    expect(VIEW).toContain("downloadSliceCsv('request', `${r.employeeName}'s ${r.leaveTypeName}`, visits)");
  });

  it('the CSV buttons are action buttons, not doors (the walk stays 6)', () => {
    const rev = VIEW.split("downloadSliceCsv('reviewer'")[1].split('</button>')[0];
    const req = VIEW.split("downloadSliceCsv('request'")[1].split('</button>')[0];
    expect(rev).not.toContain('data-desk-door');
    expect(req).not.toContain('data-desk-door');
    expect((VIEW.match(/data-desk-door\n/g) || []).length).toBe(6);
  });

  it('the buttons wear the drawer\u2019s emerald dress, dark variants included', () => {
    const rev = VIEW.split('data-testid="desk-report-reviewer-csv"')[1].split('</button>')[0];
    expect(rev).toContain('border-emerald-200 bg-white');
    expect(rev).toContain('hover:border-emerald-400 hover:bg-emerald-100');
    expect(rev).toContain('focus-visible:ring-emerald-400');
    expect(rev).toContain('dark:border-emerald-500/30 dark:bg-slate-900/60 dark:text-emerald-300');
    expect(rev).toContain('FileSpreadsheet');
  });

  it('the print footer names its scope in the header\u2019s own words', () => {
    const foot = VIEW.split('data-testid="desk-report-footnote"')[1].split('</p>')[0];
    expect(foot).toContain('({scopeLabel})');
    expect(foot).not.toContain("'branch scope'");
    expect(foot).not.toContain("'org-wide scope'");
    // The kbd hint stays print:hidden — the paper still never learns about keyboards.
    expect(foot).toContain('print:hidden');
  });
});

describe('release metadata - v2.79.0', () => {
  it('bumps package.json to at least 2.79.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.79.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.79.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.79.0')).toBe(true);
    expect(PKG.scripts['verify:v2-79-0']).toBe('node scripts/verify-v2-79-0.mjs');
  });

  it('whats-new 2.79.0 leads the feed with the drawers-file story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.79.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.79.0'")).toBeLessThan(WN.indexOf("version: '2.78.0'"));
    expect(WN).toContain('The drawers file themselves');
    expect(WN).toContain('mbumah-desk-reviewer-\\u2026');
  });

  it('keeps every prior surface intact (walk, announcers, drawers, scope chips, report CSV)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-scope-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    expect(VIEW).toContain('const clearDrawers = useCallback(');
    const MOD = readRepo('src/lib/hr/desk-report.ts');
    expect(MOD).toContain('export function deskReportSliceToCsv(');
    expect(MOD).toContain('export function deskReportSliceCsvFilename(');
    expect(MOD).toContain('export function deskReportToCsv(');
  });
});

describe('deskReportDrawerParam - the arrival link (v2.80.0)', () => {
  it('names the drawer a link asks for, one param at a time', () => {
    expect(deskReportDrawerParam('?reviewer=Jane%20Doe')).toEqual({ kind: 'reviewer', id: 'Jane Doe' });
    expect(deskReportDrawerParam('?request=req-42')).toEqual({ kind: 'request', id: 'req-42' });
  });

  it('the request wins when a link carries both \u2014 one drawer on arrival, like on the page', () => {
    expect(deskReportDrawerParam('?reviewer=Jane%20Doe&request=req-42')).toEqual({ kind: 'request', id: 'req-42' });
  });

  it('whitespace is trimmed, and a whitespace-only param is no link at all', () => {
    expect(deskReportDrawerParam('?reviewer=%20Grace%20')).toEqual({ kind: 'reviewer', id: 'Grace' });
    expect(deskReportDrawerParam('?reviewer=%20')).toBeNull();
    expect(deskReportDrawerParam('?request=')).toBeNull();
  });

  it('no drawer param \u2192 null (a plain visit is not a deep link; scope params are not drawers)', () => {
    expect(deskReportDrawerParam('')).toBeNull();
    expect(deskReportDrawerParam('?days=14&branch=store-juja')).toBeNull();
  });
});

describe('deskReportDrawerHref - every drawer has an address (v2.80.0)', () => {
  it('builds the address of a drawer, encoding the subject', () => {
    expect(deskReportDrawerHref('reviewer', 'Jane Doe')).toBe('/org/desk-report?reviewer=Jane%20Doe');
    expect(deskReportDrawerHref('request', 'req 42')).toBe('/org/desk-report?request=req%2042');
  });

  it('round-trips through the parser (any name survives the ride)', () => {
    const search = deskReportDrawerHref('reviewer', "David Otieno's Sick Leave").split('?')[1];
    expect(deskReportDrawerParam(`?${search}`)).toEqual({ kind: 'reviewer', id: "David Otieno's Sick Leave" });
  });
});

describe('deskReportResolveDeepLink - the arrival answers honestly (v2.80.0)', () => {
  const LEDGER: DeskReportVisitEntry[] = [
    {
      id: 'visit-1', at: '2026-10-17T09:15:00.000Z', dayKey: '2026-10-17',
      storeId: 'store-juja', storeName: 'MBUMAH HARDWARE - Juja Main',
      reviewer: 'Grace Wanjiku', employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
      status: 'PENDING', cleared: false, requestId: 'req-1',
    },
    {
      id: 'visit-2', at: '2026-10-16T21:00:00.000Z', dayKey: '2026-10-17',
      storeId: 'store-nak', storeName: 'MBUMAH HARDWARE - Nakuru Branch',
      reviewer: 'Peter Kimani', employeeName: 'David Otieno', leaveTypeName: 'Sick Leave',
      status: 'PENDING', cleared: false, requestId: 'req-1',
    },
    {
      id: 'visit-3', at: '2026-10-15T08:00:00.000Z', dayKey: '2026-10-15',
      storeId: 'store-juja', storeName: 'MBUMAH HARDWARE - Juja Main',
      reviewer: 'Grace Wanjiku', employeeName: 'Mary Achieng', leaveTypeName: 'Annual Leave',
      status: 'APPROVED', cleared: true, requestId: 'req-9',
    },
  ];
  const DATA = {
    ledger: LEDGER,
    reviewers: [{ name: 'Grace Wanjiku', visits: 2 }, { name: 'Peter Kimani', visits: 1 }],
    topRequests: [{ requestId: 'req-1' }],
  };

  it('a reviewer link opens the drawer and says how much the file holds', () => {
    const r = deskReportResolveDeepLink({ kind: 'reviewer', id: 'Grace Wanjiku' }, DATA);
    expect(r.open).toBe(true);
    expect(r.announcement).toBe("The link opened Grace Wanjiku's file — 2 visits in this window.");
  });

  it('a reviewer outside the window is refused, by name', () => {
    const r = deskReportResolveDeepLink({ kind: 'reviewer', id: 'Ali Mwangi' }, DATA);
    expect(r.open).toBe(false);
    expect(r.announcement).toBe("The link asked for Ali Mwangi's file — no visits from Ali Mwangi in this window's report.");
  });

  it('a request door opens and names the file the desk kept returning to', () => {
    const r = deskReportResolveDeepLink({ kind: 'request', id: 'req-1' }, DATA);
    expect(r.open).toBe(true);
    expect(r.announcement).toBe("The link opened David Otieno's Sick Leave.");
  });

  it('a doorless file with visits is refused WITH the reason: the cap speaks', () => {
    const r = deskReportResolveDeepLink({ kind: 'request', id: 'req-9' }, DATA);
    expect(r.open).toBe(false);
    expect(r.announcement).toBe(`The link's file drew 1 visit in this window but is not among the report's ${DESK_REPORT_TOP_REQUESTS_LIMIT} most-visited — no drawer for it here.`);
  });

  it('a file that drew no visits is refused honestly, and the ledger is never disturbed', () => {
    const frozen = Object.freeze([...DATA.ledger]) as readonly DeskReportVisitEntry[];
    const r = deskReportResolveDeepLink({ kind: 'request', id: 'req-404' }, { ...DATA, ledger: frozen });
    expect(r.open).toBe(false);
    expect(r.announcement).toBe('The link\u2019s file drew no visits in this window — the report has no drawer for it.');
    expect(frozen[0].id).toBe('visit-1');
  });
});

describe('the deep links in the view (v2.80.0)', () => {
  const readRepo2 = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  const VIEW = readRepo2('src/components/org/desk-report-view.tsx');

  it('the view imports the parser, the href builder and the resolver', () => {
    expect(VIEW).toContain('deskReportDrawerHref,');
    expect(VIEW).toContain('deskReportDrawerParam,');
    expect(VIEW).toContain('deskReportResolveDeepLink,');
  });

  it('the arrival link is parsed at resolve time, one-shot by contract', () => {
    // The gate is a one-shot ref; the LINK is read at the first read — a
    // client-side navigation (the desk panel's Link) updates the address
    // bar AFTER the new page renders, so a mount-time parse could see the
    // old address and miss the link.
    expect(VIEW).toContain('const deepLinkOpen = useRef(true);');
    const body = VIEW.split('const resolve = setTimeout(')[1].split('}, 0);')[0];
    expect(body).toContain('deepLinkOpen.current = false;');
    expect(body).toContain('const link = deskReportDrawerParam(window.location.search);');
    expect(body).toContain('if (!link) return; // no link in the address: a plain visit, nothing to answer');
  });

  it('the arrival resolves against the same read: open names the family, refusal strips the address', () => {
    const body = VIEW.split('const resolve = setTimeout(')[1].split('}, 0);')[0];
    expect(body).toContain('deskReportResolveDeepLink(link, data)');
    expect(body).toContain("if (link.kind === 'reviewer') setOpenReviewer(link.id);");
    expect(body).toContain('else setOpenRequest(link.id);');
    expect(body).toContain("history.replaceState(null, '', '/org/desk-report')");
    expect(body).toContain('setWalkAnnouncement(result.announcement)');
  });

  it('every drawer has an address: the URL mirrors the open drawer, either family, base when closed', () => {
    const mirror = VIEW.split("v2.80.0 — every drawer has an address")[1].split('}, [openReviewer, openRequest]);')[0];
    expect(mirror).toContain("deskReportDrawerHref('request', openRequest)");
    expect(mirror).toContain("deskReportDrawerHref('reviewer', openReviewer)");
    expect(mirror).toContain(": '/org/desk-report';");
    expect(mirror).toContain('history.replaceState(null, \'\', href)');
    expect(mirror).toContain('if (deepLinkOpen.current) return;');
    // The mirror never navigates — replaceState only.
    expect(mirror).not.toContain('history.pushState');
    expect(mirror).not.toContain('window.location.assign');
  });

  it('the footnote says the drawer rides the address bar', () => {
    const foot = VIEW.split('data-testid="desk-report-footnote"')[1].split('</p>')[0];
    expect(foot).toContain('An open drawer rides the address bar — copy the URL and the same file opens for whoever follows.');
  });

  it('the deep links add no doors \u2014 the walk stays 6', () => {
    expect((VIEW.match(/data-desk-door\n/g) || []).length).toBe(6);
  });
});

describe('release metadata - v2.80.0', () => {
  it('bumps package.json to at least 2.80.0 (all three slots) and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    const atLeast = (v: string, base: string) => {
      const [a, b, c] = v.split('.').map(Number);
      const [x, y, z] = base.split('.').map(Number);
      return a > x || (a === x && (b > y || (b === y && c >= z)));
    };
    expect(atLeast(PKG.version, '2.80.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.80.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.80.0')).toBe(true);
    expect(PKG.scripts['verify:v2-80-0']).toBe('node scripts/verify-v2-80-0.mjs');
  });

  it('whats-new 2.80.0 leads the feed with the addressable story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.80.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.80.0'")).toBeLessThan(WN.indexOf("version: '2.79.0'"));
    expect(WN).toContain('The report is addressable');
  });

  it('keeps every prior surface intact (walk, announcers, drawers, scope chips, report CSV, filing drawers)', () => {
    const VIEW = readRepo('src/components/org/desk-report-view.tsx');
    expect(VIEW).toContain('data-testid="desk-report-walk-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-scope-announcer"');
    expect(VIEW).toContain('data-testid="desk-report-csv"');
    expect(VIEW).toContain("printReceiptElement('desk-report-content')");
    expect(VIEW).toContain('const clearDrawers = useCallback(');
    const MOD = readRepo('src/lib/hr/desk-report.ts');
    expect(MOD).toContain('export function deskReportDrawerParam(');
    expect(MOD).toContain('export function deskReportDrawerHref(');
    expect(MOD).toContain('export function deskReportResolveDeepLink(');
    expect(MOD).toContain('export function deskReportSliceToCsv(');
    expect(MOD).toContain('export function deskReportSliceCsvFilename(');
    expect(MOD).toContain('export function deskReportToCsv(');
  });
});
