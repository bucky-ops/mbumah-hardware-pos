// GET /api/cron/reconciliation — READ-ONLY financial invariant checks.
//
// AUDIT REFERENCE — FINANCIAL_MODULE_AUDIT_REPORT.md (SYS cross-cutting /
// Wave 2 reconciliation): runs four invariants and ALERTS via systemLog.
// This route NEVER mutates financial data — the only writes it performs are
// its own SystemConfig drift-baseline row and system_logs entries:
//
//   a. Stock ledger: products."quantityInStock" vs
//      COALESCE(SUM(stock_movements."quantity"), 0) per product.
//      Historical opening balances were seeded WITHOUT stock movements, so
//      an absolute non-zero drift is EXPECTED (quantityInStock − movement_sum
//      = the opening baseline). The alert signal is therefore a CHANGE in
//      that drift versus the baseline persisted in SystemConfig under
//      'reconciliation_stock_drift_baseline'. First run stores the baseline
//      and logs INFO; subsequent runs log ERROR 'STOCK_LEDGER_DRIFT' per
//      product whose drift changed beyond tolerance (then refresh the
//      baseline so a known change does not re-alert every night).
//
//   b. Trial balance: SUM(journal_entry_lines.debit) must equal
//      SUM(journal_entry_lines.credit) within 0.01 — double-entry integrity.
//
//   c. Stale M-Pesa: MpesaTransaction rows still PENDING after 10 minutes
//      (the payments-sweeper closes these hourly; a non-zero count means the
//      sweeper is down or callbacks are being lost faster than it sweeps).
//
//   d. Stuck exports: DataExport rows stuck in PROCESSING for > 15 minutes
//      (the generating lambda died mid-export; they will never complete).
//
// The stock-ledger raw SQL is guarded in try/catch because the test suite
// runs on SQLite where raw quoted-identifier SQL can behave differently —
// a failed check is logged as WARN and reported as skipped; the cron must
// never crash because one probe could not run.
//
// SCHEDULE NOTE (Vercel Hobby plan): Hobby clamps crons to a daily minimum —
// the nightly "30 2 * * *" expression is fine on every plan.

import { db, runWithoutTenant } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STOCK_DRIFT_BASELINE_KEY = 'reconciliation_stock_drift_baseline';
// Sub-unit deltas are rounding noise from Decimal→float normalisation.
const DRIFT_TOLERANCE = 0.01;
const TRIAL_BALANCE_TOLERANCE = 0.01;
const MPESA_STALE_MINUTES = 10;
const EXPORT_STUCK_MINUTES = 15;

async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set — /api/cron/reconciliation accepted an unauthenticated request.',
      metadata: { path: '/api/cron/reconciliation' },
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

// Normalise Postgres numeric (Prisma Decimal object) / SQLite float / string
// into a plain JS number for comparison arithmetic.
function toNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ── (a) Stock ledger invariant ───────────────────────────────────────────────

interface StockLedgerRow {
  id: string;
  name: string;
  quantityInStock: unknown;
  movement_sum: unknown;
}

interface StockDriftAnomaly {
  productId: string;
  name: string;
  quantityInStock: number;
  movementSum: number;
  previousDrift: number;
  currentDrift: number;
  delta: number;
}

async function checkStockLedger(): Promise<{
  skipped: false;
  productsChecked: number;
  baselineExisted: boolean;
  anomalies: StockDriftAnomaly[];
} | { skipped: true; reason: string }> {
  try {
    const rows = await db.$queryRaw<StockLedgerRow[]>`
      SELECT p."id", p."name", p."quantityInStock", COALESCE(SUM(sm."quantity"),0) AS movement_sum
      FROM "products" p
      LEFT JOIN "stock_movements" sm ON sm."productId" = p."id"
      GROUP BY p."id", p."name", p."quantityInStock"
    `;

    // Current drift per product = quantityInStock − movement_sum.
    // (The residual IS the seeded opening baseline; only CHANGES alarm.)
    const currentDrift: Record<string, number> = {};
    const nameById: Record<string, string> = {};
    const quantityById: Record<string, number> = {};
    for (const row of rows) {
      const qty = toNum(row.quantityInStock);
      const movementSum = toNum(row.movement_sum);
      currentDrift[row.id] = qty - movementSum;
      nameById[row.id] = row.name;
      quantityById[row.id] = qty;
    }

    const baselineRow = await db.systemConfig.findUnique({
      where: { key: STOCK_DRIFT_BASELINE_KEY },
    });

    const anomalies: StockDriftAnomaly[] = [];

    if (!baselineRow) {
      // First run: persist the current drift map and log INFO — establishes
      // the reference point without spamming alerts for historical baseline.
      await db.systemConfig.upsert({
        where: { key: STOCK_DRIFT_BASELINE_KEY },
        update: { value: JSON.stringify(currentDrift) },
        create: {
          key: STOCK_DRIFT_BASELINE_KEY,
          value: JSON.stringify(currentDrift),
          description:
            'Stock-ledger reconciliation baseline (productId → quantityInStock − SUM(stock_movements.quantity)) captured by /api/cron/reconciliation. A CHANGE beyond ±0.01 between runs indicates stock mutated outside the ledger.',
        },
      });
      await systemLog({
        action: 'STOCK_LEDGER_BASELINE_SEEDED',
        component: LogComponent.INVENTORY,
        severity: LogSeverity.INFO,
        message: `Stock-ledger reconciliation baseline captured for ${rows.length} product(s); future drift changes will alert at ERROR severity.`,
        metadata: { productsChecked: rows.length },
      });

      return { skipped: false, productsChecked: rows.length, baselineExisted: false, anomalies };
    }

    let previous: Record<string, number>;
    try {
      previous = JSON.parse(baselineRow.value || '{}') as Record<string, number>;
    } catch {
      previous = {};
    }

    for (const [productId, current] of Object.entries(currentDrift)) {
      const prev = previous[productId];
      // Products never seen before have no baseline — record, don't alarm.
      if (typeof prev !== 'number') continue;
      const delta = current - prev;
      if (Math.abs(delta) > DRIFT_TOLERANCE) {
        anomalies.push({
          productId,
          name: nameById[productId] ?? '',
          quantityInStock: quantityById[productId] ?? 0,
          movementSum: quantityById[productId] - current,
          previousDrift: prev,
          currentDrift: current,
          delta,
        });
      }
    }

    for (const anomaly of anomalies) {
      await systemLog({
        action: 'STOCK_LEDGER_DRIFT',
        component: LogComponent.INVENTORY,
        severity: LogSeverity.ERROR,
        message: `Stock ledger drift changed for "${anomaly.name}" (${anomaly.productId}): on-hand vs movement-sum delta moved by ${anomaly.delta.toFixed(4)} units since last run — stock may have been mutated outside stock_movements.`,
        metadata: anomaly as unknown as Record<string, unknown>,
      });
    }

    // Refresh the baseline so this run's drift is the new reference —
    // otherwise every subsequent nightly run re-alerts on the same change.
    await db.systemConfig.update({
      where: { key: STOCK_DRIFT_BASELINE_KEY },
      data: { value: JSON.stringify(currentDrift) },
    });

    return {
      skipped: false,
      productsChecked: rows.length,
      baselineExisted: true,
      anomalies,
    };
  } catch (err) {
    // Tests run on SQLite; raw Postgres-style SQL may be unsupported there.
    // Report the skip instead of crashing the whole reconciliation run.
    const reason = err instanceof Error ? err.message : String(err);
    await systemLog({
      action: 'STOCK_LEDGER_CHECK_SKIPPED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.WARN,
      message: `Stock ledger invariant could not run: ${reason.slice(0, 200)}`,
      metadata: { path: '/api/cron/reconciliation' },
    });
    return { skipped: true, reason };
  }
}

