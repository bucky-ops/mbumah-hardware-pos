// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Admin Manual Backup API (SRV-2, v2.9.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET /api/admin/backup — build a business-critical JSON snapshot of the
// database and return it as a browser download (Content-Disposition:
// attachment), mirroring the /api/data-exports/[id]/download pattern.
//
// Snapshot design:
//   • Business-critical models ONLY — the noisy/ephemeral tables (systemLog,
//     auditLog, securityEvent, session, message, outbox, dataExport, …) are
//     deliberately SKIPPED so a restore is clean and the file stays small.
//   • EVERY model is fetched in its OWN try/catch — one failing table
//     becomes an `{ error: message }` placeholder in `tables` instead of
//     killing the whole backup. Partial + honest beats total + absent.
//   • User rows are returned WITHOUT `passwordHash` — credential hashes
//     must never leave the server, not even inside a backup file.
//   • When the caller has a `storeId` (STORE_OWNER), store-scoped models are
//     filtered to their store; SUPER_ADMIN snapshots the whole organisation.
//     The whole build runs in runWithoutTenant() with EXPLICIT storeId
//     filters so behaviour is deterministic instead of ORM-layer-dependent.
//   • The same JSON is ALSO written to the backup directory (BACKUP_DIR →
//     Windows Desktop\MbumahBackups\app → <tmpdir>/mbumah-backups/app) as
//     `mbumah-snapshot-<stamp>.json`. On a read-only cloud filesystem the
//     write failure is logged and ignored — the download is the deliverable.
//
// Auth: SUPER_ADMIN or STORE_OWNER only.
// ─────────────────────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity } from '@/lib/types';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

// ── Backup directory (app snapshots, separate from crash backups) ────────────

/** BACKUP_DIR → Windows `<Desktop>/MbumahBackups/app` → `<tmpdir>/mbumah-backups/app`. */
function resolveAppBackupDir(): string {
  const configured = process.env.BACKUP_DIR?.trim();
  if (configured) return path.join(configured, 'app');
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'Desktop', 'MbumahBackups', 'app');
  }
  return path.join(os.tmpdir(), 'mbumah-backups', 'app');
}

/** `20260212-231505`-style local-time stamp (same format as crash backups). */
function formatStamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** Best-effort local copy of the snapshot — failures are logged, never fatal. */
function writeSnapshotToDisk(fileName: string, json: string): void {
  try {
    const dir = resolveAppBackupDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), json, 'utf8');
  } catch (error) {
    // Read-only cloud filesystems (Vercel) are expected to land here.
    console.error(
      '[ADMIN-BACKUP] Snapshot could not be written to the backup dir (download still served):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function getHandler(
  _request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  // The whole snapshot runs WITHOUT ORM tenant enforcement and applies
  // explicit storeId filters instead — deterministic for both roles.
  const payload = await runWithoutTenant(async () => {
    const storeId = session.storeId; // null for SUPER_ADMIN / unassigned owner
    const tables: Record<string, unknown> = {};
    const counts: Record<string, number> = {};

    /** Fetch one table; a failure degrades to an honest `{ error }` entry. */
    async function snapshot(
      name: string,
      fetch: () => Promise<unknown[]>,
    ): Promise<void> {
      try {
        const rows = await fetch();
        tables[name] = rows;
        counts[name] = rows.length;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        tables[name] = { error: message };
        console.error(`[ADMIN-BACKUP] Table '${name}' failed:`, message);
      }
    }

    // ── Users (credential hash STRIPPED) ─────────────────────────────────────
    await snapshot('user', async () => {
      const rows = await db.user.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      });
      // ignoreRestSiblings: passwordHash is intentionally dropped here.
      return rows.map(({ passwordHash: _passwordHash, ...safeUser }) => safeUser);
    });

    // ── Org structure & catalog ───────────────────────────────────────────────
    await snapshot('store', () =>
      db.store.findMany({
        where: storeId ? { id: storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    await snapshot('product', () =>
      db.product.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    await snapshot('customer', () =>
      db.customer.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    // ── Sales pipeline ────────────────────────────────────────────────────────
    await snapshot('salesTransaction', () =>
      db.salesTransaction.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    // Line items have no storeId column — filter through the parent relation.
    await snapshot('saleItem', () =>
      db.saleItem.findMany({
        where: storeId ? { transaction: { storeId } } : undefined,
      }),
    );

    await snapshot('payment', () =>
      db.payment.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    // ── Purchasing ────────────────────────────────────────────────────────────
    await snapshot('purchaseOrder', () =>
      db.purchaseOrder.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    await snapshot('purchaseOrderItem', () =>
      db.purchaseOrderItem.findMany({
        where: storeId ? { purchaseOrder: { storeId } } : undefined,
      }),
    );

    // ── Stock ledger ──────────────────────────────────────────────────────────
    await snapshot('stockMovement', () =>
      db.stockMovement.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    // ── Invoices (+ items) ────────────────────────────────────────────────────
    await snapshot('invoice', () =>
      db.invoice.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    await snapshot('invoiceItem', () =>
      db.invoiceItem.findMany({
        where: storeId ? { invoice: { storeId } } : undefined,
      }),
    );

    // ── Promotions ────────────────────────────────────────────────────────────
    await snapshot('voucher', () =>
      db.voucher.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    await snapshot('giftCard', () =>
      db.giftCard.findMany({
        where: storeId ? { storeId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );

    // ── Global config (never store-scoped) ────────────────────────────────────
    await snapshot('systemConfig', () => db.systemConfig.findMany());

    return {
      kind: 'manual-snapshot' as const,
      createdAt: new Date().toISOString(),
      version: APP_VERSION,
      ...(storeId ? { storeId } : {}),
      counts,
      tables,
    };
  });

  const json = JSON.stringify(payload, null, 2);
  const stamp = formatStamp(new Date());
  const fileName = `mbumah-snapshot-${stamp}.json`;

  // Local copy for the Windows backup folder — never blocks the download.
  writeSnapshotToDisk(fileName, json);

  // Audit trail — never blocks the response.
  await systemLog({
    action: 'MANUAL_BACKUP',
    component: 'SYSTEM',
    severity: LogSeverity.INFO,
    message: `Manual JSON snapshot generated by ${session.email} (${payload.counts ? Object.keys(payload.counts).length : 0} tables).`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { counts: payload.counts, fileName },
  }).catch(() => {});

  return new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// GET: SUPER_ADMIN or STORE_OWNER only. GET (not POST) on purpose: a
// snapshot is a read, and GET skips the proxy's JSON-content-type/CSRF
// layers — mirrors the data-exports download route.
export const GET = withErrorBoundary(
  requireAuth(getHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'ADMIN_BACKUP',
);
