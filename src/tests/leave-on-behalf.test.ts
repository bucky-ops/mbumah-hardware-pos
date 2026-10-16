import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.38.0 on-behalf leave requests — HR files in an employee's name.
 *
 * Service contracts (db-mocked): requestLeave stamps enteredById/enteredByName
 * on the row, notifies the EMPLOYEE (bell row to the linked user + email)
 * with the leave_on_behalf marker, still fans out to the approvals group
 * (actor excluded, "Entered by HR" footer) and enforces the same balance
 * guard for HR filers as for the portal. Self-filed requests (no marker)
 * never write the employee-facing leg.
 *
 * Authorization (static contract on POST /api/leaves): the legacy handler
 * accepted ANY same-store user for ANY colleague — the gate now restricts
 * non-decision-capable filers to their own linked employee BEFORE the
 * governed requestLeave() path runs (the route no longer creates rows by
 * hand).
 */

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn(), findUnique: vi.fn() },
  leaveType: { findUnique: vi.fn() },
  employeeLeaveBalance: { findFirst: vi.fn() },
  leaveRequest: { create: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'log-1' }) }));
vi.mock('@/lib/hr/audit', () => ({ hrAudit: vi.fn().mockResolvedValue(undefined), HrEntityType: { EMPLOYEE: 'EMPLOYEE' } }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));

import { sendEmail } from '@/lib/email-service';
import { requestLeave, notifyLeaveRequestSubmitted } from '@/lib/hr/leave-service';
import { leaveOnBehalfCopy, leaveSubmissionCopy, parseLeaveDecisionExtras, LEAVE_ON_BEHALF_METADATA_MARKER } from '@/lib/hr/leave-notify';

const ROOT = join(process.cwd(), 'src');

const employeeWithUser = {
  id: 'emp-1',
  firstName: 'David',
  lastName: 'Otieno',
  email: 'david.otieno@mbumahhardware.co.ke',
  user: { id: 'linked-user-1' },
};

const baseInput = {
  employeeId: 'emp-1',
  storeId: 'store-1',
  actorId: 'hr-user-1',
  actorRole: 'STORE_OWNER',
  leaveTypeId: 'lt-annual',
  startDate: new Date('2026-11-02T00:00:00.000Z'),
  endDate: new Date('2026-11-03T00:00:00.000Z'),
  reason: 'Family trip upcountry.',
};

function mockHappyPath() {
  db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
  db.employeeLeaveBalance.findFirst.mockResolvedValue({
    id: 'bal-1', allocatedDays: '21', carryForwardDays: '0', usedDays: '0', pendingDays: '0',
  });
  db.leaveRequest.create.mockImplementation(async ({ data }) => ({
    id: 'lr-new',
    ...data,
    leaveType: { name: 'Annual Leave', code: 'ANNUAL' },
  }));
  db.employee.findUnique.mockResolvedValue(employeeWithUser);
  db.leaveType.findUnique.mockResolvedValue({ name: 'Annual Leave' });
  db.user.findMany.mockResolvedValue([{ id: 'approver-1', email: 'owner@mbumahhardware.co.ke' }]);
  db.notification.createMany.mockResolvedValue({ count: 1 });
  db.notification.create.mockResolvedValue({ id: 'bell-1' });
}

