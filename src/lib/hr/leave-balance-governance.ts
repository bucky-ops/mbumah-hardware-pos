// MBUMAH HARDWARE POS - Leave balance governance (v2.36.0, spec
// performance/self-service + reporting/compliance bridge)
//
// The v2.35.0 utilisation report flags OVERDRAWN balances but offered no
// governed correction path. This module is that path, built as two service
// functions behind the existing report guard family:
//
//   1. leaveBalanceDrillDown — id-resolving drill-down for one report row.
//      The report DTO itself still carries employeeCode + job title only
//      ("no raw ids by default"); THIS DTO is the exception because it is
//      the correction surface, still gated by hrGuard + scopeWhere.
//   2. adjustLeaveBalance — HR/owner-only, reason-mandatory entitlement
//      adjustment: tenths-exact Decimal math, notes append, hash-chained
//      HR audit event, employee bell row + email (fail-tolerant).
//
// Scope discipline: every query filters employees through the SAME
// scopeWhere(session, scope) used by the reports, so a BRANCH-scoped
// caller can never drill into or adjust another branch's balances, and a
// forged balanceId from outside the caller's scope resolves to null
// (fail-closed NOT_FOUND, never a leak).

import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email-service';
import { hrAudit, HrEntityType } from './audit';
import { resolveReportScope, scopeWhere, type ReportScope } from './reports';
import type { AuthSession } from '@/lib/auth';

type Session = AuthSession;

/** Roles allowed to move entitlement days — mirrors the hr.leave.balance.manage
 *  permission map exactly (ACCOUNTANT deliberately excluded: finance sees the
 *  liability, it does not rewrite entitlements). */
export const ADJUST_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export type LeaveBalanceFlag = 'OVERDRAWN' | 'EXHAUSTED' | 'LOW' | 'OPEN';

/** Same rails as the report (reports.ts flagOf) — kept in step deliberately. */
export function leaveBalanceFlagOf(available: number, committedPct: number): LeaveBalanceFlag {
  if (available < 0) return 'OVERDRAWN';
  if (available === 0) return 'EXHAUSTED';
  if (committedPct >= 80) return 'LOW';
  return 'OPEN';
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Tenths-exact addition: avoids 0.1-style float drift on 1dp day values. */
function addTenths(a: number, bTenths: number): number {
  return (Math.round(a * 10) + bTenths) / 10;
}

// ── Drill-down ────────────────────────────────────────────────────────────

export interface LeaveBalanceDrillDownDto {
  scope: ReportScope;
  year: number;
  /** Server-computed: may the caller open the adjust form? */
  canAdjust: boolean;
  employee: {
    id: string;
    code: string;
    title: string;
    employmentType: string;
    storeName: string;
  };
  type: { id: string; name: string; code: string };
  balance: {
    id: string;
    allocated: number;
    carried: number;
    used: number;
    pending: number;
    encashed: number;
    available: number;
    committedPct: number;
    flag: LeaveBalanceFlag;
    notes: string | null;
    updatedAt: string;
  };
  /** This employee + leave type, requests starting inside the leave year. */
  history: Array<{
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    workingDays: number;
    halfDay: boolean;
    reason: string | null;
    rejectionReason: string | null;
    createdAt: string;
    approvedAt: string | null;
  }>;
}

/**
 * Resolve one report row (employeeCode + typeCode + year) back to its
 * balance within the caller's scope, and assemble the drill-down DTO:
 * balance components, governance notes and the year's request history.
 * Returns null when the caller has no report scope or the row does not
 * resolve inside that scope (never a 403 that would reveal existence).
 */
export async function leaveBalanceDrillDown(
  session: Session,
  year: number,
  employeeCode: string,
  typeCode: string,
  opts?: { storeId?: string | null },
): Promise<LeaveBalanceDrillDownDto | null> {
  const scope = resolveReportScope(session);
  if (!scope) return null;

  const code = String(employeeCode ?? '').trim();
  const type = String(typeCode ?? '').trim();
  if (!code || !type || !Number.isFinite(year)) return null;

  const balance = await db.employeeLeaveBalance.findFirst({
    where: {
      leaveYear: year,
      leaveType: { code: type },
      employee: { AND: [scopeWhere(session, scope, opts?.storeId), { employeeCode: code, deletedAt: null }] },
    },
    select: {
      id: true,
      allocatedDays: true,
      carryForwardDays: true,
      usedDays: true,
      pendingDays: true,
      encashedDays: true,
      notes: true,
      updatedAt: true,
      employee: {
        select: {
          id: true,
          employeeCode: true,
          jobTitle: true,
          employmentType: true,
          store: { select: { name: true } },
        },
      },
      leaveType: { select: { id: true, name: true, code: true } },
    },
  });
  if (!balance) return null;

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const requests = await db.leaveRequest.findMany({
    where: {
      employeeId: balance.employee.id,
      leaveTypeId: balance.leaveType.id,
      startDate: { gte: yearStart, lt: yearEnd },
    },
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      workingDays: true,
      halfDay: true,
      reason: true,
      rejectionReason: true,
      createdAt: true,
      approvedAt: true,
    },
  });

  const allocated = r1(Number(balance.allocatedDays));
  const carried = r1(Number(balance.carryForwardDays));
  const used = r1(Number(balance.usedDays));
  const pending = r1(Number(balance.pendingDays));
  const encashed = r1(Number(balance.encashedDays));
  const available = r1(allocated + carried - used - pending);
  const pool = allocated + carried;
  const committedPct = pool > 0 ? r1(((used + pending) / pool) * 100) : 100;

  return {
    scope,
    year,
    canAdjust: session.role === 'SUPER_ADMIN' || (ADJUST_ROLES as readonly string[]).includes(session.role),
    employee: {
      id: balance.employee.id,
      code: balance.employee.employeeCode ?? '(unassigned)',
      title: balance.employee.jobTitle ?? '(no title)',
      employmentType: balance.employee.employmentType,
      storeName: balance.employee.store?.name ?? '(unknown branch)',
    },
    type: { id: balance.leaveType.id, name: balance.leaveType.name, code: balance.leaveType.code },
    balance: {
      id: balance.id,
      allocated,
      carried,
      used,
      pending,
      encashed,
      available,
      committedPct,
      flag: leaveBalanceFlagOf(available, committedPct),
      notes: balance.notes,
      updatedAt: balance.updatedAt.toISOString(),
    },
    history: requests.map((r) => ({
      id: r.id,
      status: r.status,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      workingDays: Number(r.workingDays),
      halfDay: r.halfDay,
      reason: r.reason,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt.toISOString(),
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    })),
  };
}

