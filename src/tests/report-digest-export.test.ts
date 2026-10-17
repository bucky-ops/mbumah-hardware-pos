// v2.52.0 - AD-HOC DIGEST CSV EXPORT TESTS
//
// Contracts under test:
//   • parseExportQuery (pure): report allow-list, period requirements for the
//     six period-keyed reports, the year-keyed leave-utilisation override,
//     from ≤ to, the 366-day cap, and the exact client-facing error codes.
//   • buildDigestPayload (the shared builder): meta block pass-through
//     (organization / scope / period / AD_HOC frequency labels), per-report
//     delegation WITH the store narrowing opt, the leave-year honesty (the
//     selected year beats `now`), and null for unknown keys.
//   • Channel parity: buildDigestData (scheduled email path) resolves labels
//     through digestOrgAndScope and delegates with the schedule's own store —
//     a downloaded CSV and a digest email must agree on every label.
//   • digestToCsv on an AD_HOC payload: honest filename, header block naming
//     Frequency,AD_HOC, CRLF framing.
//
// NODE environment on purpose: the schedule service is SSR-only (db + email).
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── shared mocks (hoisted) ──────────────────────────────────────────────────

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  });
  return {
    hrReportSchedule: model(),
    organization: model(),
    store: model(),
    notification: model(),
    notificationLog: model(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
});

vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined), withErrorBoundary: (fn: unknown) => fn }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule', DATA_EXPORT: 'DataExport' },
}));

// The report functions are stubbed at the seam — the payload builder's
// CONTRACT is what we test (delegation, labels, opts pass-through), not the
// SQL inside each report (covered by their own suites).
const headcountReport = vi.hoisted(() => vi.fn());
const leaveUtilisationReport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/hr/reports', () => ({
  headcountReport,
  employmentCostReport: vi.fn(),
  absenceReport: vi.fn(),
  turnoverReport: vi.fn(),
  timeToHireReport: vi.fn(),
  statutoryLiabilityReport: vi.fn(),
  leaveUtilisationReport,
}));

import { parseExportQuery } from '@/app/api/hr/reports/export/route';
import {
  buildDigestData,
  buildDigestPayload,
  digestOrgAndScope,
  type DigestMeta,
} from '@/lib/hr/report-schedule-service';
import { digestToCsv, tableToCsv } from '@/lib/hr/digest-csv';

const SESSION = {
  userId: 'user-owner-1',
  email: 'owner@mbumahhardware.co.ke',
  role: 'STORE_OWNER',
  storeId: null as string | null,
  organizationId: 'org_mbumah',
};

const META: DigestMeta = {
  organizationName: 'MBUMAH Hardware',
  scopeLabel: 'All branches',
  periodLabel: '2026-10-01 → 2026-10-15',
  frequencyLabel: 'AD_HOC',
};

