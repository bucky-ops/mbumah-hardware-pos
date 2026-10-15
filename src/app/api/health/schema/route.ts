// GET /api/health/schema
//
// Protected database schema health endpoint (LAN and tunnel operators).
// /api/health stays public and only degrades its database_stats check on the
// single sentinel probe; this endpoint gives an authenticated operator the
// FULL drift picture: which known-recent columns are missing, per-table row
// counts, and the resolved provider - the exact input needed to decide
// between "run the updater" and "npm run db:repair".
//
// Requires authentication. v2.18.3.2 (audit Finding 18): in production the
// response is restricted to SUPER_ADMIN and STORE_OWNER (the schema drift
// picture is operational data, not cashier-level data); outside production
// (trusted local desktop mode) any signed-in role keeps working so local
// operators can self-diagnose. Rate limited per client IP (10/min).

import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { successResponse } from '@/lib/api-response';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
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

const requireSchemaRole = requireRole('SUPER_ADMIN', 'STORE_OWNER');

export const GET = requireAuth(async (request, session: AuthSession) => {
  if (process.env.NODE_ENV === 'production') {
    const denied = requireSchemaRole(session);
    if (denied) return denied;
  }

  // v2.18.3.2 (audit Finding 22): the schema probe runs real database
  // queries; cap per-client cost (10/min) so a looping client cannot turn a
  // diagnostic endpoint into a load tool.
  const rl = isRateLimited(`health-schema:${getClientIp(request)}`, {
    max: 10,
    windowMs: 60 * 1000,
  });
  if (rl.limited) {
    return Response.json(
      { success: false, error: 'Too many schema health requests. Retry later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

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