// ── Adjustment ────────────────────────────────────────────────────────────

export interface AdjustLeaveBalanceInput {
  balanceId: string;
  /** Signed days at 0.5d granularity; positive grants, negative claws back. */
  deltaDays: number;
  /** Mandatory governance reason (>= 8 chars, stored in audit + notes). */
  reason: string;
}

export type AdjustLeaveBalanceOutcome =
  | {
      ok: true;
      balanceId: string;
      employeeCode: string;
      typeName: string;
      year: number;
      allocatedBefore: number;
      allocatedAfter: number;
      availableAfter: number;
      /** What actually reached the employee — honest delivery facts, not intentions. */
      notified: { bell: boolean; email: boolean };
    }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'; error: string };

const NOTE_PREFIX = '[balance adjust]';

/**
 * Move one balance's allocated days by a signed delta. Governance rails:
 *   - adjuster must hold hr.leave.balance.manage (HR_MANAGER/STORE_OWNER,
 *     SUPER_ADMIN bypass) AND resolve the balance inside their report scope;
 *   - delta is non-zero, |delta| <= 365, at half-day granularity;
 *   - the reason (>= 8 chars) lands in the audit event AND the row notes;
 *   - allocated days can never be driven below zero;
 *   - the employee gets a bell row + email when linked (fail-tolerant).
 */
