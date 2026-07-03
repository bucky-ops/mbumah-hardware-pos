// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Standardized API Response Helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// This module provides a SINGLE, consistent response format for ALL API
// routes. Every response (success or error) follows the same envelope:
//
//   {
//     "success": true | false,
//     "data"?: T,                  // present on success
//     "error"?: string,            // present on failure (user-friendly)
//     "code"?: string,             // machine-readable error code
//     "requestId"?: string,        // correlation ID (from request context)
//     "timestamp": "2026-...",     // ISO 8601 — always present
//     "meta"?: {                   // pagination / counts
//       "page": 1,
//       "limit": 20,
//       "total": 142,
//       "totalPages": 8
//     }
//   }
//
// ── Why standardize? ─────────────────────────────────────────────────────────
//
// Before this module, routes returned ad-hoc shapes:
//   • Some returned `{ success: true, data }`
//   • Some returned `{ data }` (no success flag)
//   • Some returned `{ error: "..." }` (no success flag, no code)
//   • Some returned the raw Prisma object
//
// This made client-side error handling fragile (every route needed custom
// parsing) and made it impossible to build a generic "show toast on error"
// React Query interceptor.
//
// The helpers below (`successResponse`, `errorResponse`, `paginatedResponse`)
// produce the canonical envelope. The `withStandardizedResponse` wrapper
// converts any thrown error into a standardised error response — so route
// handlers can just `throw` and let the wrapper handle the formatting.
//
// ── Integration with request context ─────────────────────────────────────────
//
// Every response automatically includes the `X-Request-ID` header (from the
// active request context) and the `requestId` in the JSON body. This is the
// ISO 9001 traceability requirement: every observable event has a
// correlation ID.
//
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import {
  normaliseError,
  type NormalisedError,
  type ErrorContext,
} from './error-handler';
import { logError } from './error-handler';
import {
  getRequestContextSnapshot,
  withRequestContext,
} from './request-context';

// ── Types ────────────────────────────────────────────────────────────────────

/** Pagination metadata included in `meta` on list responses. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** The canonical success response envelope. */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  requestId?: string;
  timestamp: string;
}

/** The canonical error response envelope. */
export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  requestId?: string;
  timestamp: string;
  // In development (or when EXPOSE_ERRORS=true), include diagnostics.
  detail?: {
    name: string;
    message: string;
    stack?: string;
    prismaCode?: string;
  };
}

/** The canonical list response (success + pagination meta). */
export interface ListResponse<T = unknown> extends SuccessResponse<T> {
  meta: PaginationMeta;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the standard response headers, including the `X-Request-ID` from the
 * active request context (if any).
 */
function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const snapshot = getRequestContextSnapshot();
  if (snapshot) {
    headers['X-Request-ID'] = snapshot.requestId;
  }
  return headers;
}

/**
 * Get the request ID from the active context (or undefined).
 */
function currentRequestId(): string | undefined {
  return getRequestContextSnapshot()?.requestId;
}

// ── successResponse ──────────────────────────────────────────────────────────

/**
 * Build a standardised success `Response` object.
 *
 * @param data        The payload to return (any JSON-serialisable value).
 * @param options     Optional: status code (default 200), pagination meta,
 *                    extra headers.
 *
 * @example
 *   return successResponse({ user });
 *   return successResponse({ users }, { meta: paginationMeta });
 *   return successResponse({ created: true }, { status: 201 });
 */
export function successResponse<T>(
  data: T,
  options: {
    status?: number;
    meta?: PaginationMeta;
    headers?: Record<string, string>;
  } = {},
): Response {
  const status = options.status ?? 200;
  const body: SuccessResponse<T> = {
    success: true,
    data,
    requestId: currentRequestId(),
    timestamp: new Date().toISOString(),
  };
  if (options.meta) {
    body.meta = options.meta;
  }
  return NextResponse.json(body, {
    status,
    headers: buildHeaders(options.headers),
  });
}

