// POST /api/vouchers/send - deliver a voucher via Email / SMS / WhatsApp
//
// VF-1 (v2.8.0): the client reported "Vouchers are not sending via Email,
// Text (SMS), or WhatsApp". Root cause: the vouchers tab only composed
// prompt()+wa.me/sms:/mailto: DEEP LINKS - nothing was ever actually sent,
// and the unconfigured Twilio paths returned FAKE success (sim_ message ids).
// This endpoint performs the REAL dispatch (Resend for email, Twilio for
// SMS/WhatsApp), records an honest delivery status on the existing Message
// model (no schema change), and still returns a wa.me deep-link so the UI
// can offer "Open in WhatsApp" as a fallback when no gateway is configured.
//
// Request:  { voucherId, channel: 'EMAIL'|'SMS'|'WHATSAPP', recipient, customerId? }
// Response: { success, data: { status: 'SENT'|'FAILED'|'SIMULATED',
//             messageId, message, waLink?, providerMessageId?, error?, channel, recipient } }
//   • SENT - the gateway accepted the message (providerMessageId set).
//   • FAILED - gateway unconfigured or provider error (error explains why).
//   • SIMULATED - same as FAILED but specifically "gateway not configured";
//                 the Message row still records FAILED (nothing was delivered).
//
// Auth: any store role (withSessionAuth). The session is NOT passed to the
// handler - re-derive it with getSessionFromRequest(request) (v2.7.1 learning:
// withSessionAuth publishes the tenant context via AsyncLocalStorage instead).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest } from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email-service';
import { notificationService } from '@/lib/notification-helpers';
import { formatKES } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

const VALID_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
type SendChannel = (typeof VALID_CHANNELS)[number];

/**
 * Normalize a Kenyan phone number to E.164 (+254XXXXXXXXX).
 * Mirrors notification-helpers.normalizeKePhone so a recipient that passes
 * here will also pass Twilio's stricter server-side normalization.
 */
function normalizeKePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (/^\+254\d{9}$/.test(cleaned)) return cleaned;
  if (/^254\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^0\d{9}$/.test(cleaned)) return `+254${cleaned.slice(1)}`;
  return null;
}

/** Minimal HTML escaping - voucher name/description are user-entered. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Prisma's generated Decimal type (structural - avoids importing the runtime).
type PrismaDecimal = Parameters<typeof formatKES>[0];

/**
 * Build the voucher message text. MIRRORS the 'voucher' branch of
 * /api/whatsapp/send-document (same emojis, same field order) so every
 * channel carries an identical, WhatsApp-styled rendition. Store name comes
 * from the voucher's store record - never hardcoded.
 */
function buildVoucherMessage(
  voucher: {
    code: string;
    name: string;
    voucherType: string;
    value: PrismaDecimal;
    description: string | null;
    minimumPurchase: PrismaDecimal;
    maxDiscount: PrismaDecimal | null;
    startDate: Date;
    endDate: Date | null;
    currentUses: number;
    maxUses: number;
  },
  storeName: string,
): string {
  let message = `\u{1F381} *VOUCHER* ${voucher.code}\n`;
  message += `From: ${storeName}\n`;
  message += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
  message += `\u{1F3F7}\uFE0F Name: ${voucher.name}\n`;
  message += `\u{1F4CB} Type: ${voucher.voucherType}\n`;
  if (voucher.voucherType === 'PERCENTAGE') {
    message += `\u{1F4B0} Value: ${Number(voucher.value)}% off\n`;
  } else if (voucher.voucherType === 'FIXED') {
    message += `\u{1F4B0} Value: ${formatKES(voucher.value)} off\n`;
  } else if (voucher.voucherType === 'FREE_PRODUCT') {
    message += `\u{1F381} Value: Free Product\n`;
  } else {
    message += `\u{1F4B0} Value: ${formatKES(voucher.value)}\n`;
  }
  if (voucher.description) message += `\u{1F4DD} ${voucher.description}\n`;
  if (Number(voucher.minimumPurchase) > 0)
    message += `\u{1F512} Min. Purchase: ${formatKES(voucher.minimumPurchase)}\n`;
  if (voucher.maxDiscount)
    message += `\u{1F4CA} Max Discount: ${formatKES(voucher.maxDiscount)}\n`;
  message += `\u{1F4C5} Valid: ${new Date(voucher.startDate).toLocaleDateString('en-KE')}${voucher.endDate ? ' - ' + new Date(voucher.endDate).toLocaleDateString('en-KE') : ' onwards'}\n`;
  message += `\u{1F504} Uses: ${voucher.currentUses}/${voucher.maxUses}\n`;
  message += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
  message += `\u{1F511} Code: *${voucher.code}*\n`;
  message += `\nUse this code at checkout! \u{1F6D2}`;
  return message;
}

