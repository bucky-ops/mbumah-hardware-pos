// POST /api/payments/mpesa/b2c/result - Safaricom Daraja B2C result webhook.
//
// Daraja calls this endpoint asynchronously after a B2C SalaryPayment request
// to report the final state (success with TransactionID, or failure). The
// payslip settlement itself lives in disbursement-service.settlePayrollB2CResult
// which is idempotent: the callback is claimed exactly once per MpesaTransaction
// row and one receipt settles at most one row.
//
// SECURITY (mirrors /api/payments/mpesa/callback, audit remediation F6-1):
//   • HTTP Basic credentials when MPESA_CALLBACK_USERNAME/PASSWORD are set
//     (register the ResultURL as https://user:pass@host/api/... upstream).
//   • Optional IP allowlist via MPESA_CALLBACK_IPS.
//   • Every rejection is written to SecurityEvent.
//   • This route stays PUBLIC (Safaricom cannot present a user session) but is
//     credentialed - `export const POST` is deliberately not wrapped in
//     requireAuth; do not "fix" that.

import { type NextRequest } from 'next/server';
import nodeCrypto from 'crypto';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { settlePayrollB2CResult, type B2CResultPayload } from '@/lib/hr/payroll/disbursement-service';

export const dynamic = 'force-dynamic';

async function logSecurityEvent(opts: {
  eventType: string;
  severity?: string;
  request: NextRequest;
  details: Record<string, unknown>;
  blocked?: boolean;
}): Promise<void> {
  try {
    await db.securityEvent.create({
      data: {
        eventType: opts.eventType,
        severity: opts.severity || 'WARN',
        ipAddress:
          opts.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          opts.request.headers.get('x-real-ip') ||
          null,
        resource: '/api/payments/mpesa/b2c/result',
        action: 'MPESA_B2C_RESULT',
        details: JSON.stringify(opts.details).slice(0, 1000),
        userAgent: opts.request.headers.get('user-agent') || null,
        blocked: opts.blocked ?? true,
      },
    });
  } catch {
    /* security logging must never throw into the webhook path */
  }
}

/** Same authorisation contract as the C2B callback (F6-1). */
async function authorizeCallback(request: NextRequest): Promise<Response | null> {
  const user = process.env.MPESA_CALLBACK_USERNAME;
  const pass = process.env.MPESA_CALLBACK_PASSWORD;

  if (user && pass) {
    const header = request.headers.get('authorization') || '';
    const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    const equal = a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
    if (!equal) {
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'ERROR',
        request,
        details: { reason: 'bad_credentials', path: '/api/payments/mpesa/b2c/result' },
      });
      return Response.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const allowList = (process.env.MPESA_CALLBACK_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowList.length > 0) {
    const ip = getClientIp(request) || '';
    if (!ip || !allowList.includes(ip)) {
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'ERROR',
        request,
        details: { reason: 'ip_not_allowed', ip: ip || 'unknown' },
      });
      return Response.json({ success: false, error: 'Forbidden.' }, { status: 403 });
    }
  }

  return null;
}

async function b2cResultHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
    const clientIp = getClientIp(request);
    if (isRateLimited(`mpesa-b2c-result:${clientIp}`, 'WEBHOOK').limited) {
      return Response.json({ success: false, error: 'Too many requests.' }, { status: 429 });
    }

    const denied = await authorizeCallback(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as B2CResultPayload | null;
    if (!body || typeof body !== 'object') {
      return Response.json({ success: false, error: 'Malformed body.' }, { status: 400 });
    }

    const outcome = await settlePayrollB2CResult(body);

    await systemLog({
      action: 'MPESA_B2C_RESULT',
      component: LogComponent.PAYMENT,
      severity: outcome.outcome === 'FAILED' ? LogSeverity.WARN : LogSeverity.INFO,
      message: `B2C result: ${outcome.outcome}${outcome.alreadySettled ? ' (duplicate ignored)' : ''}`,
      metadata: { outcome: outcome.outcome, settled: outcome.settled, alreadySettled: outcome.alreadySettled },
    }).catch(() => {});

    // Always 200 once authenticated: Daraja retries non-2xx aggressively and
    // the settlement is already idempotent.
    return Response.json({ success: true, data: outcome });
}

export const POST = withErrorBoundary(b2cResultHandler, 'MPESA_B2C_RESULT');
