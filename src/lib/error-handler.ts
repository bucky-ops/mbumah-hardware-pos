/**
 * Unified error-handling utilities for the Mbumah Hardware POS system.
 *
 * This module is safe to import on both client and server (no React or Next
 * runtime dependencies). It provides:
 *   - `handleError(err, ctx?)`         → normalises any thrown value into a user-friendly message + logs it
 *   - `toErrorMessage(err)`            → extract a clean string message from unknown errors
 *   - `withErrorHandling(fn, ctx?)`    → wrap an async function (e.g. an API route handler) so it never throws
 *   - `safeQuery(fn, fallback)`        → run an async query, returning fallback on failure (client-side)
 *   - `createMutationErrorHandler(toastFn)` → reusable onError for React Query mutations
 *
 * The existing `AppError` family (in components/error-boundary.tsx) is re-used
 * for typed error propagation. This module adds the "last mile" of UX: turning
 * any error — network, zod, prisma, AppError, plain string — into a consistent,
 * actionable message for the user and a structured log entry.
 */

import { AppError, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError } from '@/components/error-boundary';

export type ErrorContext = string | { operation?: string; userId?: string; storeId?: string; [k: string]: unknown };

/** Well-known error codes that map to user-facing categories. */
export const ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN_ERROR',
} as const;

export interface NormalisedError {
  message: string;
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
  raw: unknown;
}

/**
 * Convert any thrown value into a clean, user-readable message.
 * Strips stack traces, JSON wrappers, and generic boilerplate.
 */
export function toErrorMessage(err: unknown): string {
  if (!err) return 'An unknown error occurred';

  // AppError family — already structured
  if (err instanceof AppError) {
    return err.message;
  }

  if (err instanceof Error) {
    const msg = err.message || err.name;
    // Prisma errors
    if (err.name === 'PrismaClientKnownRequestError') {
      const prismaErr = err as unknown as { code?: string; meta?: { cause?: string } };
      if (prismaErr.code === 'P2002') return 'A record with this value already exists';
      if (prismaErr.code === 'P2025') return 'Record not found';
      if (prismaErr.code === 'P2003') return 'Cannot delete — this record is referenced by other data';
      return prismaErr.meta?.cause || msg;
    }
    // Zod errors
    if (err.name === 'ZodError') {
      const zodErr = err as unknown as { issues?: Array<{ message: string; path?: unknown[] }> };
      if (zodErr.issues?.length) {
        return zodErr.issues.map((i) => i.message).join('; ');
      }
    }
    return msg;
  }

  if (typeof err === 'string') return err;

  // Fetch/Response errors
  if (err && typeof err === 'object' && 'status' in err && 'statusText' in err) {
    const r = err as { status: number; statusText: string };
    if (r.status === 401) return 'You are not logged in. Please sign in again.';
    if (r.status === 403) return 'You do not have permission to perform this action.';
    if (r.status === 404) return 'The requested resource was not found.';
    if (r.status === 429) return 'Too many requests. Please slow down and try again shortly.';
    if (r.status >= 500) return 'A server error occurred. Please try again later.';
    return r.statusText || `Request failed (${r.status})`;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return 'An unknown error occurred';
  }
}

/** Map an unknown error to a NormalisedError with code + status. */
export function normaliseError(err: unknown): NormalisedError {
  if (err instanceof AppError) {
    return { message: err.message, code: err.code, statusCode: err.statusCode, details: err.details, raw: err };
  }
  if (err instanceof Error) {
    if (err.name === 'ZodError') {
      return { message: toErrorMessage(err), code: ERROR_CODES.VALIDATION, statusCode: 400, raw: err };
    }
    if (err.name === 'PrismaClientKnownRequestError') {
      const prismaErr = err as unknown as { code?: string };
      if (prismaErr.code === 'P2025') return { message: toErrorMessage(err), code: ERROR_CODES.NOT_FOUND, statusCode: 404, raw: err };
      if (prismaErr.code === 'P2002') return { message: toErrorMessage(err), code: ERROR_CODES.CONFLICT, statusCode: 409, raw: err };
      return { message: toErrorMessage(err), code: ERROR_CODES.SERVER, statusCode: 500, raw: err };
    }
    return { message: toErrorMessage(err), code: ERROR_CODES.UNKNOWN, statusCode: 500, raw: err };
  }
  return { message: toErrorMessage(err), code: ERROR_CODES.UNKNOWN, statusCode: 500, raw: err };
}

/**
 * Log an error to the console with structured context.
 * In production you could extend this to ship to Sentry / a logging endpoint.
 */
export function logError(err: unknown, ctx?: ErrorContext): void {
  const context = typeof ctx === 'string' ? { operation: ctx } : (ctx || {});
  const normalised = normaliseError(err);
  console.error('[MbumahErrorHandler]', {
    message: normalised.message,
    code: normalised.code,
    statusCode: normalised.statusCode,
    context,
    stack: err instanceof Error ? err.stack : undefined,
  });

  // Persist a compact ring buffer of recent errors for debugging in the UI
  if (typeof window !== 'undefined') {
    try {
      const key = 'mbt_error_log';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.unshift({
        message: normalised.message,
        code: normalised.code,
        statusCode: normalised.statusCode,
        context,
        timestamp: new Date().toISOString(),
        url: window.location.pathname,
      });
      localStorage.setItem(key, JSON.stringify(existing.slice(0, 25)));
    } catch {
      /* ignore storage errors */
    }
  }
}

/**
 * The main "error handling function across the whole system".
 * Returns a user-friendly message and logs the error.
 *
 * Usage:
 *   try { await api() } catch (e) { const msg = handleError(e, 'Create invoice'); toast.error(msg); }
 */
export function handleError(err: unknown, ctx?: ErrorContext): string {
  logError(err, ctx);
  return toErrorMessage(err);
}

/**
 * Wrap an async function so it never throws. On error it logs and returns a
 * `NormalisedError` instead. Useful in API route handlers and server actions.
 *
 * Usage (server):
 *   export async function POST(req: Request) {
 *     const result = await withErrorHandling(() => createInvoice(req), 'Create invoice');
 *     if ('code' in result) return Response.json({ success: false, error: result.message }, { status: result.statusCode });
 *     return Response.json({ success: true, data: result });
 *   }
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  ctx?: ErrorContext
): Promise<T | NormalisedError> {
  try {
    return await fn();
  } catch (err) {
    return normaliseError(err instanceof Error ? err : new Error(toErrorMessage(err))) && (() => {
      logError(err, ctx);
      return normaliseError(err);
    })();
  }
}

/**
 * Run an async query, returning a fallback value on failure (client-side).
 * Logs the error and never throws.
 */
export async function safeQuery<T>(fn: () => Promise<T>, fallback: T, ctx?: ErrorContext): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    handleError(err, ctx);
    return fallback;
  }
}

/** Build a reusable onError handler for React Query mutations. */
export function createMutationErrorHandler(
  toastFn: (msg: string, opts?: { description?: string }) => void
) {
  return (err: unknown, _variables: unknown, _context: unknown) => {
    const normalised = normaliseError(err);
    logError(err, { operation: 'mutation' });
    const description =
      normalised.statusCode === 401
        ? 'Your session may have expired. Please sign in again.'
        : normalised.statusCode === 429
          ? 'You are doing this too quickly. Please wait a moment.'
          : undefined;
    toastFn(normalised.message, { description });
  };
}

/** Re-export the typed error classes for convenience. */
export { AppError, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError };
