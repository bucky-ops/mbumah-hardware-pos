import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.45.0 portal SELF-CORRECTION — the employee side of the governed edit
 * window. v2.40.0 gave the HR desk Correct-on-PENDING; this release lets
 * the request OWNER (the employee's linked portal user) correct their own
 * PENDING request from /employees/me/leave instead of withdraw + refile.
 *
 * Covered here:
 *  - PUT /api/leaves EDIT authz contract (static): the owner gate mirrors
 *    the v2.33.0 CANCEL split (decision-capable OR request owner), EDIT is
 *    OUT of the APPROVE/REJECT requireRole gate, the portal sends action
 *    'EDIT' with the owner's own leaveRequestId.
 *  - editLeaveRequest stamps the v2.45.0 editedByUserId provenance column
 *    (deterministic "Corrected by you" vs "Corrected by HR").
 *  - Chip provenance contract (static + pure): portal renders
 *    "Corrected by you" on editedByUserId === selfUserId; desk renders
 *    "self-corrected" on editedByUserId === employeeUserId; DTOs carry the
 *    two ids; listMyLeave exposes editedByUserId.
 *  - Password-changed security notice (v2.45.0 feature 2): the template is
 *    honest (when, sessions revoked, wasn't-you footer, no action link)
 *    and POST /api/profile/password sends it best-effort with type
 *    PASSWORD_CHANGED.
 */

const db = vi.hoisted(() => ({
  leaveRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  employeeLeaveBalance: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/hr/audit', () => ({ hrAudit: vi.fn().mockResolvedValue(undefined), HrEntityType: { EMPLOYEE: 'EMPLOYEE' } }));

import { sendEmail } from '@/lib/email-service';
import { editLeaveRequest } from '@/lib/hr/leave-service';
import { previewWorkingDays } from '@/lib/leave-tab';
import { passwordChangedTemplate } from '@/lib/email-templates';

const ROOT = join(process.cwd(), 'src');
const routeSource = readFileSync(join(ROOT, 'app/api/leaves/route.ts'), 'utf8');
const portalView = readFileSync(join(ROOT, 'app/(selfservice)/employees/me/leave/leave-view.tsx'), 'utf8');
const portalPage = readFileSync(join(ROOT, 'app/(selfservice)/employees/me/leave/page.tsx'), 'utf8');
const selfService = readFileSync(join(ROOT, 'lib/hr/self-service.ts'), 'utf8');
const deskTab = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');
const pwRoute = readFileSync(join(ROOT, 'app/api/profile/password/route.ts'), 'utf8');

const pendingRequest = {
  id: 'lr-self-1',
  storeId: 'store-1',
  employeeId: 'emp-1',
  leaveTypeId: 'lt-annual',
  status: 'PENDING',
  startDate: new Date('2026-11-02T00:00:00.000Z'), // Monday
  endDate: new Date('2026-11-03T00:00:00.000Z'), // Tuesday
  workingDays: 2,
  halfDay: false,
  employee: {
    id: 'emp-1',
    firstName: 'David',
    lastName: 'Otieno',
    email: 'david.otieno@mbumahhardware.co.ke',
    user: { id: 'linked-user-1' },
  },
  leaveType: { id: 'lt-annual', name: 'Annual Leave' },
};

const updatedRow = {
  ...pendingRequest,
  leaveType: { name: 'Annual Leave', code: 'AL' },
};

function mockHappyPath(actorId: string) {
  db.leaveRequest.findUnique.mockResolvedValue(pendingRequest);
  db.leaveRequest.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...updatedRow, editedByUserId: data.editedByUserId }));
  db.leaveRequest.aggregate.mockResolvedValue({ _sum: { workingDays: null } });
  db.employeeLeaveBalance.findFirst
    .mockResolvedValueOnce({ allocatedDays: 10, carryForwardDays: 0, usedDays: 2, pendingDays: 2 })
    .mockResolvedValue(null);
  db.employeeLeaveBalance.update.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ name: 'David Otieno', email: 'david.otieno@mbumahhardware.co.ke' });
  db.user.findMany.mockResolvedValue([{ id: 'approver-1', email: 'juja.manager@mbumahhardware.co.ke' }]);
  db.notification.create.mockResolvedValue({});
  db.notification.createMany.mockResolvedValue({});
  void actorId;
}

beforeEach(() => vi.clearAllMocks());

