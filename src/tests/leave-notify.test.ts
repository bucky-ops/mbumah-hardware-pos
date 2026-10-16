import { describe, expect, it } from 'vitest';

import {
  LEAVE_CANCEL_METADATA_MARKER,
  LEAVE_DECISION_METADATA_MARKER,
  LEAVE_REQUEST_METADATA_MARKER,
  formatLeaveDay,
  leaveCancelledCopy,
  leaveDecisionCopy,
  leaveSubmissionCopy,
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

describe('leaveSubmissionCopy (v2.32.0 manager direction)', () => {
  const SUBMIT_INPUT = {
    firstName: 'Grace',
    lastName: 'Achieng',
    leaveTypeName: 'Sick Leave',
    startDate: '2026-03-02T00:00:00.000Z',
    endDate: '2026-03-03T00:00:00.000Z',
    workingDays: 2,
    reason: 'Malaria - doctor’s note attached.',
    submittedByLabel: 'cashier@mbumahhardware.co.ke',
  };

  it('builds manager-facing copy with the review call-to-action', () => {
    const copy = leaveSubmissionCopy(SUBMIT_INPUT);
    expect(copy.title).toBe('New leave request - Grace Achieng');
    expect(copy.message).toBe(
      'Grace Achieng requested Sick Leave for 2 days (2 Mar 2026 - 3 Mar 2026). Review it on the Leave desk. Reason: Malaria - doctor’s note attached.'
    );
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });

  it('uses singular "day" for one-day requests', () => {
    const copy = leaveSubmissionCopy({ ...SUBMIT_INPUT, workingDays: 1 });
    expect(copy.message).toContain('for 1 day (2 Mar 2026 - 3 Mar 2026)');
  });

  it('omits the Reason suffix when no reason was given', () => {
    const copy = leaveSubmissionCopy({ ...SUBMIT_INPUT, reason: null });
    expect(copy.message).not.toContain('Reason:');
    expect(copy.emailHtml).not.toContain('Reason</td>');
  });

  it('renders the PENDING REVIEW badge and submitted-by footer', () => {
    const copy = leaveSubmissionCopy(SUBMIT_INPUT);
    expect(copy.emailHtml).toContain('>PENDING REVIEW</span>');
    expect(copy.emailHtml).toContain('Submitted by cashier@mbumahhardware.co.ke.');
    const anonymous = leaveSubmissionCopy({ ...SUBMIT_INPUT, submittedByLabel: null });
    expect(anonymous.emailHtml).not.toContain('Submitted by');
  });

  it('escapes HTML-sensitive content in the email body', () => {
    const copy = leaveSubmissionCopy({
      ...SUBMIT_INPUT,
      lastName: '<b>&amp;',
      reason: '"quotes" & <tags>',
    });
    expect(copy.emailHtml).not.toContain('<b>');
    expect(copy.emailHtml).toContain('&lt;b&gt;');
    expect(copy.emailHtml).toContain('&quot;quotes&quot; &amp; &lt;tags&gt;');
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
  it('parses valid decision metadata including the kind selector', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_DECISION_METADATA_MARKER, leaveRequestId: 'req_1', status: 'APPROVED', decidedByLabel: 'Owner' })
    );
    expect(extras).toEqual({ kind: 'leave_decision', leaveRequestId: 'req_1', status: 'APPROVED', decidedByLabel: 'Owner' });
  });

  it('parses submission metadata as the leave_request kind', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_REQUEST_METADATA_MARKER, leaveRequestId: 'req_2', employeeId: 'emp_1' })
    );
    expect(extras).toEqual({ kind: 'leave_request', leaveRequestId: 'req_2' });
  });

  it('rows without a kind default to decisions at the feed mapping site', () => {
    // The route maps `extras.kind ?? 'leave_decision'` - pre-v2.32.0 rows
    // must keep rendering as decisions.
    const extras = parseLeaveDecisionExtras(JSON.stringify({ leaveRequestId: 'req_3', status: 'REJECTED' }));
    expect(extras.kind).toBeUndefined();
    expect(extras.kind ?? 'leave_decision').toBe('leave_decision');
  });

  it('yields no extras on malformed JSON or wrong shapes (fail-soft)', () => {
    expect(parseLeaveDecisionExtras('not json')).toEqual({});
    expect(parseLeaveDecisionExtras('{"leaveRequestId":42}')).toEqual({});
    expect(parseLeaveDecisionExtras(null)).toEqual({});
    expect(parseLeaveDecisionExtras(undefined)).toEqual({});
    expect(parseLeaveDecisionExtras('')).toEqual({});
  });

  it('marker constants are stable - the feed query relies on them', () => {
    expect(LEAVE_DECISION_METADATA_MARKER).toBe('leave_decision');
    expect(LEAVE_REQUEST_METADATA_MARKER).toBe('leave_request');
  });
});

