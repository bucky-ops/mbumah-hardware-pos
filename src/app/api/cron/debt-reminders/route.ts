// GET /api/cron/debt-reminders — Vercel Cron entry point for the aged
// debt-reminder sweep (v2.6.0).
//
// WHAT IT DOES (08:00 UTC = 11:00 EAT daily, see vercel.json crons):
//   1. ORG-WIDE sweep (runWithoutTenant — this is not a store-scoped
//      request) of DebtLedger rows that are genuinely late:
//        status ∈ (OUTSTANDING, PARTIAL, OVERDUE)
//        agingBucket ∈ (DAYS_30, DAYS_60, DAYS_90_PLUS)
//        balance > 0
//        lastReminderAt is null or older than 7 days (anti-spam throttle)
//   2. Composes a bucket-specific, polite statement (30/60/90+ days) with
//      the KES balance and due date, per-customer store name.
//   3. Sends via the customer's preferred channel — WhatsApp
//      (preferredChannel === 'WHATSAPP') or SMS. Twilio-unconfigured dev
//      no-op is tolerated (send result is success with a sim_ id).
//   4. Writes an OutboxEvent kind='DEBT_REMINDER' (status COMPLETED — a
//      durable audit record of the send; there is deliberately NO pump
//      handler for this kind, the message is sent synchronously here, so a
//      PENDING row would only be failed by the generic outbox pump) and a
//      DebtReminder row so the send shows up in the reminders dashboard.
//   5. Updates DebtLedger.lastReminderAt ONLY when the send result indicates
//      success (including the unconfigured no-op — so dev dry-runs don't
//      re-trigger every cron tick and production retries wait 7 days).
//
// AUTH: identical CRON_SECRET gate to /api/cron/outbox (x-cron-secret
// header; fail-open with a WARN systemLog when CRON_SECRET is unset).

import { db, runWithoutTenant } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';
// 100 sends × (Twilio round-trip + DB writes) fits within 60s; the batch cap
// keeps a cold lambda from timing out mid-sweep (unsent ledgers are picked
// up by the next daily run).
export const maxDuration = 60;

// ── Shared cron secret gate (verbatim /api/cron/outbox pattern) ─────────────
async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    const { systemLog } = await import('@/lib/logger');
    const { LogSeverity } = await import('@/lib/types');
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set — /api/cron/debt-reminders accepted an unauthenticated request.',
      metadata: { path: '/api/cron/debt-reminders' },
    });
    return null;
  }

  if (provided !== secret) {
    return Response.json(
      { success: false, error: 'Forbidden: invalid or missing x-cron-secret header.' },
      { status: 403 },
    );
  }

  return null;
}

// ── Bucket-specific message templates (polite statement tone) ────────────────
function composeReminderMessage(opts: {
  customerName: string;
  storeName: string;
  balanceKes: string;
  dueDate: string;
  bucket: string;
}): string {
  switch (opts.bucket) {
    case 'DAYS_90_PLUS':
      return (
        `Dear ${opts.customerName}, this is a final courtesy notice from ${opts.storeName}. ` +
        `Your account balance of KES ${opts.balanceKes} has been overdue since ${opts.dueDate} (over 90 days). ` +
        `Kindly settle immediately or contact the branch to discuss payment arrangements to avoid further collection action. Asante.`
      );
    case 'DAYS_60':
      return (
        `Dear ${opts.customerName}, your account with ${opts.storeName} now has an overdue balance of ` +
        `KES ${opts.balanceKes} (due ${opts.dueDate}, over 60 days). Please clear the amount at your earliest convenience ` +
        `or visit the branch to arrange payment. Asante sana.`
      );
    case 'DAYS_30':
    default:
      return (
        `Habari ${opts.customerName}, this is a friendly reminder from ${opts.storeName}. ` +
        `Your account balance of KES ${opts.balanceKes} fell due on ${opts.dueDate}. ` +
        `Kindly settle at your earliest convenience. Asante sana.`
      );
  }
}

/** True when Twilio env vars are present (mirrors notification-helpers isTwilioConfigured). */
function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE,
  );
}

interface DebtReminderSweepResult {
  sent: number;
  skipped: number;
  failed: number;
  scanned: number;
  unconfigured: boolean;
}