describe('requestLeave — on-behalf filing (v2.38.0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish per test: clearAllMocks wipes call history but keeps
    // implementations from earlier tests (e.g. the user:null override in
    // the no-linked-user case would otherwise leak forward).
    mockHappyPath();
  });

  it('stores enteredById/enteredByName on the created row', async () => {
    await requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' });

    expect(db.leaveRequest.create).toHaveBeenCalledTimes(1);
    const data = db.leaveRequest.create.mock.calls[0][0].data;
    expect(data.enteredById).toBe('hr-user-1');
    expect(data.enteredByName).toBe('Grace Wanjiku');
    expect(data.status).toBe('PENDING');
  });

  it('leaves the marker null for self-filed requests', async () => {
    await requestLeave({ ...baseInput });

    const data = db.leaveRequest.create.mock.calls[0][0].data;
    expect(data.enteredById).toBeNull();
    expect(data.enteredByName).toBeNull();
  });

  it('writes the employee bell row with the leave_on_behalf marker and portal deep link', async () => {
    await requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' });

    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const row = db.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe('linked-user-1');
    expect(row.category).toBe('HR');
    expect(row.actionUrl).toBe('/employees/me/leave');
    expect(row.title).toBe('Leave request filed for you - Annual Leave');
    const meta = JSON.parse(row.metadata);
    expect(meta.kind).toBe('leave_on_behalf');
    expect(meta.leaveRequestId).toBe('lr-new');
    expect(meta.enteredByName).toBe('Grace Wanjiku');
  });

  it('emails the employee a LEAVE_REQUEST notice addressed to them', async () => {
    await requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' });

    // One grouped approver email + one employee email.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const employeeCall = vi.mocked(sendEmail).mock.calls.find(([p]) => (p as { to: string }).to === employeeWithUser.email);
    expect(employeeCall).toBeTruthy();
    if (!employeeCall) throw new Error('employee email call missing');
    const payload = employeeCall[0] as { to: string; type: string; subject: string };
    expect(payload.type).toBe('LEAVE_REQUEST');
    expect(payload.subject).toContain('Leave request filed for you');
    expect(payload.subject).toContain('David Otieno');
  });

  it('skips the employee bell row when the target has no linked user but still emails the employee address', async () => {
    db.employee.findUnique.mockResolvedValue({ ...employeeWithUser, user: null });

    await requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' });

    expect(db.notification.create).not.toHaveBeenCalled();
    const employeeCall = vi.mocked(sendEmail).mock.calls.find(([p]) => (p as { to: string }).to === employeeWithUser.email);
    expect(employeeCall).toBeTruthy();
  });

  it('skips the whole employee-facing leg for self-filed requests', async () => {
    await requestLeave({ ...baseInput });

    expect(db.notification.create).not.toHaveBeenCalled();
    // Only the grouped approver email.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not notify the employee when HR files for their own linked employee', async () => {
    // Same user id as the target's linked user — a self-filed request even
    // though the actor is decision-capable.
    await requestLeave({ ...baseInput, enteredById: 'linked-user-1', enteredByName: 'David Otieno' });

    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('still fans out to the approvals group with the entered-by footer', async () => {
    await requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' });

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'hr-user-1' } }),
      }),
    );
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const copy = leaveSubmissionCopy({
      firstName: 'David',
      lastName: 'Otieno',
      leaveTypeName: 'Annual Leave',
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-03T00:00:00.000Z',
      workingDays: 2,
      enteredByLabel: 'Grace Wanjiku',
    });
    expect(copy.message).toContain('Entered by HR (Grace Wanjiku)');
    expect(copy.emailHtml).toContain('on behalf of the employee');
  });

  it('enforces the balance guard for HR filers too (no overdraft on behalf)', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue({
      id: 'bal-1', allocatedDays: '1', carryForwardDays: '0', usedDays: '0', pendingDays: '0',
    });

    await expect(
      requestLeave({ ...baseInput, enteredById: 'hr-user-1', enteredByName: 'Grace Wanjiku' }),
    ).rejects.toThrow(/INSUFFICIENT_LEAVE_BALANCE/);

    expect(db.leaveRequest.create).not.toHaveBeenCalled();
  });
});

describe('notifyLeaveRequestSubmitted — enteredByLabel propagation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the HR filer label through to the grouped approver copy', async () => {
    db.employee.findUnique.mockResolvedValue({ firstName: 'David', lastName: 'Otieno' });
    db.leaveType.findUnique.mockResolvedValue({ name: 'Annual Leave' });
    db.user.findMany.mockResolvedValue([{ id: 'approver-1', email: 'owner@mbumahhardware.co.ke' }]);
    db.notification.createMany.mockResolvedValue({ count: 1 });

    await notifyLeaveRequestSubmitted({
      leaveRequestId: 'lr-1',
      storeId: 'store-1',
      employeeId: 'emp-1',
      leaveTypeId: 'lt-annual',
      startDate: new Date('2026-11-02T00:00:00.000Z'),
      endDate: new Date('2026-11-03T00:00:00.000Z'),
      workingDays: 2,
      submitterUserId: 'hr-user-1',
      submitterEmail: 'grace@mbumahhardware.co.ke',
      enteredByLabel: 'Grace Wanjiku',
    });

    const row = db.notification.createMany.mock.calls[0][0].data[0];
    expect(row.message).toContain('Entered by HR (Grace Wanjiku)');
    const meta = JSON.parse(row.metadata);
    expect(meta.kind).toBe('leave_request');
  });
});

