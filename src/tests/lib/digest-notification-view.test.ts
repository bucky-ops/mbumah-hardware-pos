// MBUMAH HARDWARE POS - digest notification view mapper tests (v2.27.0)
//
// Covers parseDigestNotificationExtras: the pure, fail-soft mapper that
// flattens a digest Notification.metadata string into the feed fields
// (scheduleId / manual / emailStatus) rendered by the notification center.
// The feed must NEVER break on malformed metadata — every bad shape degrades
// to an empty extras object.

import { describe, it, expect } from 'vitest';
import { parseDigestNotificationExtras } from '@/lib/hr/digest-notification-view';

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