const HEADCOUNT_ROW = {
  scope: 'ORG',
  active: 5,
  onLeave: 1,
  suspended: 0,
  hiresInPeriod: 2,
  exitsInPeriod: 0,
  avgTenureYears: 3.5,
  byEmploymentType: [{ employmentType: 'permanent, full-time', count: 4 }],
  byStore: [{ storeName: 'Juja Main', count: 5 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
  db.store.findUnique.mockResolvedValue({ name: 'Juja Main' });
});

// ── parseExportQuery ────────────────────────────────────────────────────────

describe('parseExportQuery (pure)', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('requires the report parameter', () => {
    const r = parseExportQuery(q(''));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('MISSING_REPORT');
      expect(r.status).toBe(400);
    }
  });

  it('rejects unknown reports with the exportable list named', () => {
    const r = parseExportQuery(q('report=p10'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID_REPORT');
      expect(r.error).toContain('headcount');
      expect(r.error).toContain('leave-utilisation');
    }
  });

  it('requires from AND to for the period-keyed reports', () => {
    for (const params of ['report=headcount', 'report=headcount&from=2026-10-01', 'report=headcount&to=2026-10-31']) {
      const r = parseExportQuery(q(params));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('MISSING_PERIOD');
    }
  });

  it('rejects non-ISO date shapes', () => {
    const r = parseExportQuery(q('report=headcount&from=01-10-2026&to=2026-10-31'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_PERIOD');
  });

  it('rejects an inverted period (from after to)', () => {
    const r = parseExportQuery(q('report=headcount&from=2026-10-31&to=2026-10-01'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_PERIOD');
  });

  it('caps the span at 366 days', () => {
    const r = parseExportQuery(q('report=headcount&from=2024-01-01&to=2026-01-02'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PERIOD_TOO_LONG');
  });

  it('accepts a valid period-keyed request with dates + storeId', () => {
    const r = parseExportQuery(q('report=employment-cost&from=2026-10-01&to=2026-10-31&storeId=store_1'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reportKey).toBe('employment-cost');
      expect(r.from).toBe('2026-10-01');
      expect(r.to).toBe('2026-10-31');
      expect(r.storeId).toBe('store_1');
      expect(r.year).toBeNull();
    }
  });

  it('leave-utilisation ignores from/to and honours the selected leave year', () => {
    const r = parseExportQuery(q('report=leave-utilisation&year=2025'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBeNull();
      expect(r.to).toBeNull();
      expect(r.year).toBe(2025);
    }
  });

  it('leave-utilisation defaults the year to null (server uses the current year)', () => {
    const r = parseExportQuery(q('report=leave-utilisation'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.year).toBeNull();
  });

  it('rejects a malformed leave year', () => {
    const r = parseExportQuery(q('report=leave-utilisation&year=next'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_YEAR');
  });
});

// ── digestOrgAndScope ───────────────────────────────────────────────────────

describe('digestOrgAndScope', () => {
  it('labels org scope "All branches"', async () => {
    const r = await digestOrgAndScope('org_mbumah', null);
    expect(r.organizationName).toBe('MBUMAH Hardware');
    expect(r.scopeLabel).toBe('All branches');
    expect(db.store.findUnique).not.toHaveBeenCalled();
  });

  it('labels store scope with the store name', async () => {
    const r = await digestOrgAndScope('org_mbumah', 'store_1');
    expect(r.scopeLabel).toBe('Juja Main');
  });

  it('falls back honestly when the org row is missing', async () => {
    db.organization.findUnique.mockResolvedValue(null);
    const r = await digestOrgAndScope('org_x', null);
    expect(r.organizationName).toBe('MBUMAH Hardware');
  });
});

// ── buildDigestPayload (the shared builder) ─────────────────────────────────

describe('buildDigestPayload', () => {
  const PERIOD = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-15T23:59:59.999Z') };

  it('passes the meta block through byte-for-byte (AD_HOC frequency included)', async () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    const d = await buildDigestPayload(SESSION as never, 'headcount', PERIOD, META);
    expect(d).not.toBeNull();
    expect(d?.organizationName).toBe('MBUMAH Hardware');
    expect(d?.scopeLabel).toBe('All branches');
    expect(d?.periodLabel).toBe('2026-10-01 → 2026-10-15');
    expect(d?.frequencyLabel).toBe('AD_HOC');
    expect(d?.reportLabel).toBe('Headcount');
  });

  it('narrows to the store opt like the interactive drill-down does', async () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    await buildDigestPayload(SESSION as never, 'headcount', PERIOD, META, new Date(), { storeId: 'store_9' });
    expect(headcountReport).toHaveBeenCalledWith(SESSION, PERIOD, { storeId: 'store_9' });
  });

  it('honours the selected leave year over the current year (2025 on screen = 2025 in file)', async () => {
    leaveUtilisationReport.mockResolvedValue(null);
    await buildDigestPayload(
      SESSION as never,
      'leave-utilisation',
      { from: new Date(), to: new Date() },
      { ...META, periodLabel: 'Leave year 2025' },
      new Date('2026-10-17T00:00:00.000Z'),
      { year: 2025 },
    );
    expect(leaveUtilisationReport).toHaveBeenCalledWith(SESSION, 2025, { storeId: null });
  });

  it('defaults the leave year to the current UTC year when none is passed', async () => {
    leaveUtilisationReport.mockResolvedValue(null);
    await buildDigestPayload(
      SESSION as never,
      'leave-utilisation',
      { from: new Date(), to: new Date() },
      META,
      new Date('2026-10-17T00:00:00.000Z'),
    );
    expect(leaveUtilisationReport).toHaveBeenCalledWith(SESSION, 2026, { storeId: null });
  });

  it('returns null for an unknown report key', async () => {
    const d = await buildDigestPayload(SESSION as never, 'not-a-report', PERIOD, META);
    expect(d).toBeNull();
  });
});

// ── channel parity: scheduled email vs ad-hoc download ──────────────────────

describe('buildDigestData (scheduled path) delegates through the same builder', () => {
  it('resolves labels via digestOrgAndScope and stamps the schedule frequency', async () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    const d = await buildDigestData(
      { organizationId: 'org_mbumah', storeId: null, reportKey: 'headcount', frequency: 'MONTHLY' },
      new Date('2026-10-17T03:00:00.000Z'),
    );
    expect(d).not.toBeNull();
    expect(d?.frequencyLabel).toBe('MONTHLY');
    expect(d?.organizationName).toBe('MBUMAH Hardware');
    expect(d?.scopeLabel).toBe('All branches');
    expect(d?.periodLabel).toBe('2026-10-01 → 2026-10-17');
  });

  it('keeps the sweep contract: the schedule store rides as the narrowing opt', async () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    await buildDigestData(
      { organizationId: 'org_mbumah', storeId: 'store_1', reportKey: 'headcount', frequency: 'WEEKLY' },
      new Date('2026-10-17T03:00:00.000Z'),
    );
    // The sweep session is synthetic (BRANCH_MANAGER of store_1) and the opt
    // mirrors it — scope can only narrow, never widen.
    const call = headcountReport.mock.calls[0];
    const [session, , opts] = call;
    expect(session.role).toBe('BRANCH_MANAGER');
    expect(session.storeId).toBe('store_1');
    expect(opts).toEqual({ storeId: 'store_1' });
  });
});

// ── the exported file itself ────────────────────────────────────────────────

describe('digestToCsv on an AD_HOC payload', () => {
  it('renders the header block with Frequency,AD_HOC and an honest filename', () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    const now = new Date('2026-10-17T04:00:00.000Z');
    return buildDigestPayload(SESSION as never, 'headcount', { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-15T23:59:59.999Z') }, META, now).then((d) => {
      expect(d).not.toBeNull();
      const csv = d ? digestToCsv(d, now) : null;
      if (!d || !csv) throw new Error('expected a digest payload and a CSV for a populated headcount report');
      expect(csv.filename).toBe('mbumah-headcount-2026-10-01_2026-10-15.csv');
      const text = Buffer.from(csv.content, 'base64').toString('utf8');
      expect(text).toContain('Report,Headcount');
      expect(text).toContain('Frequency,AD_HOC');
      expect(text).toContain('Period,2026-10-01 → 2026-10-15');
      expect(text).toContain('By employment type');
      expect(text.endsWith('\r\n')).toBe(true);
      expect(csv.byteSize).toBe(Buffer.byteLength(text, 'utf8'));
    });
  });
});

// ── v2.58.0: the table section ──────────────────────────────────────────────
describe('parseExportQuery: table section param (v2.58.0)', () => {
  it('defaults to the full digest file when no table param is present', () => {
    const ok = parseExportQuery(new URLSearchParams({ report: 'absence', from: '2026-01-01', to: '2026-01-31' }));
    expect(ok).toMatchObject({ ok: true, reportKey: 'absence', section: 'digest' });
  });

  it('accepts table=1 and table=true as the table section', () => {
    expect(
      parseExportQuery(new URLSearchParams({ report: 'absence', from: '2026-01-01', to: '2026-01-31', table: '1' })),
    ).toMatchObject({ ok: true, section: 'table' });
    expect(
      parseExportQuery(new URLSearchParams({ report: 'absence', from: '2026-01-01', to: '2026-01-31', table: 'true' })),
    ).toMatchObject({ ok: true, section: 'table' });
  });

  it('refuses any other table value honestly (INVALID_SECTION)', () => {
    const bad = parseExportQuery(new URLSearchParams({ report: 'absence', from: '2026-01-01', to: '2026-01-31', table: 'summary' }));
    expect(bad).toMatchObject({ ok: false, status: 400, code: 'INVALID_SECTION' });
  });

  it('carries the section through the leave-utilisation year branch too', () => {
    const ok = parseExportQuery(new URLSearchParams({ report: 'leave-utilisation', year: '2026', table: '1' }));
    expect(ok).toMatchObject({ ok: true, reportKey: 'leave-utilisation', year: 2026, section: 'table', from: null, to: null });
  });
});

// ── v2.58.0: tableToCsv — the governed file, table section only ────────────
describe('tableToCsv: the digest file minus the Summary block', () => {
  it('keeps the header block + table, drops Summary, and suffixes the filename with -table', () => {
    headcountReport.mockResolvedValue(HEADCOUNT_ROW);
    const now = new Date('2026-10-17T04:00:00.000Z');
    return buildDigestPayload(SESSION as never, 'headcount', { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-15T23:59:59.999Z') }, META, now).then((d) => {
      expect(d).not.toBeNull();
      const csv = d ? tableToCsv(d, now) : null;
      if (!d || !csv) throw new Error('expected a digest payload and a table CSV for a populated headcount report');
      expect(csv.filename).toBe('mbumah-headcount-2026-10-01_2026-10-15-table.csv');
      const text = Buffer.from(csv.content, 'base64').toString('utf8');
      expect(text).toContain('Report,Headcount');
      expect(text).toContain('Period,2026-10-01 → 2026-10-15');
      expect(text).toContain('By employment type');
      // the Summary block is GONE — the table section is the file's payload
      expect(text).not.toContain('Summary');
      expect(text).not.toContain('Metric,Value');
      expect(text.endsWith('\r\n')).toBe(true);
      expect(csv.byteSize).toBe(Buffer.byteLength(text, 'utf8'));
    });
  });

  it('returns null for a digest without a table (the route answers NO_TABLE_DATA)', () => {
    const csv = tableToCsv({
      reportLabel: 'Headcount',
      organizationName: 'MBUMAH HARDWARE',
      scopeLabel: 'All branches',
      periodLabel: '2026-10-01 → 2026-10-15',
      frequencyLabel: 'AD_HOC',
      headline: [{ label: 'Active headcount', value: '5' }],
      table: undefined,
    }, new Date('2026-10-17T04:00:00.000Z'));
    expect(csv).toBeNull();
  });

  it('guards a table cell that starts with a formula trigger (OWASP)', () => {
    const csv = tableToCsv({
      reportLabel: 'Absence',
      organizationName: 'MBUMAH HARDWARE',
      scopeLabel: 'All branches',
      periodLabel: '2026-10-01 → 2026-10-31',
      frequencyLabel: 'AD_HOC',
      headline: [],
      table: {
        caption: 'Absence by status',
        columns: ['Status', 'Days'],
        rows: [['=SUM(A1:A2)', '12']],
      },
    }, new Date('2026-10-17T04:00:00.000Z'));
    expect(csv).not.toBeNull();
    const text = csv ? Buffer.from(csv.content, 'base64').toString('utf8') : '';
    expect(text).toContain("'=SUM(A1:A2)");
  });
});
