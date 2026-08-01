// ════════════════════════════════════════════════════════════════════════════
// src/lib/email-service.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Centralized email notification service for MBUMAH HARDWARE POS.
//
// Built on top of the Resend SDK (`import { Resend } from 'resend'`) and the
// HTML templates in `./email-templates`. Every public function:
//   • Creates the Resend client lazily (so the SDK is only initialized when
//     an email is actually sent — keeps cold-start time low for routes that
//     don't send email).
//   • Checks `process.env.RESEND_API_KEY` before sending. If the env var is
//     missing (e.g. in dev), the function logs a warning and returns
//     `{ success: false, error: 'RESEND_API_KEY not configured' }` instead
//     of throwing.
//   • Wraps the send in try/catch and NEVER throws to the caller — failures
//     are returned as `{ success: false, error }` so the calling API route
//     or background job can decide whether to retry, log, or ignore.
//   • Persists an audit row to the `NotificationLog` table for every send
//     attempt (PENDING → SENT/FAILED) so admins can troubleshoot delivery
//     issues from the Notification Center UI.
//
// This module is SSR-ONLY. Never import it from a client component. The
// 'resend' SDK touches `process.env` and the network, both of which are
// server-side concerns.

import { Resend } from 'resend';
import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  receiptTemplate,
  receiptText,
  lowStockTemplate,
  dailyReportTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  tierUpgradeTemplate,
  type ReceiptTemplateData,
  type LowStockTemplateData,
  type DailyReportTemplateData,
} from '@/lib/email-templates';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Optional userId for NotificationLog attribution. */
  userId?: string;
  /** Optional notification type tag (e.g. RECEIPT, LOW_STOCK). */
  type?: string;
  /** Optional metadata to persist in NotificationLog.metadata (JSON string). */
  metadata?: Record<string, unknown>;
}

export interface ReceiptEmailParams {
  to: string;
  customerName: string;
  transaction: ReceiptTemplateData;
  store: { name: string; location?: string; phone?: string; taxPin?: string };
  userId?: string;
}

export interface LowStockAlertParams {
  to: string;
  products: LowStockTemplateData['products'];
  storeName: string;
  userId?: string;
}

export interface DailyReportParams {
  to: string;
  report: DailyReportTemplateData;
  storeName: string;
  date: string;
  userId?: string;
}

export interface WelcomeEmailParams {
  to: string;
  customerName: string;
  storeName?: string;
  loyaltyTier?: string;
  loyaltyPoints?: number;
}

export interface PasswordResetEmailParams {
  to: string;
  resetLink: string;
  customerName?: string;
  expiryHours?: number;
}

export interface TierUpgradeEmailParams {
  to: string;
  customerName: string;
  newTier: string;
  storeName?: string;
}

// ── Notification type enum (mirrors NotificationLog.type) ────────────────────

export const NotificationType = {
  RECEIPT: 'RECEIPT',
  LOW_STOCK: 'LOW_STOCK',
  DAILY_REPORT: 'DAILY_REPORT',
  WELCOME: 'WELCOME',
  PASSWORD_RESET: 'PASSWORD_RESET',
  TIER_UPGRADE: 'TIER_UPGRADE',
  TEST: 'TEST',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the configured "from" email address. Falls back to a sensible
 * default when RESEND_FROM_EMAIL isn't set.
 */
function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL ||
    'MBUMAH HARDWARE <noreply@mbumahhardware.co.ke>'
  );
}

/**
 * True when RESEND_API_KEY is present in the environment. Use this to short-
 * circuit sends in dev environments that don't have email configured.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Lazily create a Resend client. The SDK is only constructed on first send,
 * which keeps cold-start latency low for routes that don't use email.
 */
function createResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }
  return new Resend(apiKey);
}

/**
 * Persist a NotificationLog row. Best-effort — failures are swallowed and
 * logged so they never mask the original email result.
 */