describe('leaveOnBehalfCopy — employee-facing copy surfaces', () => {
  const input = {
    firstName: 'David',
    lastName: 'Otieno',
    leaveTypeName: 'Annual Leave',
    startDate: '2026-11-02T00:00:00.000Z',
    endDate: '2026-11-03T00:00:00.000Z',
    workingDays: 2,
    enteredByLabel: 'Grace Wanjiku',
    reason: 'Family trip upcountry.',
  };

  it('states who filed the request and what happens next', () => {
    const copy = leaveOnBehalfCopy(input);
    expect(copy.title).toBe('Leave request filed for you - Annual Leave');
    expect(copy.message).toContain('Grace Wanjiku filed a Annual Leave request for you (2 days, 2 Nov 2026 - 3 Nov 2026)');
    expect(copy.message).toContain('pending manager review');
    expect(copy.message).toContain('Family trip upcountry.');
    expect(copy.notifType).toBe('INFO');
  });

  it('renders the violet ENTERED BY HR email with a withdraw hint', () => {
    const copy = leaveOnBehalfCopy(input);
    expect(copy.emailHtml).toContain('ENTERED BY HR');
    expect(copy.emailHtml).toContain('Filed by');
    expect(copy.emailHtml).toContain('Grace Wanjiku');
    expect(copy.emailHtml).toContain('You can withdraw it from your self-service portal while it is still pending.');
    expect(copy.emailText).toContain('Filed by: Grace Wanjiku (HR)');
  });

  it('escapes the filer name in the HTML surface', () => {
    const copy = leaveOnBehalfCopy({ ...input, enteredByLabel: 'Grace <b>Wanjiku</b>' });
    expect(copy.emailHtml).toContain('Grace &lt;b&gt;Wanjiku&lt;/b&gt;');
    expect(copy.emailHtml).not.toContain('<b>Wanjiku</b> (HR)');
  });
});

describe('metadata parsing — leave_on_behalf acceptance', () => {
  it('parses the marker and the filer name', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_ON_BEHALF_METADATA_MARKER, leaveRequestId: 'lr-new', enteredByName: 'Grace Wanjiku' }),
    );
    expect(extras.kind).toBe('leave_on_behalf');
    expect(extras.leaveRequestId).toBe('lr-new');
    expect(extras.enteredByName).toBe('Grace Wanjiku');
  });

  it('rejects malformed JSON fail-soft', () => {
    expect(parseLeaveDecisionExtras('not-json')).toEqual({});
    expect(parseLeaveDecisionExtras(null)).toEqual({});
  });
});

describe('POST /api/leaves — static v2.38.0 contracts', () => {
  const source = readFileSync(join(ROOT, 'app/api/leaves/route.ts'), 'utf8');

  it('gates non-decision-capable filers to their own requests with a 403', () => {
    expect(source).toContain("'You can only file leave requests for yourself.'");
    expect(source).toContain("const isDecisionCapable = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role)");
  });

  it('runs the ownership gate BEFORE the governed creation path', () => {
    const gateAt = source.indexOf("return Response.json(\n      { success: false, error: 'You can only file leave requests for yourself.' },");
    const createAt = source.indexOf('await requestLeave({');
    expect(gateAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(createAt);
  });

  it('delegates creation to requestLeave (no hand-rolled leaveRequest.create in the route)', () => {
    expect(source).toContain('await requestLeave({');
    expect(source).not.toContain('db.leaveRequest.create');
    expect(source).toContain('enteredById: onBehalf ? session.userId : null');
    expect(source).toContain('enteredByName,');
  });

  it('maps INSUFFICIENT_LEAVE_BALANCE to the INSUFFICIENT_BALANCE 400 contract', () => {
    expect(source).toContain("message.startsWith('INSUFFICIENT_LEAVE_BALANCE')");
    expect(source).toContain("code: 'INSUFFICIENT_BALANCE'");
  });

  it('exposes the HR-filer marker on the list mapping', () => {
    expect(source).toContain('enteredByName: r.enteredByName');
  });
});

describe('GET /api/notifications — feed section contracts (v2.38.0 QA fix)', () => {
  const feed = readFileSync(join(ROOT, 'app/api/notifications/route.ts'), 'utf8');

  it('excludes ALL leave markers from the digest sweep (no double-render)', () => {
    const notBlock = feed.slice(feed.indexOf('const hrDigestNotifications'), feed.indexOf("/* HR digest section must never break"));
    expect(notBlock).toContain('NOT: {');
    for (const marker of ['LEAVE_DECISION_METADATA_MARKER', 'LEAVE_REQUEST_METADATA_MARKER', 'LEAVE_CANCEL_METADATA_MARKER', 'LEAVE_ON_BEHALF_METADATA_MARKER', 'LEAVE_EDITED_METADATA_MARKER', 'LEAVE_CORRECTED_METADATA_MARKER']) {
      expect(notBlock).toContain(`contains: ${marker}`);
    }
  });

  it('surfaces leave_on_behalf rows in the leave section with their own type', () => {
    const leaveBlock = feed.slice(feed.indexOf('const leaveNotifications'));
    expect(leaveBlock).toContain('{ metadata: { contains: LEAVE_ON_BEHALF_METADATA_MARKER } }');
    expect(leaveBlock).toContain("type: 'leave_on_behalf'");
    // The employee row deep-links the portal page, not a workspace tab.
    // v2.43.0: the successor branch is now the approver-facing correction
    // fan-out (leave_corrected), not the leave_decision fallback.
    expect(leaveBlock).toContain("actionUrl: n.actionUrl ?? undefined,\n              actionLabel: n.actionLabel ?? undefined,\n            });\n          } else if (kind === 'leave_corrected') {");
  });
});
