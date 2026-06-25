// System logger & API error boundary

import { db } from './db';
import { LogSeverity, LogComponent } from './types';

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
            error: userMessage,
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

      // Production default: sanitized response, no internals leaked.
      return Response.json(
        { success: false, error: userMessage },
        { status: 500 }
      );
    }
  };
}
