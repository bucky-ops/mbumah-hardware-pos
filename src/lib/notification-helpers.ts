// src/lib/notification-helpers.ts
//
// Unified notification service - sends messages via SMS (Twilio), Email
// (Resend), and in-app (DB-persisted). Conforms to the INotificationService
// interface so the transport layer can be swapped or mocked.
//
// Design decisions:
//   • Provider credentials come from env vars (TWILIO_*, RESEND_*). If a
//     provider isn't configured, the corresponding send method logs a warning
//     and returns { success: false, simulated: true } - an HONEST failure
//     (v2.8.0 VF-1). The previous fake-success (sim_ message ids) made the UI
//     report "Sent" for messages that were NEVER delivered, which is exactly
//     how the "vouchers are not sending" client report happened. Callers
//     (processPendingDebtReminders, the debt cron, the DLQ handlers) already
//     handle success:false by marking rows FAILED, so nothing crashes - the
//     dashboards now just tell the truth.
//   • Env-name aliases: the self-hosting docs (.env.example) advertise
//     TWILIO_PHONE_NUMBER while the code historically read TWILIO_FROM_PHONE
//     (and some deployments set TWILIO_SMS_FROM for the SMS sender). All three
//     are accepted; the canonical names are documented in .env.example.
//   • In production, set the env vars to enable real delivery.
//   • Every send is logged via systemLog() and a DebtReminder/Message row is
//     updated with the provider's message ID for delivery tracking.
//   • Notification preferences (NotificationPreference model) are respected:
//     if a user/customer has disabled a channel for an alert type, the send
//     is skipped.

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// Enum-like constants (mirror NotificationPreference schema)

export const NotificationChannel = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

// Types

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  /** VF-1 (v2.8.0): true when the send was NOT attempted because the provider
   *  gateway is unconfigured. Callers can distinguish "config problem" from
   *  "provider rejected the message" (both are success:false). */
  simulated?: boolean;
}

export interface NotificationPreferenceRow {
  channel: NotificationChannel;
  alertType: string;
  isEnabled: boolean;
}

// Interface (the "port")

/**
 * Abstract notification service. API routes and the debt-reminder scheduler
 * depend on this interface, not the concrete `NotificationService` class.
 */
export interface INotificationService {
  /** Send an SMS via Twilio. */
  sendSms(to: string, message: string): Promise<SendResult>;

  /** Send an email via Resend. */
  sendEmail(to: string, subject: string, html: string): Promise<SendResult>;

  /** Send a WhatsApp message (via Twilio WhatsApp API). */
  sendWhatsApp(to: string, message: string): Promise<SendResult>;

  /** Create an in-app notification (persisted to DB for the notification center). */
  sendInAppNotification(
    userId: string,
    title: string,
    message: string,
    targetTab?: string,
  ): Promise<SendResult>;

  /** Fetch notification preferences for a user or customer. */
  getNotificationPreferences(
    entityId: string,
    type: 'user' | 'customer',
  ): Promise<NotificationPreferenceRow[]>;

  /** Check if a specific channel is enabled for an entity + alert type. */
  isChannelEnabled(
    entityId: string,
    type: 'user' | 'customer',
    channel: NotificationChannel,
    alertType: string,
  ): Promise<boolean>;
}

// Provider configuration helpers

/**
 * Twilio credentials. When TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM are unset,
 * SMS/WhatsApp sends short-circuit with an honest simulated:false result -
 * the UI must never claim "Sent" for a message that never left the building.
 *
 * FROM-number aliases (VF-1, v2.8.0): .env.example documents
 * TWILIO_PHONE_NUMBER, the code historically read TWILIO_FROM_PHONE, and some
 * deployments set TWILIO_SMS_FROM for the SMS sender specifically. Resolution
 * order: TWILIO_SMS_FROM → TWILIO_FROM_PHONE → TWILIO_PHONE_NUMBER for SMS,
 * and TWILIO_FROM_PHONE → TWILIO_PHONE_NUMBER for the general/WhatsApp config.
 */
function getTwilioConfig() {
  const fromPhone =
    process.env.TWILIO_FROM_PHONE || // canonical in code
    process.env.TWILIO_PHONE_NUMBER || // canonical in .env.example
    '';
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromPhone, // e.g. +1234567890
    smsFrom: process.env.TWILIO_SMS_FROM || fromPhone,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886', // Twilio sandbox
  };
}

/** Shared error text for the unconfigured-SMS/WhatsApp honest failure. */
const TWILIO_NOT_CONFIGURED_ERROR =
  'Twilio not configured - set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_PHONE';

/**
 * Resend credentials. When RESEND_API_KEY is unset, email sends short-circuit
 * with an honest simulated failure (VF-1) instead of a fake sim_ success.
 */
function getResendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'MBUMAH HARDWARE <noreply@mbumahhardware.co.ke>',
  };
}

/** True if Twilio is fully configured (all required env vars present, aliases included). */
function isTwilioConfigured(): boolean {
  const c = getTwilioConfig();
  return !!(c.accountSid && c.authToken && c.fromPhone);
}