describe('leaveCancelledCopy (v2.33.0)', () => {
  const CANCEL_INPUT = {
    firstName: 'John',
    lastName: 'Kamau',
    leaveTypeName: 'Annual Leave',
    startDate: '2026-02-02T00:00:00.000Z',
    endDate: '2026-02-04T00:00:00.000Z',
    workingDays: 3,
    cancelledByManager: true,
  };

  it('manager cancel: CANCELLED badge, balance-restoring message', () => {
    const copy = leaveCancelledCopy(CANCEL_INPUT);
    expect(copy.title).toBe('Leave request cancelled - Annual Leave');
    expect(copy.message).toBe(
      'John Kamau: your Annual Leave request for 3 days (2 Feb 2026 - 4 Feb 2026) was cancelled by a manager. The days are back in your available balance.'
    );
    expect(copy.emailHtml).toContain('>CANCELLED<');
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });

  it('employee withdrawal: WITHDRAWN badge, no-decision-needed message', () => {
    const copy = leaveCancelledCopy({ ...CANCEL_INPUT, cancelledByManager: false });
    expect(copy.title).toBe('Leave request withdrawn - Annual Leave');
    expect(copy.message).toBe(
      'John Kamau withdrew their Annual Leave request for 3 days (2 Feb 2026 - 4 Feb 2026). The pending days are released back to their balance - no decision needed.'
    );
    expect(copy.emailHtml).toContain('>WITHDRAWN<');
    expect(copy.emailHtml).toContain('No action needed');
  });

  it('singular day and optional cancelled-by footer', () => {
    const copy = leaveCancelledCopy({ ...CANCEL_INPUT, workingDays: 1, cancelledByLabel: 'owner@mbumahhardware.co.ke' });
    expect(copy.message).toContain('for 1 day (2 Feb 2026 - 4 Feb 2026)');
    expect(copy.emailHtml).toContain('Cancelled by owner@mbumahhardware.co.ke.');
  });

  it('escapes HTML in employee names and leave types', () => {
    const copy = leaveCancelledCopy({
      ...CANCEL_INPUT,
      firstName: '<script>',
      lastName: 'X">v',
      leaveTypeName: 'Sick & Care',
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    expect(copy.emailHtml).toContain('Sick &amp; Care');
  });
});

describe('parseLeaveDecisionExtras - cancel metadata (v2.33.0)', () => {
  it('parses the leave_cancel kind with the cancelledByManager flag', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_CANCEL_METADATA_MARKER, leaveRequestId: 'req_9', employeeId: 'emp_1', cancelledByManager: true })
    );
    expect(extras.kind).toBe('leave_cancel');
    expect(extras.leaveRequestId).toBe('req_9');
    expect(extras.cancelledByManager).toBe(true);
  });

  it('ignores non-boolean cancelledByManager values (fail-soft)', () => {
    const extras = parseLeaveDecisionExtras(JSON.stringify({ kind: 'leave_cancel', cancelledByManager: 'yes' }));
    expect(extras.cancelledByManager).toBeUndefined();
    expect(extras.kind).toBe('leave_cancel');
  });

  it('the cancel marker constant is stable', () => {
    expect(LEAVE_CANCEL_METADATA_MARKER).toBe('leave_cancel');
  });
});
