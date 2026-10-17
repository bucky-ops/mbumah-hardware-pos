// MBUMAH HARDWARE POS - digest notification view mapper tests (v2.27.0)
//
// Covers parseDigestNotificationExtras: the pure, fail-soft mapper that
// flattens a digest Notification.metadata string into the feed fields
// (scheduleId / manual / emailStatus) rendered by the notification center.
// The feed must NEVER break on malformed metadata — every bad shape degrades
// to an empty extras object.
//
// v2.28.0 adds isFailedEmailDigest: the pure predicate behind the
// notification center's "Email failed" filter tab.

import { describe, it, expect } from 'vitest';
import { parseDigestNotificationExtras, isFailedEmailDigest, isRetryableDigestFailure } from '@/lib/hr/digest-notification-view';

describe('parseDigestNotificationExtras', () => {
  it('parses a complete metadata payload', () => {
    const raw = JSON.stringify({ scheduleId: 'sched-1', manual: true, emailStatus: 'FAILED' });
    expect(parseDigestNotificationExtras(raw)).toEqual({
      scheduleId: 'sched-1',
      manual: true,
      emailStatus: 'FAILED',
    });
  });

  it('parses a success payload without the manual flag', () => {
    const raw = JSON.stringify({ scheduleId: 'sched-2', emailStatus: 'SENT' });
    expect(parseDigestNotificationExtras(raw)).toEqual({ scheduleId: 'sched-2', emailStatus: 'SENT' });
  });

  it('returns {} for null / undefined / empty / non-string input', () => {
    expect(parseDigestNotificationExtras(null)).toEqual({});
    expect(parseDigestNotificationExtras(undefined)).toEqual({});
    expect(parseDigestNotificationExtras('')).toEqual({});
    expect(parseDigestNotificationExtras(42)).toEqual({});
  });

  it('returns {} for malformed JSON', () => {
    expect(parseDigestNotificationExtras('not-json{')).toEqual({});
    expect(parseDigestNotificationExtras('{"scheduleId":')).toEqual({});
  });

  it('returns {} for JSON that is not an object (array / scalar)', () => {
    expect(parseDigestNotificationExtras('[]')).toEqual({});
    expect(parseDigestNotificationExtras('"schedule-1"')).toEqual({});
    expect(parseDigestNotificationExtras('42')).toEqual({});
    expect(parseDigestNotificationExtras('null')).toEqual({});
  });

  it('drops fields with an unexpected shape instead of coercing', () => {
    expect(parseDigestNotificationExtras(JSON.stringify({ scheduleId: 42 }))).toEqual({});
    expect(parseDigestNotificationExtras(JSON.stringify({ scheduleId: '   ' }))).toEqual({});
    expect(parseDigestNotificationExtras(JSON.stringify({ manual: 'yes' }))).toEqual({});
    expect(parseDigestNotificationExtras(JSON.stringify({ emailStatus: 'PENDING' }))).toEqual({});
    expect(parseDigestNotificationExtras(JSON.stringify({ emailStatus: null }))).toEqual({});
  });

  it('keeps unrelated metadata keys out of the extras (allow-list only)', () => {
    const raw = JSON.stringify({
      scheduleId: 'sched-3',
      emailStatus: 'SENT',
      manual: false,
      messageId: 'resend-9',
      recipientCount: 3,
      reportKey: 'headcount',
    });
    // manual: false is dropped (only `true` is meaningful).
    expect(parseDigestNotificationExtras(raw)).toEqual({
      scheduleId: 'sched-3',
      emailStatus: 'SENT',
    });
  });
});

