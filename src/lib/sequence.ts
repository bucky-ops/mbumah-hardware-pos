// Gapless-per-store reference number sequences.
//
// AUDIT REFERENCE — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • SYS-7 / F1-6 / F5-6 / F6-3: document numbers (PO, JE, receipt, invoice)
//     were generated with `Math.random()` or unsynchronised `count()+1`
//     lookups. Under concurrency that produces P2002 unique-constraint 500s
//     in the middle of a sale, and KRA/eTIMS requires gapless, per-device
//     sequential numbering.
//
// Design (works on both PostgreSQL and SQLite — tests run on SQLite):
//   1. Serialise allocation per (storeId, prefix) using a PostgreSQL advisory
//     transaction lock when available (no-ops on SQLite, where the single
//     writer connection already serialises).
//   2. Allocate `count(*) + 1` inside the CURRENT transaction, so the number
//     commits atomically with the document it labels.
//   3. Callers still wrap the create in a small P2002 retry (see
//     `withSequenceRetry`) as a belt-and-braces backstop for the window
//     between two concurrent transactions on READ COMMITTED.
//
// Server-only module — imports Prisma client types only.

import type { PrismaClient } from '@prisma/client';

/** Minimal tx surface we need — works with both `db` and interactive tx clients. */
type SequenceTx = Pick<PrismaClient, '$queryRaw' | '$queryRawUnsafe'>;

/** Is the runtime database PostgreSQL (tests use SQLite)? */
export function isPostgres(): boolean {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
  return url.startsWith('postgres');
}

/**
 * Allocate the next integer in a per-store, per-prefix daily sequence.
 * MUST be called inside the transaction that creates the document.
 *
 * e.g. `await nextSequence(tx, storeId, 'PO')` → 7 ⇒ "PO-20260904-0007"
 */
export async function nextSequence(
  tx: SequenceTx,
  storeId: string,
  prefix: string,
  date = new Date()
): Promise<number> {
  // PostgreSQL: serialise concurrent allocations for this (store, prefix, day).
  // SQLite (tests/dev): single-writer model makes the lock unnecessary and the
  // SQL dialect (hashtext) unavailable, so we skip it there.
  if (isPostgres()) {
    try {
      const dayKey = date.toISOString().slice(0, 10);
      // Advisory xact-scoped lock — released automatically at COMMIT/ROLLBACK.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`seq:${storeId}:${prefix}:${dayKey}`}))`;
    } catch {
      // Lock failure must never block the business transaction; the retry
      // helper below is the correctness backstop.
    }
  }

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const table = SEQUENCE_TABLES[prefix];
  if (!table) throw new Error(`Unknown sequence prefix: ${prefix}`);

  // Dialect-aware SQL: PostgreSQL uses $1..$N placeholders and ::int casts;
  // SQLite (tests/dev) uses ? placeholders. Quoted identifiers work on both.
  const pg = isPostgres();
  const sql = pg
    ? `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "storeId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3`
    : `SELECT COUNT(*) AS n FROM "${table}" WHERE "storeId" = ? AND "createdAt" >= ? AND "createdAt" < ?`;
  const rows = await tx.$queryRawUnsafe<{ n: number }>(
    sql,
    storeId,
    start,
    end
  );
  return Number(rows[0]?.n ?? 0) + 1;
}

/** Physical tables backing each sequence prefix. */
const SEQUENCE_TABLES: Record<string, string> = {
  PO: 'purchase_orders',
  JE: 'journal_entries',
  RCPT: 'receipts',
  INV: 'invoices',
  TXN: 'sales_transactions',
};

/** Compose `PREFIX-YYYYMMDD-NNNN` from a sequence number. */
export function formatSequence(
  prefix: string,
  date: Date,
  seq: number,
  pad = 4
): string {
  const dateStr =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0');
  return `${prefix}-${dateStr}-${String(seq).padStart(pad, '0')}`;
}

export class UniqueConstraintError extends Error {
  constructor(public model: string) {
    super(`Duplicate unique value on ${model} — sequence contention`);
    this.name = 'UniqueConstraintError';
  }
}

/** Detect a Prisma P2002 (unique violation) wrapped error. */
export function isP2002(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * Retry an action that may hit a unique-constraint race (P2002) up to 3 times,
 * re-allocating the sequence each attempt. Use around `create` calls whose
 * uniqueness depends on a freshly allocated sequence number.
 */
export async function withSequenceRetry<T>(
  action: (attempt: number) => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action(attempt);
    } catch (err) {
      lastErr = err;
      if (!isP2002(err) || attempt === attempts) throw err;
      // Exponential backoff: 50ms, 150ms — enough for the contending tx to commit.
      await new Promise((r) => setTimeout(r, 50 * attempt * attempt));
    }
  }
  throw lastErr;
}
