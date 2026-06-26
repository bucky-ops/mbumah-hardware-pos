// POST /api/logs/client-error
//
// Receives client-side error reports from the error boundary (error.tsx /
// global-error.tsx) and the global window.onerror handler. Writes them to the
// SystemLog table so they appear in the admin audit trail alongside
// server-side errors.
//
// This endpoint is PUBLIC (no auth required) because client errors can happen
// before / during authentication (e.g. a hydration crash on the login page).
// To prevent abuse, the payload size is capped and strings are truncated.

import { type NextRequest } from 'next/server';
import { systemLog } from '@/lib/logger';
import { runWithoutTenant } from '@/lib/db';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_STRING_LENGTH = 4000;
const MAX_STACK_LENGTH = 8000;

interface ClientErrorPayload {
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
  url?: string;
  userAgent?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}

function truncate(
  value: string | undefined,
  max: number,
): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) + '…[truncated]' : trimmed;
}

function isValidSeverity(sev: string | undefined): boolean {
  if (!sev) return false;
  return ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'].includes(sev);
}

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json(
      { success: false, error: 'Method not allowed.' },
      { status: 405 },
    );
  }

  let payload: ClientErrorPayload;
  try {
    payload = (await req.json()) as ClientErrorPayload;
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  if (!payload.message || typeof payload.message !== 'string') {
    return Response.json(
      { success: false, error: 'message is required.' },
      { status: 400 },
    );
  }

  const severity = isValidSeverity(payload.severity)
    ? (payload.severity as string)
    : LogSeverity.ERROR;

  const message = truncate(payload.message, MAX_STRING_LENGTH)!;
  const name = truncate(payload.name, MAX_STRING_LENGTH);
  const stack = truncate(payload.stack, MAX_STACK_LENGTH);
  const url = truncate(payload.url, MAX_STRING_LENGTH);
  const userAgent = truncate(payload.userAgent, MAX_STRING_LENGTH);
  const digest = truncate(payload.digest, 200);

  await runWithoutTenant(async () => {
    await systemLog({
      action: 'CLIENT_ERROR',
      component: LogComponent.SYSTEM,
      severity,
      message: name ? `${name}: ${message}` : message,
      stackTrace: stack ?? undefined,
      metadata: {
        url,
        userAgent,
        digest,
        source: 'client-error-boundary',
        ...payload.metadata,
      },
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        undefined,
    });
  });

  return new Response(null, { status: 204 });
}

export { handler as POST };
