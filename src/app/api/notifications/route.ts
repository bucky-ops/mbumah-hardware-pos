import { type NextRequest, NextResponse } from 'next/server';
import { db, rawDb, runWithTenant, runWithoutTenant } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
// FORMAT UNIFICATION (task 12-d): canonical en-KE KES formatter for money toasts
// (accepts Prisma Decimal / string / number safely).
import { formatKES } from '@/lib/utils/financialMath';
// v2.27.0: flatten the digest copy's metadata (scheduleId / manual /
// emailStatus) into feed fields so the notification center can surface the
// delivery outcome + a "Manage schedule" deep link. Pure, fail-soft mapper.
import { parseDigestNotificationExtras } from '@/lib/hr/digest-notification-view';
// v2.31.0: leave-decision feed rows - marker constant for the category-HR
// metadata split + the fail-soft extras parser for the status chip.
import {
  LEAVE_CANCEL_METADATA_MARKER,
  LEAVE_CORRECTED_METADATA_MARKER,
  LEAVE_DECISION_METADATA_MARKER,
  LEAVE_ON_BEHALF_METADATA_MARKER,
  LEAVE_EDITED_METADATA_MARKER,
  LEAVE_REQUEST_METADATA_MARKER,
  parseLeaveDecisionExtras,
} from '@/lib/hr/leave-notify';
import {
  PAYROLL_APPROVED_METADATA_MARKER,
  PAYROLL_POSTED_METADATA_MARKER,
  PAYSLIP_ISSUED_METADATA_MARKER,
  PAYROLL_DISBURSED_METADATA_MARKER,
  PAYROLL_PAID_METADATA_MARKER,
} from '@/lib/hr/payroll/run-digest';

export const dynamic = 'force-dynamic';

export interface NotificationData {
  id: string;
  // v2.12.7 (PR C): 'security' - durable SECURITY-category Notification rows
  // (privilege-abuse lockouts, discount-spam alerts) now surface in the feed.
  // v2.24.0: 'hr_digest' - durable HR-category digest copies (scheduled and
  // manual report digests) addressed to the session user.
  // v2.31.0: 'leave_decision' - leave APPROVED/DECLINED bell rows written by
  // PUT /api/leaves for the employee's linked user.
  // v2.32.0: 'leave_request' - new-request rows written by POST /api/leaves
  // for the store's decision-capable users (targetTab → Payroll Leave desk).
  // v2.33.0: 'leave_cancel' - cancellation rows (manager-cancel or employee
  // withdrawal) with violet accents + Cancelled chip.
  // v2.38.0: 'leave_on_behalf' - employee-facing rows for requests HR filed
  // in their name; violet surface, portal deep link.
  // v2.40.0: 'leave_edited' - employee-facing rows for requests HR corrected
  // in place (edit window); indigo surface, portal deep link.
  // v2.43.0: 'leave_corrected' - approver-facing rows for the same
  // corrections (the approvals group was notified of the ORIGINAL request);
  // amber surface, targetTab → Payroll Leave desk.
  // v2.47.0: 'payroll_approved' - payroll-run approval digest rows (maker
  // + the store's payroll group); emerald surface, targetTab → payroll
  // Pay Runs desk, honest delivery chip from metadata.emailStatus.
  // v2.48.0: 'payroll_posted' - posting digest rows (journal + payslips
  // issued); sky surface, same desk, same honest delivery chip.
  // v2.49.0: 'payslip_issued' - EMPLOYEE-facing personal rows (one per
  // portal-linked employee, own payslip number + net only); teal surface,
  // deep link → the portal Payslips page.
  // v2.50.0: 'payroll_disbursed' - disbursement digest rows (M-Pesa B2C
  // batch or manual confirmation, per-payslip payment CSV); amber surface,
  // targetTab → payroll Pay Runs desk, honest delivery chip.
  // v2.51.0: 'payroll_paid' - EMPLOYEE-facing personal "you've been paid"
  // rows (one per portal-linked employee whose payslip settled PAID, own
  // receipt in hand); emerald surface, deep link → the portal Payslips page.
  type: 'out_of_stock' | 'low_stock' | 'overdue_rental' | 'large_debt' | 'new_customer' | 'recent_transaction' | 'security' | 'hr_digest' | 'leave_decision' | 'leave_request' | 'leave_cancel' | 'leave_on_behalf' | 'leave_edited' | 'leave_corrected' | 'payroll_approved' | 'payroll_posted' | 'payslip_issued' | 'payroll_disbursed' | 'payroll_paid';
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  isRead: boolean;
  targetTab: string;
  // v2.12.7 (PR C): raw Notification.category so the Alerts panel can filter
  // (the synthesized sections below carry no category - undefined).
  category?: string;
  // v2.24.0: deep link for HR digest rows (open the exact report tab).
  actionUrl?: string;
  actionLabel?: string;
  // v2.27.0: flattened Notification.metadata (digest copies only) - delivery
  // outcome chip, manual marker and the schedule deep link.
  scheduleId?: string;
  manual?: boolean;
  emailStatus?: 'SENT' | 'FAILED';
  // v2.31.0: decision status on leave_decision rows - drives the emerald
  // Approved / amber Declined rail + chip in the notification center.
  leaveStatus?: 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

async function getHandler(request: NextRequest, session?: AuthSession): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');