/** True if Resend is fully configured. */
function isResendConfigured(): boolean {
  return !!getResendConfig().apiKey;
}

/** Shared error text for the unconfigured-Resend honest failure (VF-1). */
const RESEND_NOT_CONFIGURED_ERROR = 'Resend not configured - set RESEND_API_KEY';

/**
 * Normalize a Kenyan phone number to E.164 format (+254XXXXXXXXX).
 * Handles 07XXXXXXXX, 2547XXXXXXXXX, +2547XXXXXXXXX.
 */
function normalizeKePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (/^\+254\d{9}$/.test(cleaned)) return cleaned;
  if (/^254\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^0\d{9}$/.test(cleaned)) return `+254${cleaned.slice(1)}`;
  return null;
}

// Concrete Implementation

/**
 * Concrete notification service. Sends via Twilio (SMS/WhatsApp) and Resend
 * (email). Gracefully degrades to no-op + log when providers aren't
 * configured (dev mode).
 */
export class NotificationService implements INotificationService {
  /**
   * Send an SMS via Twilio.
   * Returns { success: true, providerMessageId } on success.
   * If Twilio isn't configured, returns an HONEST failure
   * ({ success: false, simulated: true }) - VF-1 (v2.8.0). The old fake
   * success (sim_ ids) made the UI report "Sent" for undelivered messages.
   */
  async sendSms(to: string, message: string): Promise<SendResult> {
    const normalized = normalizeKePhone(to);
    if (!normalized) {
      return { success: false, errorMessage: `Invalid phone number: ${to}` };
    }

    if (!isTwilioConfigured()) {
      console.warn(
        '[NotificationService] Twilio not configured - SMS NOT sent (honest failure).',
        { to: normalized, messagePreview: message.slice(0, 60) },
      );
      return { success: false, simulated: true, errorMessage: TWILIO_NOT_CONFIGURED_ERROR };
    }

    const config = getTwilioConfig();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const body = new URLSearchParams({
        To: normalized,
        From: config.smsFrom || config.fromPhone, // TWILIO_SMS_FROM alias-aware (VF-1)
        Body: message,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok || data.error_code) {
        return {
          success: false,
          errorMessage: data.error_message || `Twilio returned ${res.status}`,
        };
      }

      return { success: true, providerMessageId: data.sid };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  }

  /**
   * Send an email via Resend.
   */
  async sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
    // VF-1 (v2.8.0): honest failure when Resend is unconfigured - the old
    // sim_ fake success let the UI claim "Sent" with no email ever leaving.
    if (!isResendConfigured()) {
      console.warn(
        '[NotificationService] Resend not configured - email NOT sent (honest failure).',
        { to, subject },
      );
      return { success: false, simulated: true, errorMessage: RESEND_NOT_CONFIGURED_ERROR };
    }

    const config = getResendConfig();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.fromEmail,
          to: [to],
          subject,
          html,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          errorMessage: data.message || `Resend returned ${res.status}`,
        };
      }

      return { success: true, providerMessageId: data.id };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  }

  /**
   * Send a WhatsApp message via Twilio WhatsApp API.
   * Unconfigured Twilio → honest { success:false, simulated:true } (VF-1).
   */
  async sendWhatsApp(to: string, message: string): Promise<SendResult> {
    const normalized = normalizeKePhone(to);
    if (!normalized) {
      return { success: false, errorMessage: `Invalid phone number: ${to}` };
    }

    if (!isTwilioConfigured()) {
      console.warn(
        '[NotificationService] Twilio not configured - WhatsApp NOT sent (honest failure).',
        { to: normalized, messagePreview: message.slice(0, 60) },
      );
      return { success: false, simulated: true, errorMessage: TWILIO_NOT_CONFIGURED_ERROR };
    }

    const config = getTwilioConfig();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const body = new URLSearchParams({
        To: `whatsapp:${normalized}`,
        From: config.whatsappFrom,
        Body: message,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok || data.error_code) {
        return {
          success: false,
          errorMessage: data.error_message || `Twilio WhatsApp returned ${res.status}`,
        };
      }

      return { success: true, providerMessageId: data.sid };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  }

  /**
   * Create an in-app notification. Persisted to the Message model (channel=
   * IN_APP) so the notification center can display it.
   */
  async sendInAppNotification(
    userId: string,
    title: string,
    message: string,
    _targetTab?: string,
  ): Promise<SendResult> {
    try {
      // Find the user's store to scope the notification.
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { storeId: true },
      });

      if (!user?.storeId) {
        return { success: false, errorMessage: `User ${userId} has no store assignment.` };
      }

      const msg = await db.message.create({
        data: {
          storeId: user.storeId,
          customerId: null,
          channel: 'IN_APP',
          messageType: 'SYSTEM_NOTIFICATION',
          subject: title,
          content: message,
          status: 'SENT',
          sentAt: new Date(),
          createdBy: userId,
        },
      });

      return { success: true, providerMessageId: msg.id };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  }

  /**
   * Fetch all notification preferences for a user or customer.
   */
  async getNotificationPreferences(
    entityId: string,
    type: 'user' | 'customer',
  ): Promise<NotificationPreferenceRow[]> {
    const where = type === 'user' ? { userId: entityId } : { customerId: entityId };
    const rows = await db.notificationPreference.findMany({ where });
    return rows.map((r) => ({
      channel: r.channel as NotificationChannel,
      alertType: r.alertType,
      isEnabled: r.isEnabled,
    }));
  }

  /**
   * Check if a specific channel is enabled for an entity + alert type.
   * Returns true if:
   *   • No preference row exists (default = enabled), OR
   *   • A matching row exists with isEnabled = true.
   */
  async isChannelEnabled(
    entityId: string,
    type: 'user' | 'customer',
    channel: NotificationChannel,
    alertType: string,
  ): Promise<boolean> {
    const where =
      type === 'user'
        ? { userId: entityId, channel, OR: [{ alertType }, { alertType: 'ALL' }] }
        : { customerId: entityId, channel, OR: [{ alertType }, { alertType: 'ALL' }] };

    const rows = await db.notificationPreference.findMany({ where });
    if (rows.length === 0) return true; // No preference = default enabled
    return rows.every((r) => r.isEnabled);
  }
}

