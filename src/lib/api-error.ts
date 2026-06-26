// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Structured API Error Class
// ─────────────────────────────────────────────────────────────────────────────
//
// A single, typed error class for all API route failures. Replaces ad-hoc
// `throw new Error("...")` + `Response.json({ error: "..." }, { status })`
// pairs with a structured approach that:
//
//   1. Carries an HTTP status code, machine-readable error code, user-facing
//      message, and optional developer detail.
//   2. Integrates with `withErrorBoundary` (logger.ts) — the boundary reads
//      the status code and error code from the thrown APIError and produces
//      the correct HTTP response.
//   3. Integrates with Sentry (`captureAPIError`) — structured context is
//      forwarded for aggregation.
//   4. Supports a `cause` chain (ES2022) so we can wrap low-level Prisma /
//      fetch errors without losing the original stack.
//
// USAGE
//
//   import { APIError, ErrorCode } from '@/lib/api-error';
//
//   // In a route handler:
//   if (!storeId) {
//     throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'storeId is required.');
//   }
//   if (!product) {
//     throw new APIError(404, ErrorCode.NOT_FOUND, 'Product not found.', {
//       detail: `No product with SKU ${sku}`,
//     });
//   }
//
//   // Wrapping a low-level error:
//   try {
//     await db.product.create({ data });
//   } catch (e) {
//     throw new APIError(500, ErrorCode.DATABASE_ERROR, 'Failed to create product.', {
//       cause: e,
//     });
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

import { captureAPIError } from "./sentry";

// ── Error codes (machine-readable) ───────────────────────────────────────────

export const ErrorCode = {
  // 400-level
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  // 500-level
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  PAYMENT_ERROR: "PAYMENT_ERROR",
  IMMUTABILITY_VIOLATION: "IMMUTABILITY_VIOLATION",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── APIError class ───────────────────────────────────────────────────────────

export interface APIErrorOptions {
  /** Developer-facing detail (not shown to end users in production). */
  detail?: string;
  /** The original error that caused this one (for error chaining). */
  cause?: unknown;
  /** Additional structured context for Sentry / logging. */
  context?: Record<string, string | number | boolean>;
  /** The route path where the error originated (for Sentry routing). */
  route?: string;
  /** The HTTP method (GET, POST, etc.). */
  method?: string;
  /** The authenticated user ID (if available). */
  userId?: string;
  /** The store ID (if available). */
  storeId?: string;
}

export class APIError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly detail?: string;
  readonly context?: Record<string, string | number | boolean>;
  readonly route?: string;
  readonly method?: string;
  readonly userId?: string;
  readonly storeId?: string;
  readonly timestamp: string;

  constructor(
    statusCode: number,
    code: ErrorCode,
    userMessage: string,
    options: APIErrorOptions = {},
  ) {
    super(userMessage, { cause: options.cause });
    this.name = "APIError";
    this.statusCode = statusCode;
    this.code = code;
    this.userMessage = userMessage;
    this.detail = options.detail;
    this.context = options.context;
    this.route = options.route;
    this.method = options.method;
    this.userId = options.userId;
    this.storeId = options.storeId;
    this.timestamp = new Date().toISOString();
  }

  // ── Convenience factory methods ──────────────────────────────────────────

  static badRequest(message: string, options?: APIErrorOptions): APIError {
    return new APIError(400, ErrorCode.VALIDATION_ERROR, message, options);
  }

  static unauthorized(message = "Authentication required.", options?: APIErrorOptions): APIError {
    return new APIError(401, ErrorCode.UNAUTHORIZED, message, options);
  }

  static forbidden(message = "You do not have permission to perform this action.", options?: APIErrorOptions): APIError {
    return new APIError(403, ErrorCode.FORBIDDEN, message, options);
  }

  static notFound(message = "Resource not found.", options?: APIErrorOptions): APIError {
    return new APIError(404, ErrorCode.NOT_FOUND, message, options);
  }

  static conflict(message: string, options?: APIErrorOptions): APIError {
    return new APIError(409, ErrorCode.CONFLICT, message, options);
  }

  static rateLimited(message = "Too many requests. Please slow down.", options?: APIErrorOptions): APIError {
    return new APIError(429, ErrorCode.RATE_LIMITED, message, options);
  }

  static internal(message = "An internal server error occurred.", options?: APIErrorOptions): APIError {
    return new APIError(500, ErrorCode.INTERNAL_ERROR, message, options);
  }

  static databaseError(message: string, cause?: unknown): APIError {
    return new APIError(500, ErrorCode.DATABASE_ERROR, message, { cause });
  }

  static paymentError(message: string, options?: APIErrorOptions): APIError {
    return new APIError(502, ErrorCode.PAYMENT_ERROR, message, options);
  }

  // ── Serialization ────────────────────────────────────────────────────────

  /**
   * Serialize to a JSON response body. In production, `detail` is omitted to
   * avoid leaking internals. In development (or when EXPOSE_ERRORS=true), the
   * full detail + cause is included for debugging.
   */
  toJSON(): Record<string, unknown> {
    const exposeErrors =
      process.env.NODE_ENV === "development" ||
      process.env.EXPOSE_ERRORS === "true" ||
      process.env.EXPOSE_ERRORS === "1";

    const body: Record<string, unknown> = {
      success: false,
      error: this.userMessage,
      code: this.code,
      timestamp: this.timestamp,
    };

    if (exposeErrors) {
      body.detail = this.detail;
      body.context = this.context;
      if (this.cause instanceof Error) {
        body.cause = {
          name: this.cause.name,
          message: this.cause.message,
        };
      }
    }

    return body;
  }

  /**
   * Convert to a Next.js Response object with the correct status code and
   * JSON body.
   */
  toResponse(): Response {
    return Response.json(this.toJSON(), { status: this.statusCode });
  }

  /**
   * Report this error to Sentry (non-blocking, never throws).
   */
  async reportToSentry(): Promise<void> {
    await captureAPIError(this, {
      route: this.route ?? "unknown",
      method: this.method ?? "unknown",
      storeId: this.storeId,
      userId: this.userId,
      statusCode: this.statusCode,
    });
  }
}

