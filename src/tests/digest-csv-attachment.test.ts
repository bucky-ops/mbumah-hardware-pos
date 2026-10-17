// v2.46.0 - DIGEST CSV ATTACHMENTS + ADMIN-RESET SECURITY NOTICE TESTS
//
// Contracts under test:
//   • digest-csv (pure): RFC-4180 escaping, formula-injection guard, layout
//     (header block → summary → table), filename slugging, base64 roundtrip,
//     byteSize, null when there is nothing to file, human-readable size.
//   • email-service attachments: passthrough to the Resend SDK, pre-flight
//     validation (count / per-file / total caps, filename + content
//     presence), and NotificationLog metadata that records NAMES + SIZES
//     only — never the attachment content.
//   • schedule service wiring: the scheduled sweep AND the manual send-now
//     both attach the CSV, stamp csvFilename/csvBytes into the send
//     metadata, mirror the attachment into the in-app notification copy,
//     and report it on the send-now result.
//   • passwordChangedTemplate: the admin-reset variant differs where the
//     facts differ (actor, sessions, next step) while the self variant stays
//     byte-identical to v2.45.0; PATCH /api/users/[id] wiring is pinned
//     statically (source contract) like the leave-routing suites.
//
// NODE environment on purpose: the email service is SSR-only and refuses to
// run when `window` exists (DOM test environments would false-fail it).
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── shared mocks (hoisted) ──────────────────────────────────────────────────

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
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

const resendSend = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined), withErrorBoundary: (fn: unknown) => fn }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule' },
}));
vi.mock('@/lib/hr/reports', () => ({
  headcountReport: vi.fn().mockResolvedValue({
    scope: 'ORG',
    active: 5,
    onLeave: 0,
    suspended: 0,
    hiresInPeriod: 0,
    exitsInPeriod: 1,
    avgTenureYears: 3.7,
    byEmploymentType: [{ employmentType: 'permanent, full-time', count: 3 }],
    byStore: [],
  }),
  employmentCostReport: vi.fn(),
  absenceReport: vi.fn(),
  turnoverReport: vi.fn(),
  timeToHireReport: vi.fn(),
  statutoryLiabilityReport: vi.fn(),
  leaveUtilisationReport: vi.fn(),
}));

// ── imports under test ──────────────────────────────────────────────────────

import { csvCell, digestToCsv, formatCsvSize, periodFilenameFragment } from '@/lib/hr/digest-csv';
import { sendEmail } from '@/lib/email-service';
import { passwordChangedTemplate } from '@/lib/email-templates';
import { runDueHrReportSchedules, sendScheduleNow } from '@/lib/hr/report-schedule-service';
import type { HrReportDigestData } from '@/lib/email-templates';

const ROOT = join(__dirname, '..');

// The real (unmocked) email service needs the Resend key to be considered
// configured; the SDK itself is mocked, so no network ever happens.
const ORIGINAL_KEY = process.env.RESEND_API_KEY;
beforeAll(() => {
  process.env.RESEND_API_KEY = 'test-key';
});
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

// Wednesday 2026-10-14 03:30 UTC (same anchor as the v2.22.0 suite).
const NOW = new Date('2026-10-14T03:30:00Z');

/** Non-null assertion without the eslint warning — fails loudly instead. */
function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a non-null value');
  return value;
}

function digestData(over: Partial<HrReportDigestData> = {}): HrReportDigestData {
  return {
    organizationName: 'MBUMAH Hardware',
    reportLabel: 'Absence',
    periodLabel: '2026-10-01 → 2026-10-31',
    scopeLabel: 'All branches',
    headline: [
      { label: 'Active employees', value: '5' },
      { label: 'Absent days', value: '3' },
      { label: 'Absence rate', value: '1.2%' },
    ],
    table: {
      caption: 'Attendance days by status',
      columns: ['Status', 'Days'],
      rows: [
        ['WORKED', 122],
        ['LEAVE', 3],
      ],
    },
    frequencyLabel: 'MONTHLY',
    ...over,
  };
}

// ── pure builder ────────────────────────────────────────────────────────────

