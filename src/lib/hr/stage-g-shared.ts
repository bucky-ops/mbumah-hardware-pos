// MBUMAH HARDWARE POS - Stage G shared service helpers (v2.19.0)
//
// Phase 4.7 (performance, assets, discipline, self-service) builds on the same
// conventions as the payroll services: module-scoped error classes that carry
// an HTTP status and a stable machine code, plus shared branch-scope helpers.
// Route handlers map these errors to JSON responses via toErrorResponse.

import { Prisma } from '@prisma/client';
import type { AuthSession } from '@/lib/auth';

/** Error thrown by Stage G services. Carries a stable code + HTTP status. */
export class StageGError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
    this.name = 'StageGError';
  }
}

/** Map a StageGError (or anything else) to a safe JSON error Response. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof StageGError) {
    return Response.json(
      { success: false, error: error.message.replace(/^[A-Z_]+: /, ''), code: error.code },
      { status: error.status },
    );
  }
  // v2.23.0: per-branch report drill-down rejections (unknown store, or a
  // BRANCH-scope caller trying to narrow) share the same JSON contract.
  const narrowing = error as { name?: string; code?: string; status?: number; message?: string };
  if (narrowing && narrowing.name === 'StoreNarrowingError') {
    return Response.json(
      { success: false, error: narrowing.message, code: narrowing.code },
      { status: narrowing.status ?? 400 },
    );
  }
  return Response.json(
    { success: false, error: 'The request could not be completed.', code: 'INTERNAL_ERROR' },
    { status: 500 },
  );
}

/**
 * Branch scope for Employee-referencing queries. Managers resolve their store
 * from the session (never the client); SUPER_ADMIN (or any user without a
 * storeId) is scoped to the whole organization instead.
 */
export function employeeScopeWhere(session: AuthSession): Prisma.EmployeeWhereInput {
  if (session.storeId) return { storeId: session.storeId };
  return { store: { organizationId: session.organizationId } };
}

/** True when the session may act on an employee row resolved from the DB. */
export function employeeInScope(
  employee: { storeId: string } | null | undefined,
  session: AuthSession,
): boolean {
  if (!employee) return false;
  if (!session.storeId) return true; // org-wide actor (SUPER_ADMIN / owner without branch)
  return employee.storeId === session.storeId;
}

/** Parse a JSON-serialised metricConfig string (SQLite parity) safely. */
export function parseMetricConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Decimal-safe conversion for API payloads: Decimal -> string (v2.3.1 rule). */
export function decimalToMoney(value: unknown): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'object' && value !== null && 'toFixed' in (value as Record<string, unknown>)) {
    return (value as Prisma.Decimal).toFixed(2);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/** Parse a client-supplied decimal string/number into Prisma.Decimal. */
export function toDecimal(value: unknown): Prisma.Decimal {
  if (typeof value === 'object' && value !== null && 'toString' in (value as Record<string, unknown>)) {
    return new Prisma.Decimal((value as { toString(): string }).toString());
  }
  const asString = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (asString === '' || !Number.isFinite(Number(asString))) {
    throw new StageGError('INVALID_AMOUNT', 'Amounts must be valid decimal numbers.', 400);
  }
  return new Prisma.Decimal(asString);
}

/** Parse an ISO date string or Date into Date; 400 on garbage. */
export function toDate(value: unknown, field: string): Date {
  const d = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(d.getTime())) {
    throw new StageGError('INVALID_DATE', `${field} must be a valid ISO date.`, 400);
  }
  return d;
}