async function logNotification(
  params: Pick<SendEmailParams, 'to' | 'subject' | 'userId' | 'type' | 'metadata'>,
  status: 'SENT' | 'FAILED',
  error?: string,
  messageId?: string,
): Promise<void> {
  try {
    const recipient = Array.isArray(params.to) ? params.to.join(', ') : params.to;
    await db.notificationLog.create({
      data: {
        userId: params.userId || null,
        type: params.type || 'UNKNOWN',
        recipient,
        subject: params.subject,
        status,
        error: error || null,
        metadata: JSON.stringify({
          ...(params.metadata || {}),
          ...(messageId ? { messageId } : {}),
        }),
        sentAt: status === 'SENT' ? new Date() : null,
      },
    });
  } catch (logErr) {
    // Logging must never block the email result — just record to console.
    console.error('[email-service] Failed to persist NotificationLog:', {
      recipient: params.to,
      type: params.type,
      error: logErr instanceof Error ? logErr.message : 'Unknown error',
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Base send function. Sends a single email via Resend and records the result
 * to NotificationLog. Never throws — failures are returned as
 * `{ success: false, error }`.
 *
 * @example
 *   const result = await sendEmail({
 *     to: 'customer@example.com',
 *     subject: 'Hello',
 *     html: '<p>Hi there</p>',
 *     type: 'WELCOME',
 *   });
 */
export async function sendEmail(params: SendEmailParams): Promise<EmailResult> {
  const { to, subject, html, text, userId, type } = params;

  // SSR-safety: never run on the client. The 'resend' SDK is server-only.
  if (typeof window !== 'undefined') {
    return {
      success: false,
      error: 'Email service can only be used on the server.',
    };
  }

  // Env guard: short-circuit gracefully when Resend isn't configured.
  if (!isEmailConfigured()) {
    const warning = 'RESEND_API_KEY not configured — email send skipped.';
    console.warn(`[email-service] ${warning}`, { to, subject, type });
    await logNotification(params, 'FAILED', warning);
    return { success: false, error: warning };
  }

  // Input validation
  const recipients = Array.isArray(to) ? to : [to];
  const validRecipients = recipients.filter((r) => r && typeof r === 'string' && r.includes('@'));
  if (validRecipients.length === 0) {
    const err = 'No valid recipient email address provided.';
    await logNotification(params, 'FAILED', err);
    return { success: false, error: err };
  }

  try {
    const resend = createResendClient();
    const from = getFromEmail();

    const { data, error } = await resend.emails.send({
      from,
      to: validRecipients,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (error) {
      const errMsg = error.message || 'Resend API returned an error.';
      await logNotification(params, 'FAILED', errMsg);
      await systemLog({
        action: 'EMAIL_SEND_FAILED',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.WARN,
        message: `Email to ${validRecipients.join(', ')} (${type || 'unknown'}) failed: ${errMsg}`,
        userId: userId,
        metadata: { recipient: validRecipients, type, subject, error: errMsg },
      }).catch(() => {});
      return { success: false, error: errMsg };
    }

    const messageId = data?.id || `resend_${Date.now()}`;
    await logNotification(params, 'SENT', undefined, messageId);

    return { success: true, messageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown email send error.';
    console.error('[email-service] Send error:', errMsg, { to: validRecipients, subject, type });
    await logNotification(params, 'FAILED', errMsg);
    await systemLog({
      action: 'EMAIL_SEND_EXCEPTION',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.ERROR,
      message: `Email send exception (${type || 'unknown'}): ${errMsg}`,
      userId: userId,
      metadata: { recipient: validRecipients, type, subject, error: errMsg },
    }).catch(() => {});
    return { success: false, error: errMsg };
  }
}

/**
 * Send a customer receipt email after a successful checkout.
 *
 * @example
 *   await sendReceiptEmail({
 *     to: customer.email,
 *     customerName: customer.name,
 *     transaction: { receiptNumber: 'RCP-001', items, subtotal, ... },
 *     store: { name: 'MBUMAH HARDWARE — Juja', phone: '0795 191 909' },
 *   });
 */
export async function sendReceiptEmail(params: ReceiptEmailParams): Promise<EmailResult> {
  const { to, customerName, transaction, store, userId } = params;

  // Merge store info into the template data
  const templateData: ReceiptTemplateData = {
    ...transaction,
    customerName,
    storeName: store.name,
    storeLocation: store.location,
    storePhone: store.phone,
    storeTaxPin: store.taxPin,
  };

  const html = receiptTemplate(templateData);
  const text = receiptText(templateData);

  return sendEmail({
    to,
    subject: `Receipt ${transaction.receiptNumber} — ${store.name}`,
    html,
    text,
    userId,
    type: NotificationType.RECEIPT,
    metadata: {
      receiptNumber: transaction.receiptNumber,
      customerName,
      storeName: store.name,
      totalAmount: transaction.totalAmount,
    },
  });
}

/**
 * Send a low-stock alert email to store managers/owners.
 */
export async function sendLowStockAlert(params: LowStockAlertParams): Promise<EmailResult> {
  const { to, products, storeName, userId } = params;

  const html = lowStockTemplate({
    storeName,
    products,
    generatedAt: new Date().toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  });

  return sendEmail({
    to,
    subject: `⚠️ Low Stock Alert — ${storeName} (${products.length} item${products.length !== 1 ? 's' : ''})`,
    html,
    userId,
    type: NotificationType.LOW_STOCK,
    metadata: {
      storeName,
      productCount: products.length,
      productNames: products.slice(0, 10).map((p) => p.name),
    },
  });
}

/**
 * Send a daily sales report email.
 */
export async function sendDailyReport(params: DailyReportParams): Promise<EmailResult> {
  const { to, report, storeName, date, userId } = params;

  const html = dailyReportTemplate(report);

  return sendEmail({
    to,
    subject: `Daily Sales Report — ${storeName} — ${date}`,
    html,
    userId,
    type: NotificationType.DAILY_REPORT,
    metadata: {
      storeName,
      date,
      totalSales: report.totalSales,
      totalTransactions: report.totalTransactions,
    },
  });
}

/**
 * Send a welcome email to a newly-registered customer.
 */
export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<EmailResult> {
  const { to, customerName, storeName, loyaltyTier, loyaltyPoints } = params;

  const html = welcomeTemplate({ customerName, storeName, loyaltyTier, loyaltyPoints });

  return sendEmail({
    to,
    subject: `Welcome to MBUMAH HARDWARE${storeName ? ` — ${storeName}` : ''}!`,
    html,
    type: NotificationType.WELCOME,
    metadata: { customerName, storeName, loyaltyTier },
  });
}

/**
 * Send a password reset email with a time-limited reset link.
 */
export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams,
): Promise<EmailResult> {
  const { to, resetLink, customerName, expiryHours = 1 } = params;

  const html = passwordResetTemplate({ customerName, resetLink, expiryHours });

  return sendEmail({
    to,
    subject: 'Reset Your MBUMAH HARDWARE Password',
    html,
    type: NotificationType.PASSWORD_RESET,
    metadata: { expiryHours, hasCustomerName: !!customerName },
  });
}

/**
 * Send a loyalty tier upgrade congratulatory email.
 */
export async function sendLoyaltyTierUpgrade(
  params: TierUpgradeEmailParams,
): Promise<EmailResult> {
  const { to, customerName, newTier, storeName } = params;

  const html = tierUpgradeTemplate({ customerName, newTier, storeName });

  return sendEmail({
    to,
    subject: `🎉 You're now ${newTier}! — MBUMAH HARDWARE Loyalty`,
    html,
    type: NotificationType.TIER_UPGRADE,
    metadata: { customerName, newTier, storeName },
  });
}

// ── Higher-level orchestration: low-stock detection ─────────────────────────

/**
 * Scan a store for low-stock products and email an alert to every staff
 * member who has `stockAlertEmails` enabled.
 *
 * Designed to be called from a cron job, manual admin action, or after a
 * stock movement. Non-blocking: errors are logged but never thrown.
 *
 * @returns A summary of products alerted and recipients emailed.
 */
export async function checkAndSendLowStockAlerts(
  storeId: string,
): Promise<{
  lowStockCount: number;
  recipientsEmailed: string[];
  error?: string;
}> {
  const result = { lowStockCount: 0, recipientsEmailed: [] as string[], error: undefined as string | undefined };

  try {
    // 1. Find low-stock products (at or below reorder level, active only)
    const lowStockProducts = await db.product.findMany({
      where: {
        storeId,
        isActive: true,
        quantityInStock: { lte: db.product.fields.reorderLevel },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        quantityInStock: true,
        reorderLevel: true,
        unitType: true,
        category: { select: { name: true } },
      },
      orderBy: { quantityInStock: 'asc' },
      take: 100,
    });

    result.lowStockCount = lowStockProducts.length;

    if (lowStockProducts.length === 0) {
      return result; // Nothing to alert on
    }

    // 2. Resolve supplier info per product (best-effort — products may not
    //    have a linked supplier; that's fine, we just show "—")
    const supplierMap = new Map<string, string>();
    const supplierLinks = await db.purchaseOrderItem.findMany({
      where: {
        productId: { in: lowStockProducts.map((p) => p.id) },
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: { select: { name: true } },
          },
        },
      },
      distinct: ['productId'],
      take: 200,
    }).catch(() => []);

    for (const link of supplierLinks) {
      const supplierName = link.purchaseOrder?.supplier?.name;
      if (supplierName && !supplierMap.has(link.productId)) {
        supplierMap.set(link.productId, supplierName);
      }
    }

    // 3. Find staff users who should receive low-stock alerts
    const recipients = await db.user.findMany({
      where: {
        storeId,
        isActive: true,
        emailNotifications: true,
        stockAlertEmails: true,
        role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] },
      },
      select: { email: true, id: true, name: true },
    });

    if (recipients.length === 0) {
      // No opted-in recipients — log and exit gracefully
      await systemLog({
        action: 'LOW_STOCK_NO_RECIPIENTS',
        component: LogComponent.INVENTORY,
        severity: LogSeverity.INFO,
        message: `Low-stock alert skipped for store ${storeId}: ${lowStockProducts.length} items low but no opted-in recipients.`,
        storeId,
        metadata: { lowStockCount: lowStockProducts.length },
      }).catch(() => {});
      return result;
    }

    // 4. Get the store name for the email
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const storeName = store?.name || 'MBUMAH HARDWARE';

    // 5. Build the product payload for the template
    const productRows = lowStockProducts.map((p) => ({
      name: p.name,
      sku: p.sku,
      currentStock: Number(p.quantityInStock),
      reorderLevel: Number(p.reorderLevel),
      unitType: p.unitType,
      supplierName: supplierMap.get(p.id),
      category: p.category?.name,
    }));

    // 6. Send to each recipient (sequentially to be polite to the API)
    for (const recipient of recipients) {
      const sendResult = await sendLowStockAlert({
        to: recipient.email,
        products: productRows,
        storeName,
        userId: recipient.id,
      });
      if (sendResult.success) {
        result.recipientsEmailed.push(recipient.email);
      }
    }

    await systemLog({
      action: 'LOW_STOCK_ALERT_SENT',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Low-stock alert sent for store ${storeName}: ${lowStockProducts.length} items, ${result.recipientsEmailed.length} recipients.`,
      storeId,
      metadata: {
        lowStockCount: lowStockProducts.length,
        recipients: result.recipientsEmailed,
      },
    }).catch(() => {});

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown low-stock alert error.';
    console.error('[email-service] checkAndSendLowStockAlerts failed:', errMsg);
    result.error = errMsg;
    await systemLog({
      action: 'LOW_STOCK_ALERT_FAILED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.WARN,
      message: `Low-stock alert failed for store ${storeId}: ${errMsg}`,
      storeId,
      metadata: { error: errMsg },
    }).catch(() => {});
    return result;
  }
}