describe('digestToCsv (pure builder)', () => {
  it('emits the header block, summary and table sections with CRLF framing', () => {
    const csv = need(digestToCsv(digestData(), NOW));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Report,Absence');
    expect(lines[1]).toBe('Organization,MBUMAH Hardware');
    expect(lines[2]).toBe('Scope,All branches');
    expect(lines[3]).toBe('Period,2026-10-01 → 2026-10-31');
    expect(lines[4]).toBe('Frequency,MONTHLY');
    expect(lines[5]).toBe(`Generated (UTC),${NOW.toISOString()}`);
    expect(lines[7]).toBe('Summary');
    expect(lines[8]).toBe('Metric,Value');
    expect(lines[9]).toBe('Active employees,5');
    expect(lines).toContain('Attendance days by status');
    expect(lines).toContain('Status,Days');
    expect(lines).toContain('WORKED,122');
    // RFC-4180: trailing CRLF (the split yields a final empty element).
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('escapes commas, quotes and newlines (RFC-4180 quote-doubling)', () => {
    expect(csvCell('permanent, full-time')).toBe('"permanent, full-time"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(122)).toBe('122');
  });

  it('guards against CSV formula injection (=, +, -, @, tab prefixes)', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe(`'=SUM(A1:A9)`);
    expect(csvCell('+cmd')).toBe(`'+cmd`);
    expect(csvCell('-2')).toBe(`'-2`);
    expect(csvCell('@import')).toBe(`'@import`);
    expect(csvCell('\tImplant')).toBe(`'\tImplant`);
    // The guard applies BEFORE quoting so the whole cell renders as text.
    const csv = need(digestToCsv(digestData({ table: { caption: 'By type', columns: ['Type', 'Count'], rows: [['=HYPERLINK("http://evil")', 1]] } }), NOW));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain(`'=HYPERLINK(""http://evil"")`);
  });

  it('builds a filename that says what it is (label slug + period)', () => {
    const csv = need(digestToCsv(digestData(), NOW));
    expect(csv.filename).toBe('mbumah-absence-2026-10-01_2026-10-31.csv');
    expect(periodFilenameFragment('2026-10-01 → 2026-10-31')).toBe('2026-10-01_2026-10-31');
    // Unparseable period falls back to a safe constant.
    expect(periodFilenameFragment('TBD')).toBe('');
    expect(need(digestToCsv(digestData({ periodLabel: 'TBD' }), NOW)).filename).toBe('mbumah-absence-period.csv');
    // Long / punctuated labels slug cleanly and stay bounded.
    const long = need(digestToCsv(digestData({ reportLabel: 'Employment cost (KES) — full' }), NOW));
    expect(long.filename).toMatch(/^mbumah-employment-cost-kes-full-2026/);
  });

  it('measures byteSize over the decoded UTF-8 payload', () => {
    const csv = need(digestToCsv(digestData(), NOW));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(csv.byteSize).toBe(Buffer.byteLength(text, 'utf8'));
  });

  it('returns null when a digest has nothing to file; headline-only works', () => {
    expect(digestToCsv(digestData({ headline: [], table: undefined }), NOW)).toBeNull();
    expect(digestToCsv(digestData({ table: { caption: 'x', columns: ['a'], rows: [] } }), NOW)).not.toBeNull();
    const headlineOnly = need(digestToCsv(digestData({ table: undefined }), NOW));
    const text = Buffer.from(headlineOnly.content, 'base64').toString('utf8');
    expect(text).toContain('Summary');
    expect(text).not.toContain('Attendance days');
  });
});

describe('formatCsvSize', () => {
  it('formats bytes and kilobytes for humans', () => {
    expect(formatCsvSize(0)).toBe('0 B');
    expect(formatCsvSize(512)).toBe('512 B');
    expect(formatCsvSize(2048)).toBe('2.0 KB');
    expect(formatCsvSize(1587)).toBe('1.5 KB');
    expect(formatCsvSize(Number.NaN)).toBe('0 B');
  });
});

// ── email-service attachments ───────────────────────────────────────────────

describe('email-service attachment support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendSend.mockResolvedValue({ data: { id: 'm-1' }, error: null });
    db.notificationLog.create.mockResolvedValue({});
  });

  it('passes valid attachments through to the Resend SDK untouched', async () => {
    const result = await sendEmail({
      to: 'owner@mbumah.co.ke',
      subject: 'Digest',
      html: '<p>x</p>',
      attachments: [{ filename: 'report.csv', content: Buffer.from('a,b\r\n1,2').toString('base64') }],
    });
    expect(result.success).toBe(true);
    expect(resendSend).toHaveBeenCalledTimes(1);
    const sent = resendSend.mock.calls[0][0] as { attachments?: Array<{ filename: string; content: string }> };
    expect(sent.attachments).toEqual([{ filename: 'report.csv', content: Buffer.from('a,b\r\n1,2').toString('base64') }]);
  });

  it('omits the attachments key entirely when none are provided', async () => {
    await sendEmail({ to: 'owner@mbumah.co.ke', subject: 'Digest', html: '<p>x</p>' });
    const sent = resendSend.mock.calls[0][0] as { attachments?: unknown };
    expect(sent.attachments).toBeUndefined();
  });

  it('rejects an oversized file BEFORE the Resend call with a named limit', async () => {
    const bigContent = 'A'.repeat(10 * 1024 * 1024 * 2); // decodes to ~15 MB
    const result = await sendEmail({
      to: 'owner@mbumah.co.ke',
      subject: 'Digest',
      html: '<p>x</p>',
      attachments: [{ filename: 'big.csv', content: bigContent }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/10 MB per-file limit/);
    expect(resendSend).not.toHaveBeenCalled();
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('rejects more than 10 attachments and empty filenames', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ filename: `f${i}.csv`, content: 'aGk=' }));
    const tooMany = await sendEmail({ to: 'o@m.co.ke', subject: 's', html: 'h', attachments: many });
    expect(tooMany.error).toMatch(/Too many attachments/);

    const noName = await sendEmail({ to: 'o@m.co.ke', subject: 's', html: 'h', attachments: [{ filename: '  ', content: 'aGk=' }] });
    expect(noName.error).toMatch(/needs a filename/);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('audit metadata records names + sizes ONLY — never the content', async () => {
    const content = Buffer.from('secret,csv,data\r\n1,2,3').toString('base64');
    await sendEmail({
      to: 'owner@mbumah.co.ke',
      subject: 'Digest',
      html: '<p>x</p>',
      type: 'HR_REPORT_DIGEST',
      attachments: [{ filename: 'mbumah-absence.csv', content }],
    });
    const logged = db.notificationLog.create.mock.calls[0][0] as { data: { metadata: string; status: string } };
    expect(logged.data.status).toBe('SENT');
    const meta = JSON.parse(logged.data.metadata) as { attachments?: Array<{ filename: string; bytes: number }> };
    expect(meta.attachments).toEqual([{ filename: 'mbumah-absence.csv', bytes: Buffer.from('secret,csv,data\r\n1,2,3').length }]);
    expect(logged.data.metadata).not.toContain(content);
    expect(logged.data.metadata).not.toContain('secret,csv,data');
  });
});

// ── schedule service wiring ─────────────────────────────────────────────────

const SCHEDULE_ROW = {
  id: 'sched-csv',
  organizationId: 'org-1',
  storeId: null,
  reportKey: 'headcount',
  frequency: 'DAILY',
  recipients: JSON.stringify(['owner@mbumah.co.ke']),
  weekday: null,
  dayOfMonth: null,
  hourUtc: 3,
  active: true,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
};

describe('schedule service attaches the CSV (sweep + send-now)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendSend.mockResolvedValue({ data: { id: 'm-1' }, error: null });
    db.notificationLog.create.mockResolvedValue({});
    db.hrReportSchedule.findMany.mockResolvedValue([SCHEDULE_ROW]);
    db.hrReportSchedule.findFirst.mockResolvedValue(SCHEDULE_ROW);
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    db.notification.create.mockResolvedValue({ id: 'notif-1' });
    db.hrReportSchedule.update.mockResolvedValue({});
  });

  it('scheduled sweep: the CSV rides with the Resend payload and the audit trail', async () => {
    const result = await runDueHrReportSchedules(NOW);
    expect(result.sent).toBe(1);
    expect(resendSend).toHaveBeenCalledTimes(1);
    const sent = resendSend.mock.calls[0][0] as {
      attachments?: Array<{ filename: string; content: string }>;
    };
    expect(sent.attachments).toHaveLength(1);
    expect(need(sent.attachments)[0].filename).toBe('mbumah-headcount-2026-08-01_2026-10-14.csv');
    expect(Buffer.from(need(sent.attachments)[0].content, 'base64').toString('utf8')).toContain('Report,Headcount');

    // The durable send log stamps the attachment name + size (schedule
    // metadata flows through sendEmail into the NotificationLog row).
    const logged = db.notificationLog.create.mock.calls[0][0] as { data: { metadata: string; type: string; status: string } };
    expect(logged.data.status).toBe('SENT');
    expect(logged.data.type).toBe('HR_REPORT_DIGEST');
    const meta = JSON.parse(logged.data.metadata) as {
      csvFilename?: string;
      csvBytes?: number;
      attachments?: Array<{ filename: string; bytes: number }>;
    };
    expect(meta.csvFilename).toBe('mbumah-headcount-2026-08-01_2026-10-14.csv');
    expect(typeof meta.csvBytes).toBe('number');
    expect((meta.csvBytes ?? 0)).toBeGreaterThan(0);
    expect(meta.attachments?.[0].filename).toBe(meta.csvFilename);
    expect(logged.data.metadata).not.toContain('base64');

    // The in-app copy for the schedule creator mentions the attachment.
    const notif = db.notification.create.mock.calls[0][0] as { data: { message: string } };
    expect(notif.data.message).toMatch(/CSV \(\d+(\.\d+)? (B|KB)\) attached\./);
  });

  it('send-now: result reports the CSV, the SDK gets it, the log stamps it', async () => {
    const result = await sendScheduleNow('org-1', { id: 'actor-1', role: 'STORE_OWNER', storeId: null }, 'sched-csv', NOW);
    expect(result.outcome).toBe('SENT');
    expect(result.csv).not.toBeNull();
    expect(need(result.csv).filename).toBe('mbumah-headcount-2026-08-01_2026-10-14.csv');
    expect(need(result.csv).byteSize).toBeGreaterThan(0);

    const sent = resendSend.mock.calls[0][0] as { attachments?: unknown[] };
    expect(sent.attachments).toHaveLength(1);
    const logged = db.notificationLog.create.mock.calls[0][0] as { data: { metadata: string } };
    const meta = JSON.parse(logged.data.metadata) as { csvFilename?: string; manual?: boolean };
    expect(meta.csvFilename).toBe(need(result.csv).filename);
    expect(meta.manual).toBe(true);

    const notif = db.notification.create.mock.calls[0][0] as { data: { message: string } };
    expect(notif.data.message).toContain('attached.');
    expect(notif.data.message).toContain('(manual send)');
  });

  it('SKIPPED digests (no data) send nothing and attach nothing', async () => {
    const { headcountReport } = await import('@/lib/hr/reports');
    (headcountReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await runDueHrReportSchedules(NOW);
    expect(result.skipped).toBe(1);
    expect(resendSend).not.toHaveBeenCalled();
    expect(db.notificationLog.create).not.toHaveBeenCalled();
  });

  it('FAILED sends never claim the CSV in the in-app copy', async () => {
    resendSend.mockRejectedValueOnce(new Error('provider down'));
    const result = await runDueHrReportSchedules(NOW);
    expect(result.failed).toBe(1);
    const notif = db.notification.create.mock.calls[0][0] as { data: { message: string; priority: string } };
    expect(notif.data.message).toContain('Email not delivered');
    expect(notif.data.message).not.toContain('attached.');
    expect(notif.data.priority).toBe('HIGH');
  });
});