// ── Helper: wrap an async handler with APIError-aware error handling ─────────

/**
 * Wrap an API route handler with structured error handling. Any thrown
 * `APIError` is converted to its JSON response; any other error is wrapped
 * in a 500 APIError and reported to Sentry.
 *
 * This is an ALTERNATIVE to `withErrorBoundary` (logger.ts) that uses the
 * structured APIError class. Prefer this for new routes; `withErrorBoundary`
 * remains for backward compatibility with existing routes.
 *
 * @example
 *   export const POST = apiHandler(async (req: NextRequest) => {
 *     const body = await req.json();
 *     if (!body.storeId) throw APIError.badRequest('storeId is required.');
 *     // ... business logic ...
 *     return Response.json({ success: true, data: result });
 *   }, { route: '/api/products', component: 'PRODUCT_CREATE' });
 */
export function apiHandler(
  handler: (req: Request | unknown, ...args: unknown[]) => Promise<Response>,
  options: {
    route: string;
    component?: string;
  },
): (req: Request, ...args: unknown[]) => Promise<Response> {
  return async (req: Request, ...args: unknown[]) => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      // Already a structured APIError — just respond + report.
      if (error instanceof APIError) {
        // Enrich with route/method if not already set.
        if (!error.route) {
          try {
            const url = new URL((req as Request).url);
            error.route = url.pathname;
            error.method = (req as Request).method;
          } catch {
            // req.url might not be a valid URL in test contexts.
          }
        }
        // Report 5xx errors to Sentry; 4xx are expected, don't spam Sentry.
        if (error.statusCode >= 500) {
          error.reportToSentry().catch(() => {});
        }
        return error.toResponse();
      }

      // Unknown error — wrap in a 500 APIError and report.
      const wrapped = APIError.internal(
        error instanceof Error ? error.message : "Unknown error",
        {
          cause: error,
          route: options.route,
        },
      );
      // Try to extract method from request.
      try {
        wrapped.method = (req as Request).method;
      } catch {}

      await wrapped.reportToSentry().catch(() => {});

      // In dev, include the original error detail.
      if (process.env.NODE_ENV === "development") {
        wrapped.detail =
          error instanceof Error ? error.stack : String(error);
      }

      return wrapped.toResponse();
    }
  };
}