export async function adjustLeaveBalance(
  session: Session,
  input: AdjustLeaveBalanceInput,
): Promise<AdjustLeaveBalanceOutcome> {
  // 1. Role gate (defence in depth — the route guard already checked).
  const roleOk =
    session.role === 'SUPER_ADMIN' || (ADJUST_ROLES as readonly string[]).includes(session.role);
  if (!roleOk) {
    return { ok: false, code: 'FORBIDDEN', error: 'You do not have permission to adjust leave balances.' };
  }

  // 2. Scope gate — same shape as the reports.
  const scope = resolveReportScope(session);
  if (!scope) {
    return { ok: false, code: 'FORBIDDEN', error: 'You do not have permission to adjust leave balances.' };
  }

  // 3. Validation.
  const raw = Number(input.deltaDays);
  const deltaTenths = Math.round(raw * 10); // half-day granularity via tenths
  if (!Number.isFinite(raw) || deltaTenths === 0) {
    return { ok: false, code: 'VALIDATION', error: 'Adjustment must be a non-zero number of days.' };
  }
  if (Math.abs(deltaTenths) > 3650) {
    return { ok: false, code: 'VALIDATION', error: 'Adjustments are capped at ±365 days.' };
  }
  if (Math.abs(deltaTenths) % 5 !== 0) {
    return { ok: false, code: 'VALIDATION', error: 'Adjustments must be in steps of 0.5 days.' };
  }
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 8) {
    return { ok: false, code: 'VALIDATION', error: 'A reason of at least 8 characters is required.' };
  }
  if (reason.length > 500) {
    return { ok: false, code: 'VALIDATION', error: 'Reason must be 500 characters or fewer.' };
  }

  // 4. Resolve the balance INSIDE the caller's scope (fail-closed).
  const balance = await db.employeeLeaveBalance.findFirst({
    where: { id: input.balanceId, employee: scopeWhere(session, scope) },
    select: {
      id: true,
      allocatedDays: true,
      carryForwardDays: true,
      usedDays: true,
      pendingDays: true,
      notes: true,
      leaveYear: true,
      employee: {
        select: {
          id: true,
          employeeCode: true,
          email: true,
          storeId: true,
          user: { select: { id: true, email: true } },
        },
      },
      leaveType: { select: { name: true, code: true } },
    },
  });
  if (!balance) {
    return { ok: false, code: 'NOT_FOUND', error: 'Balance not found in your scope.' };
  }

  const allocatedBefore = Number(balance.allocatedDays);
  const allocatedAfter = addTenths(allocatedBefore, deltaTenths);
  if (allocatedAfter < 0) {
    return {
      ok: false,
      code: 'VALIDATION',
      error: `Adjustment would drive allocated days below zero (${allocatedBefore} allocated).`,
    };
  }

  // 5. Persist: tenths-exact value + governance note appended.
  const stamp = `${NOTE_PREFIX} ${new Date().toISOString().slice(0, 10)} ${deltaTenths > 0 ? '+' : ''}${(deltaTenths / 10).toFixed(1)}d — ${reason}`;
  const priorNotes = balance.notes ?? '';
  const notes = priorNotes.length > 4000 ? `${NOTE_PREFIX}${priorNotes.slice(-4000)}`.trimStart() : priorNotes;
  const nextNotes = notes ? `${notes}\n${stamp}` : stamp;

  await db.employeeLeaveBalance.update({
    where: { id: balance.id },
    data: { allocatedDays: allocatedAfter, notes: nextNotes },
  });

  const carried = Number(balance.carryForwardDays);
  const used = Number(balance.usedDays);
  const pending = Number(balance.pendingDays);
  const availableAfter = r1(allocatedAfter + carried - used - pending);

  // 6. Hash-chained HR audit (field-name-only metadata; reason rides the
  //    dedicated audit field). Fire-and-tolerate like every HR mutation.
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'LEAVE_BALANCE_ADJUSTED',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: balance.employee.id,
    storeId: balance.employee.storeId,
    reason,
    metadata: {
      balanceId: balance.id,
      typeCode: balance.leaveType.code,
      year: balance.leaveYear,
      allocatedBefore,
      allocatedAfter,
      deltaDays: deltaTenths / 10,
    },
  }).catch(() => undefined);

  // 7. Tell the employee (bell row + email, both fail-tolerant).
  const daysLabel = `${(deltaTenths / 10).toFixed(1)} day${Math.abs(deltaTenths) === 5 ? '' : 's'}`;
  const signLabel = deltaTenths > 0 ? 'increased' : 'reduced';
  const notifTitle = `Leave balance ${signLabel} by ${daysLabel}`;
  const notifMessage = `Your ${balance.leaveType.name} balance for ${balance.leaveYear} was ${signLabel} by ${daysLabel}. Reason: ${reason}`;
  const metadata = JSON.stringify({
    kind: 'leave_balance_adjusted',
    balanceId: balance.id,
    year: balance.leaveYear,
    deltaDays: deltaTenths / 10,
  });

  const recipientUserId = balance.employee.user?.id ?? null;
  const recipientEmail = balance.employee.email || balance.employee.user?.email || null;

  // Delivery facts (v2.36.0 QA): an employee without a linked portal user
  // can never receive the bell row, and a dead email channel must not be
  // reported as delivered. Both legs are fail-tolerant AND honest — the
  // outcome carries what ACTUALLY happened so the UI can show it.
  let bellSent = false;
  let emailSent = false;

  if (recipientUserId) {
    bellSent = await db.notification
      .create({
        data: {
          storeId: balance.employee.storeId,
          userId: recipientUserId,
          title: notifTitle,
          message: notifMessage,
          type: 'INFO',
          category: 'HR',
          priority: 'NORMAL',
          actionUrl: '/employees/me/leave',
          actionLabel: 'View my leave',
          metadata,
        },
      })
      .then(() => true)
      .catch(() => false);
  }

  if (recipientEmail && recipientEmail.includes('@')) {
    emailSent = await sendEmail({
      to: recipientEmail,
      subject: `${notifTitle} — ${balance.leaveType.name} (${balance.leaveYear})`,
      text: `${notifMessage}.\n\nNew entitlement: ${allocatedAfter.toFixed(1)} days. This is a governed adjustment recorded in the audit trail; reply to HR if this looks wrong.`,
      html: `<p>${notifMessage}.</p><p>New entitlement: <strong>${allocatedAfter.toFixed(1)} days</strong> of ${balance.leaveType.name} for ${balance.leaveYear}.</p><p style="color:#64748b">This is a governed adjustment recorded in the audit trail; reply to HR if this looks wrong.</p>`,
      userId: recipientUserId ?? undefined,
      type: 'LEAVE_BALANCE_ADJUSTED',
      metadata: { balanceId: balance.id, year: balance.leaveYear },
    })
      .then(() => true)
      .catch(() => false);
  }

  return {
    ok: true,
    balanceId: balance.id,
    employeeCode: balance.employee.employeeCode ?? '(unassigned)',
    typeName: balance.leaveType.name,
    year: balance.leaveYear,
    allocatedBefore: r1(allocatedBefore),
    allocatedAfter,
    availableAfter,
    notified: { bell: bellSent, email: emailSent },
  };
}
