// GET  /api/financial/trial-balance/snapshot — list snapshots for a store (newest first).
// POST /api/financial/trial-balance/snapshot — capture a new point-in-time snapshot.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { captureTrialBalanceSnapshot } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

async function listSnapshotsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const snapshots = await db.trialBalanceSnapshot.findMany({
    where: { storeId },
    orderBy: { snapshotDate: 'desc' },
    include: {
      period: {
        select: { id: true, periodName: true, startDate: true, endDate: true, status: true },
      },
    },
    take: 100,
  });

  const data = snapshots.map((s) => ({
    id: s.id,
    storeId: s.storeId,
    periodId: s.periodId,
    snapshotDate: s.snapshotDate,
    balances: s.balances,
    totalDebits: s.totalDebits.toNumber(),
    totalCredits: s.totalCredits.toNumber(),
    isBalanced: s.isBalanced,
    generatedByUserId: s.generatedByUserId,
    createdAt: s.createdAt,
    period: s.period,
  }));

  return Response.json({ success: true, data });
}

async function captureSnapshotHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, periodId, generatedByUserId, snapshotDate } = body as {
    storeId?: string;
    periodId?: string;
    generatedByUserId?: string;
    snapshotDate?: string;
  };

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }
  if (!generatedByUserId) {
    return Response.json(
      { success: false, error: 'generatedByUserId is required for the audit trail.' },
      { status: 400 },
    );
  }

  const snapDate = snapshotDate ? new Date(snapshotDate) : undefined;
  if (snapshotDate && (!snapDate || isNaN(snapDate.getTime()))) {
    return Response.json(
      { success: false, error: 'snapshotDate must be a valid ISO 8601 date.' },
      { status: 400 },
    );
  }

  try {
    const snapshot = await captureTrialBalanceSnapshot(storeId, generatedByUserId, {
      periodId,
      snapshotDate: snapDate,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    return Response.json(
      {
        success: true,
        data: {
          ...snapshot,
          totalDebits: snapshot.totalDebits.toNumber(),
          totalCredits: snapshot.totalCredits.toNumber(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }
    throw error;
  }
}

export const GET = withErrorBoundary(listSnapshotsHandler, LogComponent.FINANCIAL);
export const POST = withErrorBoundary(captureSnapshotHandler, LogComponent.FINANCIAL);
