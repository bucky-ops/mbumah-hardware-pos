// POST /api/notifications/email
//
// Sends an email notification through the centralized email service. The
// caller provides a `type` (which template to use), the `recipient` email
// address, and a `data` payload that matches the chosen template's shape.
//
// Auth: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER (senior staff who need to
// trigger notifications — cashiers don't).
//
// The route always returns 200 with `{ success, messageId?, error? }` so the
// caller can distinguish "the API call worked" (200) from "the email was
// delivered" (success=true). A 4xx/5xx status is only used for input
// validation or auth failures — never for a Resend delivery failure, since
// that's recorded in NotificationLog and surfaced to the UI.
//
// Every send is logged to the NotificationLog table by `sendEmail()`.

import { type NextRequest } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import {
  sendReceiptEmail,
  sendLowStockAlert,
  sendDailyReport,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendLoyaltyTierUpgrade,
  NotificationType,
  type ReceiptEmailParams,
  type LowStockAlertParams,
  type DailyReportParams,
  type WelcomeEmailParams,
  type PasswordResetEmailParams,
  type TierUpgradeEmailParams,
} from '@/lib/email-service';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set<string>([
  NotificationType.RECEIPT,
  NotificationType.LOW_STOCK,
  NotificationType.DAILY_REPORT,
  NotificationType.WELCOME,
  NotificationType.PASSWORD_RESET,
  NotificationType.TIER_UPGRADE,
]);

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

async function sendEmailHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { type, recipient, data } = body as {
    type?: string;
    recipient?: string;
    data?: Record<string, unknown>;
  };

  // ── Validate required fields ─────────────────────────────────────────────
  if (!type || !ALLOWED_TYPES.has(type)) {
    return Response.json(
      {
        success: false,
        error: `Invalid or missing "type". Must be one of: ${[...ALLOWED_TYPES].join(', ')}.`,
      },
      { status: 400 },
    );
  }

  if (!recipient || typeof recipient !== 'string' || !recipient.includes('@')) {
    return Response.json(
      { success: false, error: 'A valid "recipient" email address is required.' },
      { status: 400 },
    );
  }

  if (!data || typeof data !== 'object') {
    return Response.json(
      { success: false, error: 'A "data" object is required.' },
      { status: 400 },
    );
  }

  // ── Dispatch to the appropriate template function ───────────────────────
  // Each branch casts `data` to its strongly-typed payload and calls the
  // corresponding `send*` helper from the email service. The helpers handle
  // env validation, NotificationLog persistence, and error swallowing.
  const userId = session.userId;

  try {
    switch (type) {
      case NotificationType.RECEIPT: {
        const params = {
          to: recipient,
          userId,
          ...(data as Omit<ReceiptEmailParams, 'to'>),
        } as ReceiptEmailParams & { userId: string };

        if (!params.customerName || !params.transaction || !params.store) {
          return Response.json(
            {
              success: false,
              error: 'RECEIPT requires { customerName, transaction, store } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendReceiptEmail(params);
        return Response.json(result);
      }

      case NotificationType.LOW_STOCK: {
        const params = {
          to: recipient,
          userId,
          ...(data as Omit<LowStockAlertParams, 'to'>),
        } as LowStockAlertParams & { userId: string };

        if (!params.products || !Array.isArray(params.products) || !params.storeName) {
          return Response.json(
            {
              success: false,
              error: 'LOW_STOCK requires { products[], storeName } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendLowStockAlert(params);
        return Response.json(result);
      }

      case NotificationType.DAILY_REPORT: {
        const params = {
          to: recipient,
          userId,
          ...(data as Omit<DailyReportParams, 'to'>),
        } as DailyReportParams & { userId: string };

        if (!params.report || !params.storeName || !params.date) {
          return Response.json(
            {
              success: false,
              error: 'DAILY_REPORT requires { report, storeName, date } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendDailyReport(params);
        return Response.json(result);
      }

      case NotificationType.WELCOME: {
        const params = {
          to: recipient,
          ...(data as Omit<WelcomeEmailParams, 'to'>),
        } as WelcomeEmailParams;

        if (!params.customerName) {
          return Response.json(
            {
              success: false,
              error: 'WELCOME requires { customerName } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendWelcomeEmail(params);
        return Response.json(result);
      }

      case NotificationType.PASSWORD_RESET: {
        const params = {
          to: recipient,
          ...(data as Omit<PasswordResetEmailParams, 'to'>),
        } as PasswordResetEmailParams;

        if (!params.resetLink) {
          return Response.json(
            {
              success: false,
              error: 'PASSWORD_RESET requires { resetLink } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendPasswordResetEmail(params);
        return Response.json(result);
      }

      case NotificationType.TIER_UPGRADE: {
        const params = {
          to: recipient,
          ...(data as Omit<TierUpgradeEmailParams, 'to'>),
        } as TierUpgradeEmailParams;

        if (!params.customerName || !params.newTier) {
          return Response.json(
            {
              success: false,
              error: 'TIER_UPGRADE requires { customerName, newTier } in data.',
            },
            { status: 400 },
          );
        }

        const result = await sendLoyaltyTierUpgrade(params);
        return Response.json(result);
      }

      default:
        // Should never reach here — ALLOWED_TYPES filter above guarantees this.
        return Response.json(
          { success: false, error: `Unsupported notification type: ${type}` },
          { status: 400 },
        );
    }
  } catch (err) {
    // The email-service helpers swallow errors internally, so reaching this
    // catch is a real bug — surface it.
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    return Response.json(
      { success: false, error: `Failed to send email: ${errMsg}` },
      { status: 500 },
    );
  }
}

export const POST = withErrorBoundary(
  requireAuth(sendEmailHandler, { roles: ALLOWED_ROLES }),
  'NOTIFICATIONS_EMAIL_SEND',
);