// ── admin-reset security notice ─────────────────────────────────────────────

describe('passwordChangedTemplate admin-reset variant', () => {
  const base = {
    userEmail: 'cashier@mbumah.co.ke',
    changedAtIso: '2026-10-17T08:00:00Z',
    sessionsRevoked: 3,
  };

  it('self variant stays identical to v2.45.0 (subject line + copy)', () => {
    const html = passwordChangedTemplate(base);
    expect(html).toContain('Your password was changed');
    expect(html).toContain('was just changed from your account settings.');
    expect(html).toContain('Devices signed out:</strong> 3 other sessions');
    expect(html).toContain("Wasn't you?");
    expect(html).not.toContain('An administrator');
  });

  it('admin variant names the actor class, the rotation lock and the next step', () => {
    const html = passwordChangedTemplate({ ...base, changedByAdmin: true, changedByAdminEmail: 'admin@mbumahhardware.co.ke' });
    expect(html).toContain('An administrator changed your password');
    expect(html).toContain('An administrator (<strong>admin@mbumahhardware.co.ke</strong>) set a new temporary password');
    expect(html).toContain('"Set a new password" screen');
    expect(html).toContain('sign in with the temporary password you were given and choose your own');
    expect(html).toContain("Didn't expect this?");
    // The self-only claims must NOT appear in the admin variant.
    expect(html).not.toContain('was just changed from your account settings.');
    expect(html).not.toContain('Devices signed out:');
  });

  it('admin variant without an admin email still reads honestly', () => {
    const html = passwordChangedTemplate({ ...base, changedByAdmin: true });
    expect(html).toContain('An administrator set a new temporary password');
    expect(html).not.toContain('(<strong>');
  });
});

