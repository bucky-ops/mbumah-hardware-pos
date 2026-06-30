// POST /api/logs/client-error
//
// Receives client-side error reports from the error boundary (error.tsx /
// global-error.tsx) and the global window.onerror handler. Writes them to the
// SystemLog table so they appear in the admin audit trail alongside
// server-side errors.
//
// This endpoint is PUBLIC (no auth required) because client errors can happen
// before / during authentication (e.g. a hydration crash on the login page).
// The middleware.ts layer already rate-limits this endpoint (5 req/min/IP via the
// CLIENT_ERROR tier) and exempts it from CSRF checks.
//
// To prevent abuse, the payload size is capped, strings are truncated, and
// Zod validates the body structure before any DB write.

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { systemLog } from '@/lib/logger';
import { runWithoutTenant } from '@/lib/db';
import { LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_STRING_LENGTH = 4000;
const MAX_STACK_LENGTH = 8000;

// ── Zod Schema ────────────────────────────────────────────────────────────────

const clientErrorSchema = z.object({
  message: z
    .string()
    .min(1, 'message is required and must be a non-empty string.')
    .max(MAX_STRING_LENGTH),
  name: z.string().max(MAX_STRING_LENGTH).optional(),
  stack: z.string().max(MAX_STACK_LENGTH).optional(),
  digest: z.string().max(200).optional(),
  url: z.string().max(MAX_STRING_LENGTH).optional(),
  userAgent: z.string().max(MAX_STRING_LENGTH).optional(),
  severity: z
    .enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'])
    .optional()
    .default('ERROR'),
  metadata: z.record(z.unknown()).optional(),
});

type ClientErrorPayload = z.infer<typeof clientErrorSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(
  value: string | undefined,
  max: number,
): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) + '…[truncated]' : trimmed;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json(
      { success: false, error: 'Method not allowed.' },
      { status: 405 },
    );
  }

  // ── Parse & Validate Body ──────────────────────────────────────
  let payload: ClientErrorPayload;
  try {
    const raw = await req.json();
    const parsed = clientErrorSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return Response.json(
        { success: false, error: `Validation failed: ${issues}` },
        { status: 400 },
      );
    }
    payload = parsed.data;
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  // ── Truncate fields (belt-and-suspenders — Zod already enforces max) ──
  const message = truncate(payload.message, MAX_STRING_LENGTH)!;
  const name = truncate(payload.name, MAX_STRING_LENGTH);
  const stack = truncate(payload.stack, MAX_STACK_LENGTH);
  const url = truncate(payload.url, MAX_STRING_LENGTH);
  const userAgent = truncate(payload.userAgent, MAX_STRING_LENGTH);
  const digest = truncate(payload.digest, 200);
  const severity = payload.severity;

  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined;

  // ── Always log to server console (even if DB write fails) ──────
  console.error('🚨 CLIENT ERROR:', JSON.stringify({
    name,
    message,
    severity,
    url,
    userAgent,
    digest,
    clientIp,
    source: 'client-error-boundary',
  }));

  // ── Attempt DB write (best-effort, never block the response) ───
  try {
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
        ipAddress: clientIp,
      });
    });
  } catch (dbError) {
    // DB write failed (e.g. connection issue) — don't mask the original
    // client error. Log the DB failure to console and return success so
    // the client doesn't retry endlessly.
    console.error('❌ Failed to write client error to SystemLog:', dbError);
  }

  return new Response(null, { status: 204 });
}

export { handler as POST };