async function runDebtReminderSweep(): Promise<DebtReminderSweepResult> {
  // Org-wide sweep — no tenant context (see module header).
  return runWithoutTenant(async (): Promise<DebtReminderSweepResult> => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const unconfigured = !isTwilioConfigured();

    const ledgers = await db.debtLedger.findMany({
      where: {
        status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] },
        agingBucket: { in: ['DAYS_30', 'DAYS_60', 'DAYS_90_PLUS'] },
        balance: { gt: 0 },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: weekAgo } }],
      },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, preferredChannel: true },
        },
      },
      orderBy: { dueDate: 'asc' }, // oldest debt first
      take: 100, // spec cap per run
    });

    // Batch the store-name lookups (one query instead of one per ledger).
    const storeIds = [...new Set(ledgers.map((l) => l.storeId))];
    const stores = storeIds.length
      ? await db.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
      : [];
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

    const { notificationService } = await import('@/lib/notification-helpers');
    const { systemLog } = await import('@/lib/logger');
    const { LogSeverity } = await import('@/lib/types');

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const ledger of ledgers) {
      const channel = ledger.customer.preferredChannel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS';

      if (!ledger.customer.phone) {
        skipped++;
        continue;
      }

      const message = composeReminderMessage({
        customerName: ledger.customer.name,
        storeName: storeNameById.get(ledger.storeId) || 'Mbumah Hardware',
        balanceKes: round2(ledger.balance).toLocaleString(),
        dueDate: ledger.dueDate.toLocaleDateString('en-KE', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        bucket: ledger.agingBucket,
      });

      // WhatsApp when the customer prefers it, SMS otherwise.
      const result =
        channel === 'WHATSAPP'
          ? await notificationService.sendWhatsApp(ledger.customer.phone, message)
          : await notificationService.sendSms(ledger.customer.phone, message);

      // Durable audit records — OutboxEvent (spec: audit trail) + DebtReminder
      // row (feeds the existing /api/reminders/debt dashboard).
      try {
        await db.outboxEvent.create({
          data: {
            storeId: ledger.storeId,
            kind: 'DEBT_REMINDER',
            payload: JSON.stringify({
              ledgerId: ledger.id,
              customerId: ledger.customer.id,
              channel,
              messagePreview: message.slice(0, 120),
              sendStatus: result.success ? 'SENT' : 'FAILED',
              errorMessage: result.errorMessage ?? null,
              providerMessageId: result.providerMessageId ?? null,
            }),
            // COMPLETED, not PENDING: the send already happened synchronously
            // and no pump handler exists for this kind — a PENDING row would
            // only be dead-lettered by the generic outbox pump.
            status: 'COMPLETED',
            processedAt: new Date(),
            availableAt: now,
          },
        });
      } catch {
        /* audit record is best-effort */
      }

      try {
        await db.debtReminder.create({
          data: {
            storeId: ledger.storeId,
            customerId: ledger.customer.id,
            debtLedgerId: ledger.id,
            reminderType: channel,
            status: result.success ? 'SENT' : 'FAILED',
            message,
            providerMessageId: result.providerMessageId ?? null,
            errorMessage: result.errorMessage ?? null,
            sentAt: now,
            deliveredAt: result.success ? now : null,
          },
        });
      } catch {
        /* audit record is best-effort */
      }

      if (result.success) {
        // Success (including the unconfigured no-op) — throttle the next
        // reminder by 7 days. Dry-runs must not re-send every cron tick.
        await db.debtLedger.update({
          where: { id: ledger.id },
          data: { lastReminderAt: now },
        });
        sent++;
      } else {
        failed++;
      }
    }

    if (ledgers.length > 0) {
      await systemLog({
        action: 'DEBT_REMINDER_CRON_RUN',
        component: LogComponent.FINANCIAL,
        severity: failed > 0 ? LogSeverity.WARN : LogSeverity.INFO,
        message: `Debt-reminder sweep: scanned ${ledgers.length} aged ledger(s), sent ${sent}, failed ${failed}, skipped ${skipped}${unconfigured ? ' (Twilio unconfigured — sends simulated)' : ''}.`,
        metadata: {
          scanned: ledgers.length,
          sent,
          failed,
          skipped,
          unconfigured,
        },
      }).catch(() => {});
    }

    return { sent, skipped, failed, scanned: ledgers.length, unconfigured };
  });
}

async function debtRemindersCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const result = await runDebtReminderSweep();

  return Response.json({
    success: true,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    scanned: result.scanned,
    unconfigured: result.unconfigured,
  });
}

export const GET = withErrorBoundary(debtRemindersCronHandler, LogComponent.FINANCIAL);