/**
 * Build a standardised success response with EXTRA top-level fields beyond
 * `data`. Use this for routes that need to return auxiliary fields alongside
 * the main payload (e.g. `grouped`, `summary`, `totals`) WITHOUT nesting
 * them inside `data`.
 *
 * The resulting shape is:
 *   { success: true, data: <data>, ...extras, requestId, timestamp }
 *
 * @example
 *   return successResponseWithExtra(
 *     accounts,                          // data
 *     { grouped: accountsByType, summary } // extra top-level fields
 *   );
 */
export function successResponseWithExtra<T>(
  data: T,
  extras: Record<string, unknown> = {},
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  const status = options.status ?? 200;
  const body: SuccessResponse<T> & Record<string, unknown> = {
    success: true,
    data,
    requestId: currentRequestId(),
    timestamp: new Date().toISOString(),
    ...extras,
  };
  return NextResponse.json(body, {
    status,
    headers: buildHeaders(options.headers),
  });
}

// ── paginatedResponse ────────────────────────────────────────────────────────

/**
 * Build a standardised paginated list response. Computes the `PaginationMeta`
 * from the items + total count + current page/limit.
 *
 * @param items   The array of items for the current page.
 * @param total   The total count of items across all pages.
 * @param page    The current page number (1-based).
 * @param limit   The page size.
 *
 * @example
 *   const [items, total] = await Promise.all([
 *     db.product.findMany({ skip: (page-1)*limit, take: limit }),
 *     db.product.count(),
 *   ]);
 *   return paginatedResponse(items, total, page, limit);
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  const meta: PaginationMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
  return successResponse(items, { ...options, meta });
}

/**
 * Helper to build a `PaginationMeta` from raw counts (without building a
 * full Response). Useful when the response is built elsewhere.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ── errorResponse ────────────────────────────────────────────────────────────

/**
 * Build a standardised error `Response` object from a normalised error.
 *
 * @param normalised   The normalised error (from `normaliseError()`).
 * @param options      Optional: extra headers.
 *
 * The error is also logged via `logError()` (console + Sentry on server).
 *
 * In development (or when EXPOSE_ERRORS=true), the response includes the
 * full error detail (name, message, stack, prismaCode) for debugging. In
 * production, only the user-friendly message + code are returned.
 */
export function errorResponse(
  normalised: NormalisedError,
  options: {
    headers?: Record<string, string>;
    context?: ErrorContext;
  } = {},
): Response {
  // Log the error (console + Sentry on server).
  logError(normalised.raw, options.context);

  const body: ErrorResponse = {
    success: false,
    error: normalised.message,
    code: normalised.code,
    requestId: currentRequestId(),
    timestamp: new Date().toISOString(),
  };

  // In dev / EXPOSE_ERRORS, include diagnostics.
  const exposeErrors =
    process.env.NODE_ENV === 'development' ||
    process.env.EXPOSE_ERRORS === 'true' ||
    process.env.EXPOSE_ERRORS === '1' ||
    process.env.EXPOSE_ERRORS === 'yes';

  if (exposeErrors && normalised.raw instanceof Error) {
    body.detail = {
      name: normalised.raw.name,
      message: normalised.raw.message,
      stack: normalised.raw.stack,
      prismaCode: normalised.prismaCode,
    };
  }

  return NextResponse.json(body, {
    status: normalised.statusCode,
    headers: buildHeaders(options.headers),
  });
}

/**
 * Build an error response from a raw thrown value. Convenience wrapper that
 * normalises the error first, then calls `errorResponse()`.
 *
 * @example
 *   try {
 *     await db.product.create({ data });
 *   } catch (e) {
 *     return errorFromThrown(e, { context: 'CREATE_PRODUCT' });
 *   }
 */
export function errorFromThrown(
  err: unknown,
  options: {
    headers?: Record<string, string>;
    context?: ErrorContext;
  } = {},
): Response {
  return errorResponse(normaliseError(err), options);
}

// ── withStandardizedResponse ─────────────────────────────────────────────────

