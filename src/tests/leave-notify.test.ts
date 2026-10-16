import { describe, expect, it } from 'vitest';

import {
  LEAVE_DECISION_METADATA_MARKER,
  formatLeaveDay,
  leaveDecisionCopy,
  parseLeaveDecisionExtras,
} from '@/lib/hr/leave-notify';

const APPROVED_INPUT = {
  status: 'APPROVED' as const,
  firstName: 'John',
  lastName: 'Kamau',
  leaveTypeName: 'Annual Leave',
  startDate: '2026-02-02T00:00:00.000Z',
  endDate: '2026-02-04T00:00:00.000Z',
  workingDays: 3,
};

describe('leaveDecisionCopy', () => {
  it('builds approved copy with title, message and SUCCESS type', () => {
    const copy = leaveDecisionCopy(APPROVED_INPUT);
    expect(copy.title).toBe('Leave approved - Annual Leave');
    expect(copy.message).toBe('John Kamau: your Annual Leave request for 3 days (2 Feb 2026 - 4 Feb 2026) was approved.');
    expect(copy.notifType).toBe('SUCCESS');
    expect(copy.priority).toBe('NORMAL');
  });

  it('uses singular "day" for one-day requests', () => {
    const copy = leaveDecisionCopy({ ...APPROVED_INPUT, workingDays: 1 });
    expect(copy.message).toContain('for 1 day (2 Feb 2026 - 4 Feb 2026)');
    expect(copy.emailSubject).toContain('(1 day)');
  });

  it('builds declined copy including the rejection reason', () => {
    const copy = leaveDecisionCopy({
      ...APPROVED_INPUT,
      status: 'REJECTED',
      rejectionReason: 'Stock-take week: annual leave frozen 20-21 Oct.',
    });
    expect(copy.title).toBe('Leave declined - Annual Leave');
    expect(copy.notifType).toBe('WARNING');
    expect(copy.message).toContain('was declined.');
    expect(copy.message).toContain('Reason: Stock-take week: annual leave frozen 20-21 Oct.');
  });

  it('declined copy without a reason omits the Reason suffix', () => {
    const copy = leaveDecisionCopy({ ...APPROVED_INPUT, status: 'REJECTED', rejectionReason: null });
    expect(copy.message).not.toContain('Reason:');
    expect(copy.emailHtml).not.toContain('Reason');
  });

  it('escapes HTML-sensitive content in the email body', () => {
    const copy = leaveDecisionCopy({
      ...APPROVED_INPUT,
      status: 'REJECTED',
      lastName: '<script>&"',
      rejectionReason: '"Stock-take" <week>',
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    expect(copy.emailHtml).toContain('&quot;Stock-take&quot; &lt;week&gt;');
  });

  it('renders the decision badge with the approved accent', () => {
    const ok = leaveDecisionCopy(APPROVED_INPUT);
    expect(ok.emailHtml).toContain('>APPROVED</span>');
    const no = leaveDecisionCopy({ ...APPROVED_INPUT, status: 'REJECTED' });
    expect(no.emailHtml).toContain('>DECLINED</span>');
  });

  it('includes the decider footer only when a label is given', () => {
    const withLabel = leaveDecisionCopy({ ...APPROVED_INPUT, decidedByLabel: 'owner@mbumahhardware.co.ke' });
    expect(withLabel.emailHtml).toContain('Decided by owner@mbumahhardware.co.ke.');
    const without = leaveDecisionCopy(APPROVED_INPUT);
    expect(without.emailHtml).not.toContain('Decided by');
  });
});

describe('formatLeaveDay', () => {
  it('formats in UTC deterministically', () => {
    expect(formatLeaveDay('2026-02-02T00:00:00.000Z')).toBe('2 Feb 2026');
    expect(formatLeaveDay('2025-12-31T23:59:59.000Z')).toBe('31 Dec 2025');
  });

  it('returns the raw input when unparseable (fail-soft)', () => {
    expect(formatLeaveDay('not-a-date')).toBe('not-a-date');
  });
});

describe('parseLeaveDecisionExtras', () => {
  it('parses valid decision metadata', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_DECISION_METADATA_MARKER, leaveRequestId: 'req_1', status: 'APPROVED', decidedByLabel: 'Owner' })
    );
    expect(extras).toEqual({ leaveRequestId: 'req_1', status: 'APPROVED', decidedByLabel: 'Owner' });
  });

  it('yields no extras on malformed JSON or wrong shapes (fail-soft)', () => {
    expect(parseLeaveDecisionExtras('not json')).toEqual({});
    expect(parseLeaveDecisionExtras('{"leaveRequestId":42}')).toEqual({});
    expect(parseLeaveDecisionExtras(null)).toEqual({});
    expect(parseLeaveDecisionExtras(undefined)).toEqual({});
    expect(parseLeaveDecisionExtras('')).toEqual({});
  });

  it('marker constant is stable - the feed query relies on it', () => {
    expect(LEAVE_DECISION_METADATA_MARKER).toBe('leave_decision');
  });
});