describe('PATCH /api/users/[id] admin-reset notice (static contract)', () => {
  const src = readFileSync(join(ROOT, 'app/api/users/[id]/route.ts'), 'utf8');

  it('sends the variant best-effort, only on password changes', () => {
    const resetBlock = src.split('// v2.46.0: admin password resets are no longer silent')[1] ?? '';
    expect(resetBlock).toContain('if (password !== undefined) {');
    expect(resetBlock).toContain("subject: 'An administrator changed your MBUMAH HARDWARE password'");
    expect(resetBlock).toContain('changedByAdmin: true');
    expect(resetBlock).toContain('changedByAdminEmail: session.email');
    expect(resetBlock).toContain('NotificationType.PASSWORD_CHANGED');
    // Best-effort: a failed send never fails the PATCH.
    expect(resetBlock).toContain('.catch(() => undefined);');
  });

  it('notice sits AFTER the update + USER_UPDATED audit (send-once semantics)', () => {
    const updateIdx = src.indexOf('const updated = await db.user.update(');
    const auditIdx = src.indexOf("action: 'USER_UPDATED'");
    const noticeIdx = src.indexOf('An administrator changed your MBUMAH HARDWARE password');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(updateIdx);
    expect(noticeIdx).toBeGreaterThan(auditIdx);
  });
});