  if (!storeId) {
    return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
  }

  return runWithTenant(storeId, async () => {
    const notifications: NotificationData[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Out of stock products
    const outOfStockProducts = await db.product.findMany({
      where: {
        storeId,
        quantityInStock: { lte: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    for (const p of outOfStockProducts) {
      notifications.push({
        id: `oos-${p.id}`,
        type: 'out_of_stock',
        title: 'Out of Stock',
        description: `${p.name} (${p.sku}) is completely out of stock${p.category ? ` in ${p.category.name}` : ''}`,
        severity: 'critical',
        timestamp: p.updatedAt.toISOString(),
        isRead: false,
        targetTab: 'inventory',
      });
    }

    // 2. Low stock products
    const lowStockProducts = await db.product.findMany({
      where: {
        storeId,
        quantityInStock: { gt: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        quantityInStock: true,
        reorderLevel: true,
        unitType: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { quantityInStock: 'asc' },
      take: 50,
    });

    for (const p of lowStockProducts) {
      // v2.5.8 FIX: Decimal valueOf() degrades `<=` to lexicographic STRING
      // comparison ("100" <= "9" → true) which fabricated low-stock alerts
      // for healthy stock. Coerce to numbers before comparing.
      if (Number(p.quantityInStock) <= Number(p.reorderLevel)) {
        notifications.push({
          id: `low-${p.id}`,
          type: 'low_stock',
          title: 'Low Stock Alert',
          description: `${p.name} has only ${Math.round(Number(p.quantityInStock))} ${p.unitType.toLowerCase()}s left (reorder at ${Math.round(Number(p.reorderLevel))})`,
          severity: 'warning',
          timestamp: p.updatedAt.toISOString(),
          isRead: false,
          targetTab: 'inventory',
        });
      }
    }

    // 3. Overdue rentals
    const overdueRentals = await db.equipmentRental.findMany({
      where: {
        storeId,
        status: 'OVERDUE',
      },
      include: {
        product: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { expectedReturnDate: 'asc' },
      take: 20,
    });

    for (const r of overdueRentals) {
      const daysOverdue = Math.floor(
        (now.getTime() - r.expectedReturnDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      notifications.push({
        id: `rental-${r.id}`,
        type: 'overdue_rental',
        title: 'Overdue Rental',
        description: `${r.product.name} rented by ${r.customer.name} is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
        severity: 'critical',
        timestamp: r.expectedReturnDate.toISOString(),
        isRead: false,
        targetTab: 'rentals',
      });
    }

    // 4. Large outstanding debts (balance > 50,000, not settled)
    const largeDebts = await db.debtLedger.findMany({
      where: {
        storeId,
        balance: { gt: 50000 },
        status: { not: 'SETTLED' },
      },
      include: {
        customer: { select: { name: true } },
      },
      orderBy: { balance: 'desc' },
      take: 20,
    });

    for (const d of largeDebts) {
      const isOverdue = d.status === 'OVERDUE';
      notifications.push({
        id: `debt-${d.id}`,
        type: 'large_debt',
        title: isOverdue ? 'Overdue Debt' : 'Large Outstanding Debt',
        description: `${d.customer.name} owes ${formatKES(d.balance)}${isOverdue ? ' (OVERDUE)' : ''}`,
        severity: isOverdue ? 'critical' : 'warning',
        timestamp: d.dueDate.toISOString(),
        isRead: false,
        targetTab: 'customers',
      });
    }

    // 5. New customers registered (last 7 days)
    const newCustomers = await db.customer.findMany({
      where: {
        storeId,
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    for (const c of newCustomers) {
      const hoursAgo = Math.floor(
        (now.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60)
      );
      notifications.push({
        id: `newcust-${c.id}`,
        type: 'new_customer',
        title: 'New Customer',
        description: `${c.name} registered ${hoursAgo < 24 ? `${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} ago` : `${Math.floor(hoursAgo / 24)} day${Math.floor(hoursAgo / 24) !== 1 ? 's' : ''} ago`}`,
        severity: 'info',
        timestamp: c.createdAt.toISOString(),
        isRead: false,
        targetTab: 'customers',
      });
    }

    // 6. Recent transactions (last 24 hours)
    const recentTransactions = await db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: twentyFourHoursAgo },
        transactionType: 'SALE',
      },
      include: {
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const t of recentTransactions) {
      const minutesAgo = Math.floor(
        (now.getTime() - t.createdAt.getTime()) / (1000 * 60)
      );
      if (minutesAgo < 60) {
        notifications.push({
          id: `txn-${t.id}`,
          type: 'recent_transaction',
          title: 'Recent Sale',
          description: `${t.customer?.name || 'Walk-in'} - ${formatKES(t.totalAmount)} via ${t.paymentMethod}${minutesAgo <= 1 ? ' (just now)' : ` (${minutesAgo}m ago)`}`,
          severity: 'info',
          timestamp: t.createdAt.toISOString(),
          isRead: false,
          targetTab: 'transactions',
        });
      }
    }

    // 7. v2.12.7 (PR C): durable SECURITY-category notifications
    // The privilege-abuse lockout engine (auth.ts noteDeniedAndMaybeLock) and
    // the discount-spam detector (src/lib/abuse.ts) write Notification rows
    // (category SECURITY) addressed to BRANCH_MANAGERs / SUPER_ADMINs. This
    // feed previously surfaced NONE of them (sections 1-6 are synthesized
    // from business tables) - so the bell badge and the Alerts panel silently
    // dropped security alerts. Pull the recipient's rows explicitly.
    //
    // rawDb (v2.57.0): security notifications are addressed BY USER ID, not
    // by branch - a SUPER_ADMIN's rows carry the OFFENDER's storeId (or null),
    // and tenant narrowing would hide them while browsing another branch.
    // The hardened client's runWithoutTenant bypass reads AsyncLocalStorage
    // at interceptor time and could observe the OUTER runWithTenant context
    // inside a Next.js request (the v2.57.0 prod bug: org-wide feed sections
    // silently vanished) - the un-intercepted rawDb client makes the
    // user-addressed read unconditional. The WHERE clause still constrains
    // every row to the session user, so no data crosses a visibility line.
    if (session?.userId) {
      try {
        const securityNotifications = await runWithoutTenant(() =>
          rawDb.notification.findMany({
            where: {
              category: 'SECURITY',
              userId: session.userId,
              createdAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        );

        for (const n of securityNotifications) {
          notifications.push({
            id: `sec-${n.id}`,
            type: 'security',
            title: n.title,
            description: n.message,
            // Priority URGENT (lockout) → red bell; HIGH (spam pattern) → amber.
            severity: n.priority === 'URGENT' ? 'critical' : 'warning',
            timestamp: n.createdAt.toISOString(),
            isRead: false,
            targetTab: 'security',
            category: 'SECURITY',
          });
        }
      } catch {
        /* security section must never break the rest of the feed */
      }
    }

    // 8. v2.24.0: durable HR digest notifications (category HR) - the
    // notification-center copies of scheduled + manual HR report digests
    // (report-schedule-service.writeDigestNotification). Addressed BY USER
    // ID (the actor / schedule creator), so - like the security rows above -
    // they are read with runWithoutTenant: rows may carry any storeId (or
    // null for org-wide schedules) and the tenant extension would hide them
    // while browsing another branch.
    // v2.31.0: leave-decision rows share category HR - they are excluded here
    // (metadata marker) and surfaced by section 9 as their own feed type.
    // v2.38.0 QA FIX: the NOT filter only excluded 'leave_decision', so
    // every marker written since (leave_request, leave_cancel,
    // leave_on_behalf) was ALSO swept in here and rendered TWICE — once as
    // a fake hr_digest row and once as its real leave surface. Exclude all
    // four leave markers; section 9 owns them.
    if (session?.userId) {
      try {
        // rawDb (v2.57.0): the digest copies are addressed BY USER ID and
        // org-wide schedules write storeId NULL - the leaked tenant
        // narrowing excluded every one of them from the feed (the bell's
        // "Email failed" tab rendered empty on prod while the rows sat in
        // the DB). rawDb makes the user-addressed read unconditional; the
        // WHERE clause still scopes every row to the session user.
        const hrDigestNotifications = await runWithoutTenant(() =>
          rawDb.notification.findMany({
            where: {
              category: 'HR',
              userId: session.userId,
              createdAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
              NOT: {
                OR: [
                  { metadata: { contains: LEAVE_DECISION_METADATA_MARKER } },
                  { metadata: { contains: LEAVE_REQUEST_METADATA_MARKER } },
                  { metadata: { contains: LEAVE_CANCEL_METADATA_MARKER } },
                  { metadata: { contains: LEAVE_ON_BEHALF_METADATA_MARKER } },
                  { metadata: { contains: LEAVE_EDITED_METADATA_MARKER } },
                  { metadata: { contains: LEAVE_CORRECTED_METADATA_MARKER } },
                  // v2.47.0: payroll approval rows own their surface (section 9).
                  { metadata: { contains: PAYROLL_APPROVED_METADATA_MARKER } },
                  // v2.48.0: payroll posting rows own their surface (section 9).
                  { metadata: { contains: PAYROLL_POSTED_METADATA_MARKER } },
                  // v2.49.0: personal payslip-issued rows own their surface
                  // (section 9).
                  { metadata: { contains: PAYSLIP_ISSUED_METADATA_MARKER } },
                  // v2.50.0: disbursement digest rows own their surface
                  // (section 9).
                  { metadata: { contains: PAYROLL_DISBURSED_METADATA_MARKER } },
                  // v2.51.0: personal paid rows own their surface (section 9).
                  { metadata: { contains: PAYROLL_PAID_METADATA_MARKER } },
                ],
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        );

        for (const n of hrDigestNotifications) {
          // v2.27.0: metadata → feed fields (fail-soft; malformed metadata
          // simply yields no extras and the row renders without the chips).
          const extras = parseDigestNotificationExtras(n.metadata);
          notifications.push({
            id: `hr-${n.id}`,
            type: 'hr_digest',
            title: n.title,
            description: n.message,
            // Failed deliveries ride priority HIGH -> amber popup so a
            // broken digest cadence is never silent; successes stay quiet.
            severity: n.priority === 'URGENT' || n.priority === 'HIGH' ? 'warning' : 'info',
            timestamp: n.createdAt.toISOString(),
            isRead: false,
            targetTab: 'hr-digest',
            category: 'HR',
            actionUrl: n.actionUrl ?? undefined,
            actionLabel: n.actionLabel ?? undefined,
            scheduleId: extras.scheduleId,
            manual: extras.manual,
            emailStatus: extras.emailStatus,
          });
        }
      } catch {
        /* HR digest section must never break the rest of the feed */
      }
    }

    // 9. v2.31.0 + v2.32.0: leave notifications (category HR, metadata
    // markers) - decision rows (PUT /api/leaves → the employee's linked
    // user) and submission rows (POST /api/leaves → the store's
    // decision-capable users). Read with runWithoutTenant for the same
    // reason as the security/digest rows.
    if (session?.userId) {
      try {
        // rawDb (v2.57.0): same user-addressed contract as sections 7/8 -
        // store-scoped rows survive tenant narrowing today, but an
        // organisation-wide leave/payroll copy (storeId NULL) would vanish
        // exactly like the digest rows did. The WHERE clause still scopes
        // every row to the session user.
        const leaveNotifications = await runWithoutTenant(() =>
          rawDb.notification.findMany({
            where: {
              category: 'HR',
              userId: session.userId,
              createdAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
              OR: [
                { metadata: { contains: LEAVE_DECISION_METADATA_MARKER } },
                { metadata: { contains: LEAVE_REQUEST_METADATA_MARKER } },
                { metadata: { contains: LEAVE_CANCEL_METADATA_MARKER } },
                // v2.38.0: the employee-facing rows for requests HR filed
                // in their name.
                { metadata: { contains: LEAVE_ON_BEHALF_METADATA_MARKER } },
                // v2.40.0: the employee-facing rows for requests HR corrected
                // in place (edit window).
                { metadata: { contains: LEAVE_EDITED_METADATA_MARKER } },
                // v2.43.0: the approver-facing rows for the same corrections
                // (the approvals group re-checks before deciding).
                { metadata: { contains: LEAVE_CORRECTED_METADATA_MARKER } },
                // v2.47.0: payroll-run approval digest rows (maker + the
                // store's payroll group) with the headline numbers.
                { metadata: { contains: PAYROLL_APPROVED_METADATA_MARKER } },
                // v2.48.0: payroll-run posting digest rows (journal +
                // payslips issued) with the same headline numbers.
                { metadata: { contains: PAYROLL_POSTED_METADATA_MARKER } },
                // v2.49.0: employee-facing "your payslip is issued" rows —
                // one per portal-linked employee, own numbers only.
                { metadata: { contains: PAYSLIP_ISSUED_METADATA_MARKER } },
                // v2.50.0: disbursement digest rows (money left the door —
                // M-Pesa B2C batch or manual confirmation).
                { metadata: { contains: PAYROLL_DISBURSED_METADATA_MARKER } },
                // v2.51.0: employee-facing "you've been paid" rows — one per
                // portal-linked employee whose payslip settled PAID, own
                // receipt in hand, own numbers only.
                { metadata: { contains: PAYROLL_PAID_METADATA_MARKER } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        );

        for (const n of leaveNotifications) {
          const extras = parseLeaveDecisionExtras(n.metadata);
          // Rows written before v2.32.0 carry no kind - they are decisions.
          const kind = extras.kind ?? 'leave_decision';
          if (kind === 'leave_request') {
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_request',
              title: n.title,
              description: n.message,
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              // In-shell destination: the HR Leave desk lives on the
              // Payroll tab - switch tabs instead of navigating away.
              targetTab: 'payroll',
              category: 'HR',
            });
          } else if (kind === 'leave_cancel') {
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_cancel',
              title: n.title,
              description: n.message,
              // Cancellations are quiet info rows - nothing needs a
              // decision, the balance already healed on cancel.
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              // Manager-cancel rows address the employee (portal page);
              // self-cancel rows address the approvals group (Payroll tab
              // Leave desk). The metadata flag routes each audience to the
              // right destination.
              targetTab: extras.cancelledByManager === true ? 'dashboard' : 'payroll',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
              leaveStatus: 'CANCELLED',
            });
          } else if (kind === 'leave_on_behalf') {
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_on_behalf',
              title: n.title,
              description: n.message,
              // The employee does not need to act, but the row must stand
              // out from self-filed requests — violet "Entered by HR"
              // surface with the portal deep link (review or withdraw
              // while PENDING).
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: '',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
            });
          } else if (kind === 'leave_edited') {
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_edited',
              title: n.title,
              description: n.message,
              // v2.40.0: HR corrected the request in place — a quiet info
              // row (no action needed; the status stays PENDING) with the
              // indigo "Corrected by HR" surface and the portal deep link
              // so the employee can read the corrected values on their card.
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: '',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
            });
          } else if (kind === 'leave_corrected') {
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_corrected',
              title: n.title,
              description: n.message,
              // v2.43.0: the request an approver was notified of was
              // corrected under them — a quiet info row with the amber
              // "re-check before deciding" surface that deep-links the
              // Payroll tab's Leave desk, where the corrected row lives.
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: 'payroll',
              category: 'HR',
            });
          } else if (kind === 'payroll_approved') {
            notifications.push({
              id: `payroll-${n.id}`,
              type: 'payroll_approved',
              title: n.title,
              description: n.message,
              // v2.47.0: the run you prepared (or co-own the payroll
              // decision for) was approved — an emerald info row that
              // deep-links the Payroll tab's Pay Runs desk, where the
              // post / disburse actions live. A FAILED email delivery
              // rides 'warning' so a broken send is never silent.
              severity: extras.emailStatus === 'FAILED' ? 'warning' : 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: 'payroll',
              category: 'HR',
              // v2.48.0: flatten the delivery stamp so the row renders the
              // honest "Email sent / Email failed" chip (was approve-only
              // before — the banner had it, the bell row didn't).
              emailStatus: extras.emailStatus === 'SENT' || extras.emailStatus === 'FAILED' ? extras.emailStatus : undefined,
            });
          } else if (kind === 'payroll_posted') {
            notifications.push({
              id: `payroll-${n.id}`,
              type: 'payroll_posted',
              title: n.title,
              description: n.message,
              // v2.48.0: the ledger closed — journal in the books, payslip
              // numbers issued. A sky info row (posting never looks like an
              // approval) that deep-links the same Pay Runs desk; a FAILED
              // email delivery rides 'warning' exactly like the approval row.
              severity: extras.emailStatus === 'FAILED' ? 'warning' : 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: 'payroll',
              category: 'HR',
              emailStatus: extras.emailStatus === 'SENT' || extras.emailStatus === 'FAILED' ? extras.emailStatus : undefined,
            });
          } else if (kind === 'payslip_issued') {
            notifications.push({
              id: `payslip-${n.id}`,
              type: 'payslip_issued',
              title: n.title,
              description: n.message,
              // v2.49.0: YOUR payslip is issued — a quiet teal info row
              // (personal pay news, never an alarm) that deep-links the
              // portal's Payslips page via the row's actionUrl. The row is
              // personal: it carries only this user's own payslip facts,
              // so there is no email-delivery chip — the notice has no
              // group audience to hide anything from.
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: '',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
            });
          } else if (kind === 'payroll_disbursed') {
            notifications.push({
              id: `payroll-${n.id}`,
              type: 'payroll_disbursed',
              title: n.title,
              description: n.message,
              // v2.50.0: the money left the door — an amber info row (the
              // payment channel and per-batch outcome) that deep-links the
              // Pay Runs desk; a FAILED email delivery rides 'warning'
              // exactly like the approval and posting rows.
              severity: extras.emailStatus === 'FAILED' ? 'warning' : 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: 'payroll',
              category: 'HR',
              emailStatus: extras.emailStatus === 'SENT' || extras.emailStatus === 'FAILED' ? extras.emailStatus : undefined,
            });
          } else if (kind === 'payroll_paid') {
            notifications.push({
              id: `payslip-${n.id}`,
              type: 'payroll_paid',
              title: n.title,
              description: n.message,
              // v2.51.0: YOU'VE been paid — a quiet emerald info row (the
              // personal completion of the pay story: net, receipt, channel)
              // that deep-links the portal's Payslips page via the row's
              // actionUrl. Personal: carries only this user's own payment
              // facts, so there is no email-delivery chip — the notice has
              // no group audience to hide anything from.
              severity: 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: '',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
            });
          } else {
            const declined = n.type === 'WARNING' || extras.status === 'REJECTED';
            notifications.push({
              id: `leave-${n.id}`,
              type: 'leave_decision',
              title: n.title,
              description: n.message,
              // Declined rides 'warning' (amber rail + icon) so the decision
              // is not missed; approvals stay quiet 'info' (emerald rail).
              severity: declined ? 'warning' : 'info',
              timestamp: n.createdAt.toISOString(),
              isRead: false,
              targetTab: 'dashboard',
              category: 'HR',
              actionUrl: n.actionUrl ?? undefined,
              actionLabel: n.actionLabel ?? undefined,
              leaveStatus: declined ? 'REJECTED' : 'APPROVED',
            });
          }
        }
      } catch {
        /* leave section must never break the rest of the feed */
      }
    }

    // Sort: critical first, then warning, then info. Within same severity, newest first.
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    notifications.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return NextResponse.json({
      success: true,
      data: notifications,
      summary: {
        total: notifications.length,
        critical: notifications.filter((n) => n.severity === 'critical').length,
        warning: notifications.filter((n) => n.severity === 'warning').length,
        info: notifications.filter((n) => n.severity === 'info').length,
      },
    });
  });
}

// AUDIT FIX (Task 3-d): session-validated + storeId-param scoping
// (requireStoreAccess). Any store role - dashboard notifications.
// The handler's inner runWithTenant(storeId) keeps its original behavior.
export const GET = withErrorBoundary(requireStoreAccess(getHandler), 'NOTIFICATIONS');
