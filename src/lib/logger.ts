// System logger & API error boundary

import { db } from './db';
import { LogSeverity } from './types';

interface LogEntry {
  storeId?: string;
  userId?: string;
  action: string;
  component: string;
  severity?: string;
  message: string;
  metadata?: Record<string, unknown>;
  stackTrace?: string;
  ipAddress?: string;
}

export async function systemLog(entry: LogEntry): Promise<void> {
  try {
    await db.systemLog.create({
      data: {
        storeId: entry.storeId || null,
        userId: entry.userId || null,
        action: entry.action,
        component: entry.component,
        severity: entry.severity || LogSeverity.INFO,
        message: entry.message,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        stackTrace: entry.stackTrace || null,
        ipAddress: entry.ipAddress || null,
      },
    });
  } catch (error) {
    // Fallback: if DB logging fails, log to console
    console.error('[SYSTEM_LOG_FAILURE]', {
      original: entry,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Recursively sanitize an arbitrary value for diagnostic logging.
 *
 * Used by API routes that log the REQUEST PAYLOAD on unhandled errors (see
 * the [TRANSACTION-API-ERROR] wrapper in /api/transactions). Goals:
 *   • never leak credentials / payment PII into stdout or log aggregators
 *     (M-Pesa phone numbers, gift-card codes, passwords, PINs, tokens);
 *   • keep entries bounded (arrays capped, strings truncated) so a runaway
 *     payload cannot flood the Vercel runtime log line.
 */
const LOG_REDACT_KEYS = new Set([
  'password', 'passwordhash', 'pin', 'token', 'secret', 'authorization',
  'mpesaphone', 'phonenumber', 'phone', 'giftcardcode', 'giftcardid',
  'mpesareceiptnumber', 'reference', 'otp',
]);
const LOG_MAX_STRING = 300;
const LOG_MAX_ARRAY = 10;
const LOG_MAX_DEPTH = 4;

export function sanitizeForLog(
  value: unknown,
  depth = 0,
  key?: string,
): unknown {
  if (value === null || value === undefined) return value;

  const redactKey =
    typeof key === 'string' && LOG_REDACT_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));

  if (typeof value === 'string') {
    const capped = value.length > LOG_MAX_STRING ? `${value.slice(0, LOG_MAX_STRING)}…` : value;
    return redactKey ? '[REDACTED]' : capped;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value).slice(0, LOG_MAX_STRING);

  if (depth >= LOG_MAX_DEPTH) return '[depth-limit]';

  if (Array.isArray(value)) {
    return value.slice(0, LOG_MAX_ARRAY).map((v) => sanitizeForLog(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeForLog(v, depth + 1, k);
  }
  return out;
}

// Map technical errors to user-friendly messages
export function mapErrorToUserMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes('unique constraint') || msg.includes('unique violation')) {
      if (msg.includes('email')) return 'A user with this email already exists.';
      if (msg.includes('sku')) return 'A product with this SKU already exists.';
      if (msg.includes('barcode')) return 'A product with this barcode already exists.';
      return 'This record already exists. Please use a different value.';
    }

    if (msg.includes('foreign key constraint') || msg.includes('foreignkeyconstraintviolation')) {
      if (msg.includes('product')) return 'Cannot delete this product because it has related records (sales, stock, etc.).';
      if (msg.includes('customer')) return 'Cannot delete this customer because they have outstanding transactions.';
      return 'Cannot delete this record because it is referenced by other records.';
    }

    if (msg.includes('insufficient stock') || msg.includes('negative stock')) {
      return 'Insufficient stock available for this item.';
    }

    if (msg.includes('debt limit') || msg.includes('credit limit')) {
      return 'This customer has reached their credit limit.';
    }

    if (msg.includes('mpesa') || msg.includes('stk push')) {
      return 'M-Pesa payment could not be initiated. Please try again or use another payment method.';
    }

    return 'An unexpected error occurred. Please try again.';
  }

  return 'An unknown error occurred. Please contact support.';
}

// Safe wrapper for API route handlers
//
// ## Diagnostic mode (EXPOSE_ERRORS)
//
// By default, production 500 responses return a sanitized `userMessage` with
// NO stack trace — to avoid leaking internals to end users. This is the
// correct secure default, but it makes Vercel production crashes effectively
// invisible (you see "An unexpected error occurred" in the Network tab with
// no clue why).
//
// To diagnose a production 500, set `EXPOSE_ERRORS=true` in your Vercel
// Environment Variables (Project Settings → Environment Variables), redeploy,
// and reproduce the request. The 500 response body will then include the
// FULL error details:
//
//   {
//     "success": false,
//     "error": "<userMessage>",
//     "detail": {
//       "name": "PrismaClientInitializationError",
//       "message": "The table `User` does not exist in the database...",
//       "stack": "...",
//       "code": "P1003",
//       "component": "AUTH_LOGIN"
//     }
//   }
//
// Remove `EXPOSE_ERRORS` once the issue is resolved — it is NOT recommended
// for long-term production use (stack traces can leak schema/SQL details).
export function withErrorBoundary(
  handler: (...args: unknown[]) => Promise<Response>,
  component: string
) {
  return async (...args: unknown[]): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const userMessage = mapErrorToUserMessage(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : typeof error;
      const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
      // Prisma errors carry a `code` (e.g. P1003 = table missing, P1001 = connection lost).
      // Grab it for diagnostics — `any` cast is intentional because Prisma's error
      // class isn't imported here to avoid a circular dep.
      const errorCode = (error as { code?: string } | null)?.code;

      // Best-effort system log — never let logging failures mask the original error.
      try {
        await systemLog({
          action: 'API_ERROR',
          component,
          severity: LogSeverity.ERROR,
          message: errorMessage,
          stackTrace,
          metadata: {
            args: args.map(a => String(a).slice(0, 200)),
            errorName,
            errorCode,
          },
        });
      } catch {
        // logging failed (likely the same DB issue) — fall through to response
      }

      // ── Structured stdout logging (always, every environment) ──────────
      // Vercel captures console output in Runtime Logs, so this is the
      // diagnostic breadcrumb for production 500s whose response body is
      // sanitized. Previously a production 500 was completely opaque:
      // "An unexpected error occurred" with NOTHING on stdout.
      const request = args[0] as { method?: string; url?: string } | undefined;
      console.error('[API-ERROR]', JSON.stringify({
        component,
        method: request?.method,
        path: request?.url ? (() => { try { return new URL(request.url).pathname; } catch { return undefined; } })() : undefined,
        errorName,
        errorCode,
        error: errorMessage,
        stack: stackTrace,
      }));

      // Map Prisma schema-drift errors to an actionable user message.
      // P2021 = table missing, P2022 = column missing — both mean the
      // deployed database schema is behind the deployed code (see
      // scripts/sync-db-schema.mjs which makes that state impossible).
      const isSchemaDrift = errorCode === 'P2021' || errorCode === 'P2022';
      const finalUserMessage = isSchemaDrift
        ? 'A database schema error occurred. The system may need a redeploy. Please contact support if this persists.'
        : userMessage;

      // Determine whether to expose full error details.
      //
      // - In development: always expose (NODE_ENV === 'development').
      // - In production: expose ONLY when EXPOSE_ERRORS is truthy
      //   ('true' / '1' / 'yes'). This is the opt-in diagnostic flag the user
      //   sets in Vercel env vars to debug production 500s.
      const exposeErrors =
        process.env.NODE_ENV === 'development' ||
        process.env.EXPOSE_ERRORS === 'true' ||
        process.env.EXPOSE_ERRORS === '1' ||
        process.env.EXPOSE_ERRORS === 'yes';

      if (exposeErrors) {
        return Response.json(
          {
            success: false,
            error: finalUserMessage,
            detail: {
              name: errorName,
              message: errorMessage,
              code: errorCode,
              stack: stackTrace,
              component,
            },
          },
          { status: 500 }
        );
      }

      // Production default: sanitized response — but now carrying the
      // NON-SENSITIVE diagnostic pair (error class + Prisma code + component)
      // so a 500 can be triaged straight from the browser Network tab
      // (e.g. code P2022 ⇒ schema drift) without leaking stack traces,
      // SQL fragments or schema details. message + stack remain server-only
      // (stdout / Runtime Logs).
      return Response.json(
        {
          success: false,
          error: finalUserMessage,
          detail: {
            name: errorName,
            code: errorCode,
            component,
          },
        },
        { status: 500 }
      );
    }
  };
}
