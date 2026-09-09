// Shared list-endpoint pagination helpers.
//
// AUDIT FIX (Findings 2.1 — unbounded list queries — and 1.4 — inconsistent
// response contracts):
//
// The debt-payment-plans audit (DEBT_PLAN_MODULE_AUDIT.md, M2) documented
// unbounded findMany() patterns and ad-hoc pagination maths copy-pasted
// across routes. Several list routes already paginate (products, customers)
// but each re-implements `parseInt(searchParams.get('page') || '1')` with no
// clamping — `?page=-5` produces a negative `skip` (Prisma throws),
// `?limit=999999999` lets one request drag the whole table into memory, and
// `?limit=abc` NaNs its way into the query.
//
// These helpers centralise:
//   • parsing + sanitising `page` / `limit` from the query string
//     (non-numeric → default; page < 1 → 1; limit clamped to
//     [1, maxLimit] — default cap 500, overridable per route);
//   • the skip offset;
//   • one canonical `pagination` response meta object (identical field
//     names to the products/customers contract: page/limit/total/
//     totalPages — plus hasNextPage/hasPreviousPage), so list endpoints
//     expose a consistent envelope clients can rely on.
//
// Backward compatibility: routes that already paginate keep their default
// limit (pass it via opts.defaultLimit) and their existing meta field names
// (page/limit/total/totalPages) — the new fields are additive.

export interface PaginationParams {
  /** 1-based page number (always ≥ 1). */
  page: number;
  /** Effective page size after clamping (always ≥ 1). */
  limit: number;
  /** Pre-computed Prisma `skip` offset: (page - 1) * limit. */
  skip: number;
}

export interface PaginationOptions {
  /** Page size used when `limit` is absent/invalid. Default 50. */
  defaultLimit?: number;
  /** Hard upper bound for `limit`. Default 500. */
  maxLimit?: number;
}

export interface PaginationMeta extends PaginationParams {
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

function parseIntSafe(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse and sanitise `page` / `limit` query parameters.
 *
 * Never throws and never returns out-of-range values, so the result is safe
 * to feed straight into Prisma `skip` / `take`.
 *
 * @example
 * const { page, limit, skip } = parsePagination(new URL(request.url).searchParams);
 * const [rows, total] = await Promise.all([
 *   db.product.findMany({ where, skip, take: limit, orderBy }),
 *   db.product.count({ where }),
 * ]);
 * return Response.json({ success: true, data: rows, pagination: buildPaginationMeta(page, limit, total) });
 */
export function parsePagination(
  searchParams: URLSearchParams,
  opts: PaginationOptions = {},
): PaginationParams {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 500;

  const rawPage = parseIntSafe(searchParams.get('page'));
  const rawLimit = parseIntSafe(searchParams.get('limit'));

  const page = Math.max(rawPage ?? 1, 1);
  const limit = Math.min(Math.max(rawLimit ?? defaultLimit, 1), maxLimit);

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build the canonical `pagination` meta object for a list response.
 *
 * Field names match the existing products/customers envelope
 * (page/limit/total/totalPages) so current clients keep working; the two
 * boolean helpers are additive.
 */
export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const safeTotal = Math.max(total, 0);
  const totalPages = Math.ceil(safeTotal / limit) || 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
