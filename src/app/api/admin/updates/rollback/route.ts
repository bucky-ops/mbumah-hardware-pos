// MBUMAH HARDWARE POS - Admin Update Rollback API (SRV-2, v2.9.0)
//
// POST /api/admin/updates/rollback - re-point production at a previous Vercel
// deployment (the "Rollback" button in the admin Updates panel).
//
//   Body: { deploymentId: string }   (a Vercel deployment uid, e.g. dpl_XXXX)
//
// Cloud (Vercel): POSTs to the Vercel v13 rollback endpoint using
// VERCEL_TOKEN + VERCEL_PROJECT_ID (optional VERCEL_TEAM_ID for team scopes).
// Laptop kits have no Vercel project - the response tells the operator to run
// Rollback-Mbumah-POS.bat (deploy-kit) instead, and the panel hides the
// button when vercelConfigured=false (see GET /api/admin/updates).
//
// Non-2xx from Vercel → HTTP 502 with Vercel's own error message surfaced so
// the operator sees WHY (expired build cache, deployment not promotable, …).
//
// Auth: SUPER_ADMIN only - rollback is a destructive, org-wide action.

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLLBACK_TIMEOUT_MS = 10_000;

const rollbackBodySchema = z.object({
  deploymentId: z
    .string()
    .min(1, 'deploymentId is required (a Vercel deployment uid, e.g. dpl_XXXX).'),
});

// Handler
async function postHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  // Body validation
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const parsed = rollbackBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { deploymentId } = parsed.data;

  // Configuration gate
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Vercel rollback is not configured on this server (needs VERCEL_TOKEN + VERCEL_PROJECT_ID). Laptop kits: run Rollback-Mbumah-POS.bat instead.',
      },
      { status: 400 },
    );
  }

  // Call Vercel
  let response: Response;
  try {
    const url = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}/rollback`,
    );
    if (teamId) url.searchParams.set('teamId', teamId);

    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // No request body - the v13 rollback endpoint's contract is fully
        // expressed by the deployment id in the path (the target project is
        // implied by the deployment itself).
      },
      signal: AbortSignal.timeout(ROLLBACK_TIMEOUT_MS),
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? `timed out after ${ROLLBACK_TIMEOUT_MS / 1000}s`
          : error.message
        : String(error);

    await systemLog({
      action: 'VERCEL_ROLLBACK',
      component: 'SYSTEM',
      severity: LogSeverity.ERROR,
      message: `Vercel rollback of ${deploymentId} could not be initiated: ${detail}`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { deploymentId, triggeredBy: session.email, error: detail },
    }).catch(() => {});

    return NextResponse.json(
      {
        success: false,
        error: `Vercel rollback request failed: ${detail}`,
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    // Surface Vercel's own error message - the operator needs to know WHY.
    let vercelMessage = `Vercel returned HTTP ${response.status}.`;
    try {
      const payload = (await response.json()) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const message =
        (typeof payload.error?.message === 'string' && payload.error.message) ||
        (typeof payload.message === 'string' && payload.message) ||
        '';
      if (message) vercelMessage = `Vercel rollback failed: ${message}`;
    } catch {
      /* non-JSON error body - keep the HTTP-status message */
    }

    await systemLog({
      action: 'VERCEL_ROLLBACK',
      component: 'SYSTEM',
      severity: LogSeverity.ERROR,
      message: `Vercel rollback of ${deploymentId} failed: ${vercelMessage}`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: {
        deploymentId,
        triggeredBy: session.email,
        vercelStatus: response.status,
      },
    }).catch(() => {});

    return NextResponse.json(
      { success: false, error: vercelMessage },
      { status: 502 },
    );
  }

  // Success: audit + confirm
  await systemLog({
    action: 'VERCEL_ROLLBACK',
    component: 'SYSTEM',
    severity: LogSeverity.WARN,
    message: `Vercel production rolled back to deployment ${deploymentId} by ${session.email}.`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { deploymentId, triggeredBy: session.email },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    data: {
      status: 'rolling-back',
      deploymentId,
      message: `Vercel is rolling production back to deployment ${deploymentId}. It may take a minute for the previous deployment to become live.`,
    },
  });
}

// POST: SUPER_ADMIN only - rollback is a destructive, org-wide action.
export const POST = withErrorBoundary(
  requireAuth(postHandler, { roles: ['SUPER_ADMIN'] }),
  'ADMIN_UPDATES_ROLLBACK',
);