async function sendVoucherHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;

  // withSessionAuth does NOT pass the session to the handler - re-derive it.
  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const { voucherId, channel, recipient, customerId } = (body ?? {}) as {
    voucherId?: string;
    channel?: string;
    recipient?: string;
    customerId?: string;
  };

  if (!voucherId || !channel || !recipient) {
    return Response.json(
      { success: false, error: 'voucherId, channel, and recipient are required.' },
      { status: 400 }
    );
  }

  if (!VALID_CHANNELS.includes(channel as SendChannel)) {
    return Response.json(
      { success: false, error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(', ')}` },
      { status: 400 }
    );
  }
  const sendChannel = channel as SendChannel;

  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    include: { store: { select: { id: true, name: true } } },
  });
  if (!voucher) {
    return Response.json(
      { success: false, error: 'Voucher not found.' },
      { status: 404 }
    );
  }

  const storeName = voucher.store?.name || 'Mbumah Hardware';

  // Per-channel recipient validation (fail fast with a clean 400 - nothing
  // was attempted yet, so no Message row is persisted for input errors).
  let normalizedPhone: string | null = null;
  if (sendChannel === 'EMAIL') {
    if (!recipient.includes('@')) {
      return Response.json(
        { success: false, error: 'Invalid email address.' },
        { status: 400 }
      );
    }
  } else {
    normalizedPhone = normalizeKePhone(recipient);
    if (!normalizedPhone) {
      return Response.json(
        { success: false, error: 'Invalid phone number. Use a Kenyan number e.g. 0712345678 or +254712345678.' },
        { status: 400 }
      );
    }
  }

  // Server-built message text (single source of truth for all channels).
  const message = buildVoucherMessage(voucher, storeName);
  const subject = `Voucher ${voucher.code}`;

  // Simple text-friendly HTML rendition for the Resend path.
  const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
  <h2 style="color: #10b981;">${escapeHtml(storeName)}</h2>
  <pre style="white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.5;">${escapeHtml(message)}</pre>
  <hr />
  <p style="font-size: 12px; color: #6b7280;">Show this code at checkout or enter it in the Voucher field of your order.</p>
</div>`;

  // Dispatch through the real gateways
  let status: 'SENT' | 'FAILED' = 'FAILED';
  let simulated = false;
  let providerMessageId: string | undefined;
  let errorMessage: string | undefined;

  if (sendChannel === 'EMAIL') {
    // Resend path (email-service never throws - failures come back as results).
    if (!isEmailConfigured()) {
      errorMessage = 'Email gateway not configured (RESEND_API_KEY missing)';
    } else {
      const result = await sendEmail({
        to: recipient,
        subject: `Your voucher from ${storeName} - ${voucher.code}`,
        html: emailHtml,
        text: message,
        userId: session.userId,
        type: 'VOUCHER',
        metadata: { voucherId: voucher.id, voucherCode: voucher.code, voucherName: voucher.name },
      });
      if (result.success) {
        status = 'SENT';
        providerMessageId = result.messageId;
      } else {
        errorMessage = result.error || 'Email send failed.';
      }
    }
  } else {
    // Twilio path (notification-helpers returns honest simulated failures).
    const result =
      sendChannel === 'SMS'
        ? await notificationService.sendSms(recipient, message)
        : await notificationService.sendWhatsApp(recipient, message);
    if (result.success) {
      status = 'SENT';
      providerMessageId = result.providerMessageId;
    } else {
      errorMessage = result.errorMessage || 'Send failed.';
      simulated = !!result.simulated;
    }
  }

  // wa.me deep-link fallback (WHATSAPP only) - built like send-document so
  // the UI can offer "Open in WhatsApp" when the gateway is unconfigured.
  let waLink: string | null = null;
  if (sendChannel === 'WHATSAPP' && normalizedPhone) {
    const digits = normalizedPhone.replace(/^\+/, '');
    waLink = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }

  // Persist an honest Message row (existing model - no schema change).
  // SIMULATED sends are stored as FAILED: nothing actually left the building.
  let messageId = '';
  try {
    const messageRow = await db.message.create({
      data: {
        storeId: voucher.storeId,
        customerId: customerId || null,
        channel: sendChannel,
        messageType: 'VOUCHER',
        subject,
        content: message,
        status,
        waLink,
        sentAt: status === 'SENT' ? new Date() : null,
        createdBy: session.userId,
      },
    });
    messageId = messageRow.id;
  } catch (err) {
    // Non-critical: a Message-logging failure must not mask the send result.
    console.error('[vouchers/send] Failed to persist Message row:', err);
  }

  const responseStatus = simulated ? 'SIMULATED' : status;

  await systemLog({
    action: status === 'SENT' ? 'VOUCHER_SENT' : 'VOUCHER_SEND_FAILED',
    component: LogComponent.FINANCIAL,
    severity: status === 'SENT' ? LogSeverity.INFO : LogSeverity.WARN,
    message:
      status === 'SENT'
        ? `Voucher ${voucher.code} sent via ${sendChannel} to ${recipient}`
        : `Voucher ${voucher.code} ${sendChannel} send to ${recipient} failed: ${errorMessage || 'unknown error'}`,
    userId: session.userId,
    storeId: voucher.storeId,
    metadata: {
      voucherId: voucher.id,
      voucherCode: voucher.code,
      channel: sendChannel,
      recipient,
      status: responseStatus,
      simulated,
      error: errorMessage || null,
      messageId,
      providerMessageId: providerMessageId || null,
    },
  });

  return Response.json({
    success: status === 'SENT',
    data: {
      status: responseStatus,
      messageId,
      message,
      waLink,
      providerMessageId: providerMessageId || null,
      error: errorMessage || null,
      channel: sendChannel,
      recipient,
    },
  });
}

export const POST = withErrorBoundary(
  withSessionAuth(sendVoucherHandler),
  'VOUCHER_SEND'
);