/**
 * Wrap an API route handler so that:
 *   1. A request context (AsyncLocalStorage) is established automatically.
 *   2. Any thrown error is caught + converted to a standardised error response.
 *   3. The `X-Request-ID` header is attached to every response.
 *
 * The handler should return the data (or a Response). If it returns a plain
 * value, it's wrapped in a success response. If it returns a Response
 * (e.g. from `successResponse()`), it's passed through as-is.
 *
 * This is an ALTERNATIVE to `apiHandler()` (api-error.ts) that uses the
 * standardised response envelope. Prefer this for NEW routes.
 *
 * @example
 *   export const GET = withStandardizedResponse(
 *     async (req: NextRequest) => {
 *       const products = await db.product.findMany();
 *       return products; // automatically wrapped in { success: true, data: products }
 *     },
 *     { operation: 'LIST_PRODUCTS' }
 *   );
 */
export function withStandardizedResponse<T>(
  handler: (req: Request, ...args: unknown[]) => Promise<T>,
  options: {
    operation?: string;
    component?: string;
  } = {},
): (req: Request, ...args: unknown[]) => Promise<Response> {
  return async (req: Request, ...args: unknown[]) => {
    const runWithCtx = async (): Promise<Response> => {
      try {
        const result = await handler(req, ...args);

        // If the handler already returned a Response, pass it through.
        // (This lets handlers use `successResponse()` / `paginatedResponse()`
        // directly for custom status codes or pagination.)
        if (result instanceof Response) {
          // Attach X-Request-ID if not already present.
          if (!result.headers.has('X-Request-ID')) {
            const snapshot = getRequestContextSnapshot();
            if (snapshot) {
              result.headers.set('X-Request-ID', snapshot.requestId);
            }
          }
          return result;
        }

        // Otherwise, wrap the result in a success response.
        return successResponse(result);
      } catch (err) {
        return errorFromThrown(err, {
          context: { operation: options.operation, component: options.component },
        });
      }
    };

    // Only wrap in request context if `req` looks like a real Request.
    if (req && typeof req === 'object' && 'url' in req && 'headers' in req) {
      return withRequestContext(req, runWithCtx);
    }
    return runWithCtx();
  };
}

// ── Re-exports for convenience ───────────────────────────────────────────────
//
// Re-export the request-context accessors so route handlers can import
// everything from `@/lib/api-response` without needing a second import.
export {
  getRequestContextSnapshot,
  getRequestId,
  getRequestDuration,
  getRequestContext,
  enrichRequestContext,
} from './request-context';
export type { RequestContext, RequestContextSnapshot } from './request-context';

// ── Convenience: build a not-found response ─────────────────────────────────

/**
 * Build a standardised 404 response. Convenience for routes that need to
 * short-circuit on a missing record.
 *
 * @example
 *   const product = await db.product.findUnique({ where: { id } });
 *   if (!product) return notFoundResponse('Product not found.');
 */
export function notFoundResponse(
  message = 'Resource not found.',
  options: { headers?: Record<string, string> } = {},
): Response {
  return errorResponse(
    {
      message,
      code: 'NOT_FOUND',
      statusCode: 404,
      raw: new Error(message),
    },
    { headers: options.headers },
  );
}

/**
 * Build a standardised 400 (validation error) response.
 */
export function validationErrorResponse(
  message: string,
  options: { headers?: Record<string, string> } = {},
): Response {
  return errorResponse(
    {
      message,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      raw: new Error(message),
    },
    { headers: options.headers },
  );
}

/**
 * Build a standardised 401 (unauthorized) response.
 */
export function unauthorizedResponse(
  message = 'Authentication required.',
  options: { headers?: Record<string, string> } = {},
): Response {
  return errorResponse(
    {
      message,
      code: 'UNAUTHORIZED',
      statusCode: 401,
      raw: new Error(message),
    },
    { headers: options.headers },
  );
}

/**
 * Build a standardised 403 (forbidden) response.
 */
export function forbiddenResponse(
  message = 'You do not have permission to perform this action.',
  options: { headers?: Record<string, string> } = {},
): Response {
  return errorResponse(
    {
      message,
      code: 'FORBIDDEN',
      statusCode: 403,
      raw: new Error(message),
    },
    { headers: options.headers },
  );
}