describe('v2.45.0 PUT /api/leaves — EDIT owner authz', () => {
  it('EDIT is no longer inside the decision-capable requireRole gate', () => {
    const gate = routeSource.split("if (action === 'APPROVE' || action === 'REJECT')")[1] ?? '';
    expect(gate).toContain("requireRole('SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')");
    expect(gate.slice(0, 400)).not.toContain("action === 'EDIT'");
  });

  it('the EDIT authz block mirrors the CANCEL split (decision-capable OR owner → else 403)', () => {
    const cancelBlock = routeSource.split("if (action === 'CANCEL')")[1] ?? '';
    const editBlock = routeSource.split("if (action === 'EDIT')")[1] ?? '';
    for (const block of [cancelBlock, editBlock]) {
      expect(block).toContain("['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role)");
      expect(block).toContain('leaveRequest.employee.user?.id === session.userId');
      expect(block).toContain('status: 403');
    }
    expect(editBlock).toContain('You can only correct your own leave requests.');
  });

  it('EDIT authz runs BEFORE the tenant-scoping check (same lane as CANCEL)', () => {
    const editIdx = routeSource.indexOf("if (action === 'EDIT')");
    const tenantIdx = routeSource.indexOf("if (session.storeId && leaveRequest.storeId !== session.storeId");
    expect(editIdx).toBeGreaterThan(-1);
    expect(tenantIdx).toBeGreaterThan(editIdx);
  });

  it('GET /api/leaves DTO exposes the deterministic provenance pair', () => {
    expect(routeSource).toContain('editedByUserId: r.editedByUserId ?? null');
    expect(routeSource).toContain('employeeUserId: r.employee.user?.id ?? null');
    expect(routeSource).toContain('user: { select: { id: true } }');
  });
});

