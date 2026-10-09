// MBUMAH HARDWARE POS - Privilege-Abuse Pattern Detection (v2.12.7, PR C)
//
// Companion to the abuse-lockout engine in src/lib/auth.ts. The lockout engine
// answers "is this user burning the permission gate RIGHT NOW?" (5 denials /
// 10 min → hard lock). This module answers the quieter question: "is a user
// repeatedly probing ONE specific business rule?" - currently the
// `pos.discount.gt5` gate (a cashier leaning on >5% discounts all day is the
// classic shrinkage pattern, and 5 denials in 10 minutes almost never trips
// for it because the cashier gives up between attempts).
//
// DETECTION RULE (v2.12.7):
//   • Per-user sliding window of `pos.discount.gt5` denials, 1 hour long.
//   • At the 4th denial (>3 attempts) inside the window →
//       one SecurityEvent 'PRIVILEGE_ABUSE_PATTERN' (WARN, blocked - the
//         triggering request was itself denied), and
//       WARNING / SECURITY Notification rows for EVERY active BRANCH_MANAGER
//         and SUPER_ADMIN of the org (excluding the offender), message shape:
//         "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h - 14:32".
//   • The window is consumed on notify (fresh window afterwards) so a user
//     spamming the gate gets at most ONE alert per hour - managers get a
//     signal, not a firehose. The per-denial SecurityEvent rows (written by
//     recordPermissionDenied) remain the complete forensic record.
//
// SERVERLESS / PER-INSTANCE CAVEAT (mirrors the lockout engine in auth.ts and
// the brute-force window in manager-auth.ts): the counter lives in module
// memory. On Vercel each warm lambda instance counts independently, so the
// trigger is BEST-EFFORT - an alert may fire late (cold start) or from one
// instance while another misses its few denials. This is acceptable here
// because the DURABLE record is the SecurityEvent feed + the hash-chained
// AuditLog PERMISSION_DENIED rows: this module only decides WHEN to page a
// human. A sweeper interval prunes stale entries on warm instances.

import { db, runWithoutTenant } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

/** The permission key this detector watches. */
export const DISCOUNT_SPAM_PERMISSION = 'pos.discount.gt5';

/** Sliding-window length: 1 hour. */
const SPAM_WINDOW_MS = 60 * 60 * 1000;

/** Denials within the window that trip the alert (strictly MORE than 3). */
const SPAM_ALERT_THRESHOLD = 4;

/** How long a SecurityEvent/notification send-out suppresses further ones. */
const SPAM_NOTIFY_COOLDOWN_MS = SPAM_WINDOW_MS;

interface SpamStamp {
  timestamps: number[];
  lastNotifiedAt: number;
}

/** Per-userId counter - per-instance, see the caveat above. */
const discountSpamMap = new Map<string, SpamStamp>();

const spamSweeper = setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of discountSpamMap) {
    if (
      entry.timestamps.length === 0 ||
      now - entry.timestamps[entry.timestamps.length - 1] > SPAM_WINDOW_MS
    ) {
      discountSpamMap.delete(userId);
    }
  }
}, SPAM_WINDOW_MS);
// Never keep the event loop alive just for the sweeper (serverless freeze).
if (typeof spamSweeper.unref === 'function') spamSweeper.unref();

/** Friendly role names for the manager-facing alert copy. */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'System Administrator',
  STORE_OWNER: 'Store Owner',
  BRANCH_MANAGER: 'Branch Manager',
  ACCOUNTANT: 'Accountant',
  INVENTORY_MANAGER: 'Inventory Manager',
  CASHIER: 'Cashier',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Kenya-local timestamp for the alert message (" - 14:32, 8 Oct"). */
function nairobiTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Minimal session shape consumed here (structural - avoids an auth.ts import cycle). */
export interface AbuseSignalSession {
  userId: string;
  email: string;
  role: string;
  storeId: string | null;
  organizationId: string;
}

