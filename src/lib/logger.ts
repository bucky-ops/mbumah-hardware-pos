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

      await systemLog({
        action: 'API_ERROR',
        component,
        severity: LogSeverity.ERROR,
        message: error instanceof Error ? error.message : 'Unknown API error',
        stackTrace,
        metadata: { args: args.map(a => String(a).slice(0, 200)) },
      });

      return Response.json(
        { success: false, error: userMessage, detail: process.env.NODE_ENV === 'development' ? stackTrace : undefined },
        { status: 500 }
      );
    }
  };
}