describe('v2.45.0 editLeaveRequest — editedByUserId provenance stamp', () => {
  it('stamps the acting user id on the correction', async () => {
    mockHappyPath('linked-user-1');
    const updated = await editLeaveRequest({
      requestId: 'lr-self-1',
      actorId: 'linked-user-1',
      actorRole: 'CASHIER',
      startDate: new Date('2026-11-09T00:00:00.000Z'), // Mon
      endDate: new Date('2026-11-10T00:00:00.000Z'), // Tue
    });
    expect(db.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lr-self-1' },
        data: expect.objectContaining({ editedByUserId: 'linked-user-1' }),
      }),
    );
    expect(updated.id).toBe('lr-self-1');
  });

  it('still refuses a non-PENDING request (the window does not widen)', async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
    await expect(
      editLeaveRequest({
        requestId: 'lr-self-1',
        actorId: 'linked-user-1',
        actorRole: 'CASHIER',
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/NOT_EDITABLE/);
    expect(db.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('owner self-correction still fires the approver fan-out and skips the employee leg', async () => {
    mockHappyPath('linked-user-1');
    await editLeaveRequest({
      requestId: 'lr-self-1',
      actorId: 'linked-user-1', // IS the employee's linked user
      actorRole: 'CASHIER',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
    });
    // Employee leg skipped (nobody is notified about their own action)…
    expect(db.notification.create).not.toHaveBeenCalled();
    // …approver leg fired with the correction marker.
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const payload = db.notification.createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(payload.data[0].userId).toBe('approver-1');
    expect(String(payload.data[0].metadata)).toContain('leave_corrected');
  });
});

describe('v2.45.0 portal — Correct action + dialog + provenance chip', () => {
  it('PENDING cards carry the indigo Correct button next to Withdraw', () => {
    expect(portalView).toContain("aria-hidden /> Correct");
    expect(portalView).toContain("border-indigo-300 px-2 text-xs text-indigo-700");
    expect(portalView).toContain("onClick={() => openCorrect(r)}");
  });

  it('the correction dialog PUTs action EDIT to /api/leaves (owner lane)', () => {
    const correctFn = portalView.split('const correct = async')[1] ?? '';
    expect(correctFn).toContain("action: 'EDIT'");
    expect(correctFn).toContain('leaveRequestId: editTarget.id');
    expect(correctFn).toContain("apiSend('/api/leaves', 'PUT'");
    expect(correctFn).toContain('editNote');
  });

  it('no-op guard: Save stays disabled until something changed', () => {
    expect(portalView).toContain('editDirty');
    expect(portalView).toContain('disabled={busy || !editFormReady}');
    expect(portalView).toContain('editNote.trim().length > 0');
  });

  it('balance rail mirrors the server guard (headroom + insufficiency warning)', () => {
    expect(portalView).toContain('editSelfHeadroom');
    expect(portalView).toContain('the server will reject this correction');
    expect(portalView).toContain('previewWorkingDays(');
  });

  it('chip provenance is deterministic: editedByUserId === selfUserId → "Corrected by you"', () => {
    expect(portalView).toContain('r.editedByUserId === selfUserId');
    expect(portalView).toContain('Corrected by you');
    expect(portalView).toContain('Corrected by HR · {r.editedByName}');
  });

  it('the portal page passes the session user id down', () => {
    expect(portalPage).toContain('selfUserId={guard.session.userId}');
  });

  it('listMyLeave exposes editedByUserId on every request row', () => {
    expect(selfService).toContain('editedByUserId: r.editedByUserId ?? null');
  });
});

describe('v2.45.0 HR desk — self-corrected chip nuance', () => {
  it('row chip flips to indigo "self-corrected" when the editor IS the owner', () => {
    expect(deskTab).toContain("l.editedByUserId === l.employeeUserId ? 'self-corrected' : 'corrected'");
    expect(deskTab).toContain("'Self-corrected by ' : 'Corrected by '");
  });

  it('detail dialog relabels a self-correction (no more false "Corrected by HR")', () => {
    expect(deskTab).toContain("? 'Self-corrected' : 'Corrected by HR'");
    expect(deskTab).toContain('border-indigo-200 bg-indigo-50');
  });

  it('the desk DTO interface carries the provenance pair', () => {
    expect(deskTab).toContain('editedByUserId?: string | null;');
    expect(deskTab).toContain('employeeUserId?: string | null;');
  });
});

describe('v2.45.0 password-changed security notice', () => {
  it('POST /api/profile/password sends the notice best-effort with the PASSWORD_CHANGED type', () => {
    expect(pwRoute).toContain('NotificationType.PASSWORD_CHANGED');
    expect(pwRoute).toContain('passwordChangedTemplate({');
    expect(pwRoute).toContain('sessionsRevoked,');
    expect(pwRoute).toContain('.catch(() => undefined)');
  });

  it('the notice fires AFTER the rotation tx commits (order matters)', () => {
    const txIdx = pwRoute.indexOf('await db.$transaction');
    const mailIdx = pwRoute.indexOf('await sendEmail({');
    const sysLogIdx = pwRoute.indexOf("action: 'PASSWORD_CHANGED_SELF'");
    expect(txIdx).toBeGreaterThan(-1);
    expect(sysLogIdx).toBeGreaterThan(txIdx);
    expect(mailIdx).toBeGreaterThan(sysLogIdx);
  });

  it('template is honest: when, devices signed out, was-not-you escalation, no link', () => {
    const html = passwordChangedTemplate({
      userEmail: 'david.otieno@mbumahhardware.co.ke',
      changedAtIso: '2026-10-17T03:30:00.000Z',
      sessionsRevoked: 2,
    });
    expect(html).toContain('david.otieno@mbumahhardware.co.ke');
    expect(html).toContain('2 other sessions');
    expect(html).toContain("Wasn't you?");
    expect(html).toContain('Contact your administrator');
    expect(html).not.toMatch(/href="http/); // a notice, not a click target
    expect(html).toContain('will never ask for your password');
  });

  it('template singularises one revoked session', () => {
    expect(passwordChangedTemplate({ userEmail: 'a@b.c', changedAtIso: new Date().toISOString(), sessionsRevoked: 1 })).toContain('1 other session ');
  });

  it('the send is wired into the NotificationLog audit trail with metadata', () => {
    expect(pwRoute).toContain("type: NotificationType.PASSWORD_CHANGED");
    expect(pwRoute).toContain('metadata: { sessionsRevoked, currentSessionKept: true, changedAtIso }');
    expect(sendEmail).toBeDefined();
  });
});

describe('v2.45.0 client day-count parity', () => {
  it('previewWorkingDays matches the service arithmetic (weekend-skipping, half-day -0.5)', () => {
    expect(previewWorkingDays('2026-11-02', '2026-11-06', false)).toBe(5); // Mon–Fri
    expect(previewWorkingDays('2026-11-07', '2026-11-08', false)).toBe(0); // Sat–Sun
    expect(previewWorkingDays('2026-11-02', '2026-11-03', true)).toBe(1.5); // 2 days − 0.5
    expect(previewWorkingDays('2026-11-10', '2026-11-09', false)).toBe(0); // inverted
  });
});
