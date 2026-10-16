// EMAIL DELIVERY PERSISTENCE TESTS - v2.25.0
//
// Regression guard for the NotificationLog model: the central email service
// has always written every outbound attempt to db.notificationLog, but the
// model was missing from schema.prisma — writes were silently swallowed and
// GET /api/notifications/logs failed at runtime. These tests pin the
// persistence contract now that the model exists:
//   • provider success  → NotificationLog row status=SENT + sentAt + the
//     messageId merged into metadata (never blocks the result).
//   • provider failure  → status=FAILED + the error message.
//   • unconfigured key  → status=FAILED with the "not configured" warning
//     (the dev/CI default path; previously recorded nowhere).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
  });
  return {
    notificationLog: model(),
    notification: model(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
});

const resendState = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendState.send };
  },
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/types', () => ({
  LogSeverity: { WARN: 'WARN', ERROR: 'ERROR', INFO: 'INFO' },
  LogComponent: { SYSTEM: 'SYSTEM' },
}));

import { sendEmail } from '@/lib/email-service';

beforeEach(() => {
  vi.clearAllMocks();
  db.notificationLog.create.mockResolvedValue({});
  process.env.RESEND_API_KEY = 're_test_key_123';
  process.env.EMAIL_FROM = 'test@mbumahhardware.co.ke';
  resendState.send.mockReset();
  // The email service is server-only: jsdom defines `window`, which would
  // short-circuit every send with "Email service can only be used on the
  // server". Unset it for the duration of each test.
  vi.stubGlobal('window', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('email service NotificationLog persistence', () => {
  it('records a SENT row with sentAt + messageId on provider success', async () => {
    resendState.send.mockResolvedValue({ data: { id: 'resend-abc' }, error: null });

    const result = await sendEmail({
      to: ['owner@mbumahhardware.co.ke'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      text: 'hi',
      type: 'HR_REPORT_DIGEST',
      metadata: { scheduleId: 'sched-1' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('resend-abc');
    expect(db.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'HR_REPORT_DIGEST',
          recipient: 'owner@mbumahhardware.co.ke',
          status: 'SENT',
          sentAt: expect.any(Date),
          subject: 'Test digest',
          error: null,
        }),
      }),
    );
    const arg = db.notificationLog.create.mock.calls[0][0] as { data: { metadata: string } };
    expect(JSON.parse(arg.data.metadata)).toMatchObject({ scheduleId: 'sched-1', messageId: 'resend-abc' });
  });

  it('records a FAILED row with the provider error and returns success=false', async () => {
    resendState.send.mockRejectedValue(new Error('provider down'));

    const result = await sendEmail({
      to: ['owner@mbumahhardware.co.ke'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      text: 'hi',
      type: 'HR_REPORT_DIGEST',
    });

    expect(result.success).toBe(false);
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('provider down'),
          sentAt: null,
        }),
      }),
    );
  });

  it('records the API-error variant (Resend returns error payload, not a throw)', async () => {
    resendState.send.mockResolvedValue({ data: null, error: { message: 'invalid from address' } });

    const result = await sendEmail({
      to: ['owner@mbumahhardware.co.ke'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      type: 'HR_REPORT_DIGEST',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid from address');
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', error: 'invalid from address' }),
      }),
    );
  });

  it('records the skipped-send FAILED row when RESEND_API_KEY is missing (dev default)', async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail({
      to: ['owner@mbumahhardware.co.ke'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      type: 'HR_REPORT_DIGEST',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('RESEND_API_KEY not configured');
    // Regression: this path was previously recorded nowhere because the
    // NotificationLog model was missing from the schema.
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', sentAt: null }),
      }),
    );
  });

  it('records a FAILED row for invalid recipients without touching the provider', async () => {
    const result = await sendEmail({
      to: ['not-an-email'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      type: 'HR_REPORT_DIGEST',
    });

    expect(result.success).toBe(false);
    expect(resendState.send).not.toHaveBeenCalled();
    expect(db.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', recipient: 'not-an-email' }),
      }),
    );
  });

  it('a NotificationLog write failure never masks the send result', async () => {
    resendState.send.mockResolvedValue({ data: { id: 'resend-ok' }, error: null });
    db.notificationLog.create.mockRejectedValue(new Error('log write blew up'));

    const result = await sendEmail({
      to: ['owner@mbumahhardware.co.ke'],
      subject: 'Test digest',
      html: '<p>hi</p>',
      type: 'HR_REPORT_DIGEST',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('resend-ok');
  });
});