describe('isFailedEmailDigest', () => {
  it('matches only hr_digest rows whose email delivery FAILED', () => {
    expect(isFailedEmailDigest({ type: 'hr_digest', emailStatus: 'FAILED' })).toBe(true);
  });

  it('does not match SENT digests, non-digest rows, or rows without a stamp', () => {
    expect(isFailedEmailDigest({ type: 'hr_digest', emailStatus: 'SENT' })).toBe(false);
    expect(isFailedEmailDigest({ type: 'hr_digest' })).toBe(false);
    expect(isFailedEmailDigest({ type: 'security', emailStatus: 'FAILED' })).toBe(false);
    expect(isFailedEmailDigest({ type: 'out_of_stock', emailStatus: 'FAILED' })).toBe(false);
  });

  it('is fail-soft on malformed rows (null / scalar / array)', () => {
    expect(isFailedEmailDigest(null)).toBe(false);
    expect(isFailedEmailDigest(undefined)).toBe(false);
    expect(isFailedEmailDigest('hr_digest')).toBe(false);
    expect(isFailedEmailDigest(42)).toBe(false);
    expect(isFailedEmailDigest([{ type: 'hr_digest', emailStatus: 'FAILED' }])).toBe(false);
  });

  it('ignores extra truthy junk in matching rows (predicate, not validator)', () => {
    expect(
      isFailedEmailDigest({ type: 'hr_digest', emailStatus: 'FAILED', severity: 'info', junk: true }),
    ).toBe(true);
  });
});

// v2.57.0: isRetryableDigestFailure — the pure predicate behind the
// notification center's "Retry delivery" affordance on FAILED digest rows.
// The retry endpoint is schedule-scoped (POST /api/hr/reports/schedules/
// [id]/resend re-derives the missed set server-side), so a row qualifies
// ONLY when it is an hr_digest copy, its email FAILED, and it still names
// its scheduleId.
describe('isRetryableDigestFailure', () => {
  it('matches FAILED hr_digest rows that name their schedule', () => {
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: 'sched-1' }),
    ).toBe(true);
  });

  it('trims whitespace-only scheduleIds away (fail-soft, not coerced)', () => {
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: '   ' }),
    ).toBe(false);
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: ' sched-2 ' }),
    ).toBe(true);
  });

  it('refuses SENT digests, unstamped digests, and schedule-less failures', () => {
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'SENT', scheduleId: 'sched-1' }),
    ).toBe(false);
    expect(isRetryableDigestFailure({ type: 'hr_digest', scheduleId: 'sched-1' })).toBe(false);
    expect(isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED' })).toBe(false);
  });

  it('refuses non-hr_digest rows even when they carry the same fields', () => {
    expect(
      isRetryableDigestFailure({ type: 'payroll_posted', emailStatus: 'FAILED', scheduleId: 'run-1' }),
    ).toBe(false);
    expect(
      isRetryableDigestFailure({ type: 'payroll_disbursed', emailStatus: 'FAILED', scheduleId: 'run-1' }),
    ).toBe(false);
    expect(
      isRetryableDigestFailure({ type: 'security', emailStatus: 'FAILED', scheduleId: 'sched-1' }),
    ).toBe(false);
  });

  it('refuses scheduleIds with an unexpected shape instead of coercing', () => {
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: 42 }),
    ).toBe(false);
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: null }),
    ).toBe(false);
    expect(
      isRetryableDigestFailure({ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: ['sched-1'] }),
    ).toBe(false);
  });

  it('is fail-soft on malformed rows (null / scalar / array)', () => {
    expect(isRetryableDigestFailure(null)).toBe(false);
    expect(isRetryableDigestFailure(undefined)).toBe(false);
    expect(isRetryableDigestFailure('hr_digest')).toBe(false);
    expect(isRetryableDigestFailure(42)).toBe(false);
    expect(
      isRetryableDigestFailure([{ type: 'hr_digest', emailStatus: 'FAILED', scheduleId: 'sched-1' }]),
    ).toBe(false);
  });

  it('ignores extra truthy junk in matching rows (predicate, not validator)', () => {
    expect(
      isRetryableDigestFailure({
        type: 'hr_digest',
        emailStatus: 'FAILED',
        scheduleId: 'sched-3',
        manual: true,
        severity: 'warning',
        junk: 'yes',
      }),
    ).toBe(true);
  });
});