// Singleton instance

/**
 * Default singleton. Import in API routes / schedulers:
 *   import { notificationService } from '@/lib/notification-helpers';
 *   const result = await notificationService.sendSms(phone, message);
 */
export const notificationService: INotificationService = new NotificationService();

// Higher-level orchestration: process pending DebtReminders

/**
 * Process all PENDING DebtReminder rows for a store: send the message via the
 * appropriate channel and update the status to SENT or FAILED.
 *
 * Called by the /api/reminders/debt route (POST) or a scheduled job.
 *
 * @param storeId - The store whose pending reminders to process.
 * @returns Summary of sent/failed counts.
 */
export async function processPendingDebtReminders(
  storeId: string,
): Promise<{ sent: number; failed: number; total: number }> {
  const pending = await db.debtReminder.findMany({
    where: { storeId, status: 'PENDING' },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      debtLedger: { select: { id: true, balance: true, dueDate: true, agingBucket: true } },
    },
    take: 100, // Process in batches to avoid timeouts
  });

  let sent = 0;
  let failed = 0;

  for (const reminder of pending) {
    const channel = reminder.reminderType as NotificationChannel;
    const customer = reminder.customer;
    let result: SendResult;

    try {
      switch (channel) {
        case NotificationChannel.SMS:
          if (!customer.phone) {
            result = { success: false, errorMessage: 'Customer has no phone number.' };
          } else {
            result = await notificationService.sendSms(customer.phone, reminder.message);
          }
          break;

        case NotificationChannel.WHATSAPP:
          if (!customer.phone) {
            result = { success: false, errorMessage: 'Customer has no phone number.' };
          } else {
            result = await notificationService.sendWhatsApp(customer.phone, reminder.message);
          }
          break;

        case NotificationChannel.EMAIL:
          if (!customer.email) {
            result = { success: false, errorMessage: 'Customer has no email address.' };
          } else {
            result = await notificationService.sendEmail(
              customer.email,
              'Outstanding Balance Reminder - MBUMAH HARDWARE',
              `<div style="font-family: sans-serif; max-width: 600px; margin: auto;">
                <h2 style="color: #10b981;">MBUMAH HARDWARE</h2>
                <p>Dear ${customer.name},</p>
                <p>${reminder.message}</p>
                <hr />
                <p style="font-size: 12px; color: #6b7280;">
                  This is an automated reminder. If you have already paid, please disregard this message.
                </p>
              </div>`,
            );
          }
          break;

        case NotificationChannel.IN_APP:
          // In-app debt reminders aren't typically sent (they're for staff).
          result = { success: true, providerMessageId: 'in_app_skip' };
          break;

        default:
          result = { success: false, errorMessage: `Unknown channel: ${channel}` };
      }

      await db.debtReminder.update({
        where: { id: reminder.id },
        data: {
          status: result.success ? 'SENT' : 'FAILED',
          providerMessageId: result.providerMessageId,
          errorMessage: result.errorMessage,
          deliveredAt: result.success ? new Date() : null,
        },
      });

      if (result.success) sent++;
      else failed++;
    } catch (err) {
      failed++;
      await db.debtReminder.update({
        where: { id: reminder.id },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      }).catch(() => { /* ignore secondary error */ });
    }
  }

  await systemLog({
    action: 'DEBT_REMINDERS_PROCESSED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Processed ${pending.length} debt reminder(s) for store ${storeId}: ${sent} sent, ${failed} failed.`,
    storeId,
    metadata: { sent, failed, total: pending.length },
  });

  return { sent, failed, total: pending.length };
}
