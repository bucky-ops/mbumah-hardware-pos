// GET /api/health/schema
//
// Protected database schema health endpoint (LAN and tunnel operators).
// /api/health stays public and only degrades its database_stats check on the
// single sentinel probe; this endpoint gives an authenticated operator the
// FULL drift picture: which known-recent columns are missing, per-table row
// counts, and the resolved provider - the exact input needed to decide
// between "run the updater" and "npm run db:repair".
//
// Requires authentication (any signed-in role; the response contains no
// secrets, only schema-level facts).

import { requireAuth } from '@/lib/auth';
import { successResponse } from '@/lib/api-response';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The known drift-sensitive columns (newest additions first). */
const DRIFT_PROBES: Array<{ model: string; column: string; probe: () => Promise<unknown> }> = [
  { model: 'equipment_rentals', column: 'idempotencyKey', probe: () => db.equipmentRental.findFirst({ select: { idempotencyKey: true }, take: 1 }) },
  { model: 'stock_movements', column: 'idempotencyKey', probe: () => db.stockMovement.findFirst({ select: { idempotencyKey: true }, take: 1 }) },
  { model: 'debt_ledgers', column: 'idempotencyKey', probe: () => db.debtLedger.findFirst({ select: { idempotencyKey: true }, take: 1 }) },
  { model: 'expenses', column: 'idempotencyKey', probe: () => db.expense.findFirst({ select: { idempotencyKey: true }, take: 1 }) },
  { model: 'transactions', column: 'idempotencyKey', probe: () => db.salesTransaction.findFirst({ select: { idempotencyKey: true }, take: 1 }) },
  { model: 'users', column: 'isEngraved', probe: () => db.user.findFirst({ select: { isEngraved: true }, take: 1 }) },
];

export const GET = requireAuth(async (_request, _session) => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const provider = databaseUrl.startsWith('file:')
    ? 'sqlite'
    : databaseUrl.includes('postgres')
      ? 'postgresql'
      : 'unknown';

  const probes: Array<{ model: string; column: string; ok: boolean }> = [];
  for (const p of DRIFT_PROBES) {
    let ok = true;
    try {
      await p.probe();
    } catch {
      // P2022 (or any failure) marks the probe as drifted; the endpoint must
      // never throw because of a drifted database - reporting IS its job.
      ok = false;
    }
    probes.push({ model: p.model, column: p.column, ok });
  }

  const missing = probes.filter((p) => !p.ok);
  const status = missing.length === 0 ? 'ok' : 'drift';

  const counts: Record<string, number | 'error'> = {};
  const countTargets: Array<[string, () => Promise<number>]> = [
    ['users', () => db.user.count()],
    ['products', () => db.product.count()],
    ['transactions', () => db.salesTransaction.count()],
    ['stock_movements', () => db.stockMovement.count()],
    ['equipment_rentals', () => db.equipmentRental.count()],
  ];
  for (const [name, fn] of countTargets) {
    try {
      counts[name] = await fn();
    } catch {
      counts[name] = 'error';
    }
  }

  return successResponse({
    status,
    provider,
    drift: missing.map((m) => `${m.model}.${m.column}`),
    probes,
    rowCounts: counts,
    remediation:
      status === 'ok'
        ? 'The database schema matches this release.'
        : 'Run the updater (Update-Mbumah-POS.bat) or "npm run db:repair" (backup + safe additive converge + verification).',
    checkedAt: new Date().toISOString(),
  });
});