export interface DiscountSpamOptions {
  session: AbuseSignalSession;
  /** The permission that was denied (only pos.discount.gt5 is tracked today). */
  permission: string;
  /** Client IP for the SecurityEvent row. */
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Feed one `pos.discount.gt5` denial into the spam detector. Called from
 * recordPermissionDenied() in src/lib/auth.ts - never throws, never blocks
 * the denied request.
 */
export async function noteDiscountSpam(opts: DiscountSpamOptions): Promise<void> {
  if (opts.permission !== DISCOUNT_SPAM_PERMISSION) return;

  const { session } = opts;
  const now = Date.now();

  // Sliding window update
  const entry = discountSpamMap.get(session.userId) ?? {
    timestamps: [],
    lastNotifiedAt: 0,
  };
  entry.timestamps = entry.timestamps.filter((t) => now - t < SPAM_WINDOW_MS);
  entry.timestamps.push(now);

  const count = entry.timestamps.length;
  const cooledDown = now - entry.lastNotifiedAt >= SPAM_NOTIFY_COOLDOWN_MS;

  if (count < SPAM_ALERT_THRESHOLD || !cooledDown) {
    discountSpamMap.set(session.userId, entry);
    return;
  }

  // Trip: consume the window so we alert at most once per hour
  entry.lastNotifiedAt = now;
  entry.timestamps = [];
  discountSpamMap.set(session.userId, entry);

  // Offender display name (AuthSession carries no name - one cheap lookup).
  let displayName = session.email;
  try {
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });
    if (user?.name) displayName = user.name;
  } catch {
    /* fall back to email */
  }

  const when = nairobiTime(new Date(now));
  const summary = `${displayName} (${roleLabel(session.role)}) attempted ${count}x discount >5% in 1h — ${when}`;

  // SecurityEvent PRIVILEGE_ABUSE_PATTERN - the durable record
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'PRIVILEGE_ABUSE_PATTERN',
        severity: 'WARN',
        userId: session.userId,
        storeId: session.storeId || undefined,
        resource: 'pos.discount.gt5',
        action: 'DISCOUNT_SPAM_PATTERN',
        details: JSON.stringify({
          permission: DISCOUNT_SPAM_PERMISSION,
          attemptsInWindow: count,
          windowMinutes: SPAM_WINDOW_MS / 60000,
          role: session.role,
          email: session.email,
        }),
        userAgent: opts.userAgent,
        ipAddress: opts.ipAddress,
        blocked: true,
      },
    });
  } catch {
    /* never block the alert path on security logging */
  }

  // Notify org BRANCH_MANAGERs + SUPER_ADMINs (durable Notification rows)
  try {
    const recipients = await runWithoutTenant(() =>
      db.user.findMany({
        where: {
          organizationId: session.organizationId,
          isActive: true,
          role: { in: ['BRANCH_MANAGER', 'SUPER_ADMIN'] },
          id: { not: session.userId }, // never page the offender about themselves
        },
        select: { id: true, storeId: true },
      })
    );

    if (recipients.length > 0) {
      await runWithoutTenant(() =>
        db.notification.createMany({
          data: recipients.map((recipient) => ({
            userId: recipient.id,
            // The alert is filed against the OFFENDER's store so it shows up
            // in that branch's notification scope; null when the offender has
            // no store assignment.
            storeId: session.storeId || recipient.storeId || null,
            title: 'Discount abuse pattern detected',
            message: summary,
            type: 'WARNING',
            category: 'SECURITY',
            priority: 'HIGH',
            actionUrl: '/dashboard?tab=security',
            actionLabel: 'Review security events',
            metadata: JSON.stringify({
              kind: 'DISCOUNT_SPAM_PATTERN',
              permission: DISCOUNT_SPAM_PERMISSION,
              targetUserId: session.userId,
              targetEmail: session.email,
              targetRole: session.role,
              attemptsInWindow: count,
              windowMinutes: SPAM_WINDOW_MS / 60000,
            }),
          })),
        })
      );
    }
  } catch {
    /* never block the alert path on notifications */
  }

  // Ops log breadcrumb
  try {
    await systemLog({
      action: 'PRIVILEGE_ABUSE_PATTERN',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `${summary} (offender: ${session.email}).`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: {
        permission: DISCOUNT_SPAM_PERMISSION,
        attemptsInWindow: count,
        email: session.email,
        role: session.role,
      },
    });
  } catch {
    /* ignore logging errors */
  }
}
