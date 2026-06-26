// POST /api/messaging/bulk
//
// Bulk / holiday messaging. Generates wa.me deep links for each recipient
// (we do NOT actually call any 3rd-party WhatsApp gateway — the cashier
// opens each link in WhatsApp). Logs every recipient to the Message table
// for audit purposes. RBAC: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER only.
//
// Body:
//   {
//     storeId, message, channel: 'WHATSAPP'|'SMS',
//     audience: 'ALL' | 'CUSTOMERS_WITH_PHONES' | 'DEBTORS' | 'LOYALTY_MEMBERS',
//     subject?, scheduledAt?
//   }
//
// Response:
//   {
//     totalRecipients,
//     sent: [{customerId, name, phone, waLink}],
//     skipped: [{customerId?, name?, phone?, reason}]
//   }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Channel = 'WHATSAPP' | 'SMS';
type Audience = 'ALL' | 'CUSTOMERS_WITH_PHONES' | 'DEBTORS' | 'LOYALTY_MEMBERS';

interface SendResult {
  customerId: string;
  name: string;
  phone: string;
  waLink: string | null;
}

interface SkipResult {
  customerId?: string;
  name?: string;
  phone?: string;
  reason: string;
}

/** Normalise Kenyan phone numbers to international format (254XXXXXXXXX). */
function normalisePhone(raw: string): string | null {
  if (!raw) return null;
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('254') && p.length === 12) return p;
  if (/^\d{9}$/.test(p)) return '254' + p;
  return null;
}

async function bulkMessagingHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const body = await request.json();
  const {
    storeId,
    message,
    channel,
    audience,
    subject,
    scheduledAt,
  } = body as {
    storeId: string;
    message: string;
    channel: Channel;
    audience: Audience;
    subject?: string;
    scheduledAt?: string;
  };

  if (!storeId || !message) {
    return Response.json(
      { success: false, error: 'storeId and message are required.' },
      { status: 400 },
    );
  }

  const resolvedChannel: Channel = channel === 'SMS' ? 'SMS' : 'WHATSAPP';
  const resolvedAudience: Audience = ['ALL', 'CUSTOMERS_WITH_PHONES', 'DEBTORS', 'LOYALTY_MEMBERS'].includes(
    audience,
  )
    ? audience
    : 'ALL';

  // Build the customer query depending on the audience
  const where: Record<string, unknown> = {
    storeId,
    isActive: true,
  };

  if (resolvedAudience === 'DEBTORS') {
    // Customers with outstanding debt — DebtLedger balance > 0
    where.currentDebtBalance = { gt: 0 };
  } else if (resolvedAudience === 'LOYALTY_MEMBERS') {
    where.loyaltyPoints = { gt: 0 };
  } else if (resolvedAudience === 'CUSTOMERS_WITH_PHONES') {
    // customers whose phone field is non-empty
    where.phone = { not: null };
  }
  // ALL: no further filter

  const customers = await db.customer.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      storeId: true,
    },
    take: 5000, // safety cap
  });

  const sent: SendResult[] = [];
  const skipped: SkipResult[] = [];
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const finalSubject = subject || `Bulk ${resolvedChannel} broadcast`;

  const encodedMessage = encodeURIComponent(message);

  // Persist a Message record per recipient. Do it sequentially in chunks
  // to keep the SQLite write load reasonable.
  for (const c of customers) {
    const normalised = normalisePhone(c.phone || '');
    if (!normalised) {
      skipped.push({
        customerId: c.id,
        name: c.name,
        phone: c.phone || '',
        reason: 'Missing or invalid phone number',
      });
      continue;
    }

    let waLink: string | null = null;
    if (resolvedChannel === 'WHATSAPP') {
      waLink = `https://wa.me/${normalised}?text=${encodedMessage}`;
    }

    try {
      await db.message.create({
        data: {
          storeId,
          customerId: c.id,
          channel: resolvedChannel,
          messageType: 'PROMOTION',
          subject: finalSubject,
          content: message,
          status: waLink ? 'PENDING' : 'PENDING',
          waLink,
          sentAt: scheduledDate ? null : waLink ? new Date() : null,
          createdBy: session.userId,
        },
      });
    } catch {
      // Non-blocking — we still surface the wa.me link to the cashier even
      // if audit logging fails for a single recipient.
    }

    sent.push({
      customerId: c.id,
      name: c.name,
      phone: normalised,
      waLink,
    });
  }

  await systemLog({
    action: 'BULK_MESSAGE_BROADCAST',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Bulk ${resolvedChannel} broadcast to audience "${resolvedAudience}": ${sent.length} recipients, ${skipped.length} skipped`,
    userId: session.userId,
    storeId,
    metadata: {
      audience: resolvedAudience,
      channel: resolvedChannel,
      subject: finalSubject,
      totalCandidates: customers.length,
      sentCount: sent.length,
      skippedCount: skipped.length,
      scheduledAt: scheduledDate ? scheduledDate.toISOString() : null,
      messagePreview: message.slice(0, 120),
    },
  });

  return Response.json({
    success: true,
    data: {
      totalRecipients: sent.length,
      sent,
      skipped,
      broadcastSummary: {
        channel: resolvedChannel,
        audience: resolvedAudience,
        subject: finalSubject,
        scheduledAt: scheduledDate ? scheduledDate.toISOString() : null,
        totalCandidates: customers.length,
        sentCount: sent.length,
        skippedCount: skipped.length,
      },
    },
  });
}

export const POST = withErrorBoundary(
  requireAuth(bulkMessagingHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'],
  }),
  'MESSAGING_BULK',
);