// ── (b) Trial balance invariant ──────────────────────────────────────────────

async function checkTrialBalance(): Promise<{
  totalDebit: number;
  totalCredit: number;
  imbalance: number;
  balanced: boolean;
}> {
  // NOTE: the audit spec sketched this as groupBy({ by: [], _sum: ... }) but
  // Prisma 6 rejects an empty `by` ("by must not be empty", types + runtime).
  // `aggregate` with only _sum is the equivalent global-total query.
  const totals = await db.journalEntryLine.aggregate({
    _sum: { debit: true, credit: true },
  });

  const totalDebit = toNum(totals._sum.debit);
  const totalCredit = toNum(totals._sum.credit);
  const imbalance = Math.abs(totalDebit - totalCredit);
  const balanced = imbalance <= TRIAL_BALANCE_TOLERANCE;

  if (!balanced) {
    await systemLog({
      action: 'TRIAL_BALANCE_IMBALANCE',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.ERROR,
      message: `Trial balance does not balance: total debits ${totalDebit.toFixed(2)} vs total credits ${totalCredit.toFixed(2)} (imbalance ${imbalance.toFixed(2)}). Double-entry integrity is broken — investigate unposted/partially-posted journals.`,
      metadata: { totalDebit, totalCredit, imbalance },
    });
  }

  return { totalDebit, totalCredit, imbalance, balanced };
}

// ── (c) + (d) Operational staleness probes ───────────────────────────────────

async function checkStaleMpesa(): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - MPESA_STALE_MINUTES * 60_000);
  const count = await db.mpesaTransaction.count({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
  });

  if (count > 0) {
    await systemLog({
      action: 'MPESA_STALE_PENDING',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message: `${count} M-Pesa transaction(s) still PENDING after ${MPESA_STALE_MINUTES}m — Daraja callbacks lost or the payments-sweeper cron is not running.`,
      metadata: { count, staleAfterMinutes: MPESA_STALE_MINUTES },
    });
  }

  return { count };
}

async function checkStuckExports(): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - EXPORT_STUCK_MINUTES * 60_000);
  const count = await db.dataExport.count({
    where: { status: 'PROCESSING', createdAt: { lt: cutoff } },
  });

  if (count > 0) {
    await systemLog({
      action: 'EXPORT_STUCK_PROCESSING',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `${count} data export(s) stuck in PROCESSING for more than ${EXPORT_STUCK_MINUTES}m — the generating function likely died mid-export and these will never complete.`,
      metadata: { count, stuckAfterMinutes: EXPORT_STUCK_MINUTES },
    });
  }

  return { count };
}

// ── Route handler ────────────────────────────────────────────────────────────

async function reconciliationHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  // Cross-tenant by design: invariants are org-wide. Read-only against all
  // financial tables — the only writes are the SystemConfig baseline row and
  // system_logs audit entries.
  const result = await runWithoutTenant(async () => {
    const stock = await checkStockLedger();
    const trialBalance = await checkTrialBalance();
    const staleMpesa = await checkStaleMpesa();
    const stuckExports = await checkStuckExports();

    const alerts =
      (stock.skipped ? 0 : stock.anomalies.length) +
      (trialBalance.balanced ? 0 : 1) +
      (staleMpesa.count > 0 ? 1 : 0) +
      (stuckExports.count > 0 ? 1 : 0);

    return {
      stockLedger: stock,
      trialBalance,
      staleMpesa,
      stuckExports,
      alerts,
      ranAt: new Date().toISOString(),
    };
  });

  return Response.json({ success: true, result });
}

export const GET = withErrorBoundary(reconciliationHandler, LogComponent.FINANCIAL);
