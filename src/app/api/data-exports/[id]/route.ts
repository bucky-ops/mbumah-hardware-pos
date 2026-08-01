// GET/DELETE /api/data-exports/[id]
//
// Single-record operations on a DataExport row. DELETE also unlinks the file
// from disk (best-effort — DB row is removed even if the file is missing).

import { type NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

const EXPORTS_DIR = '/home/z/my-project/download/exports';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── GET: single export record ───────────────────────────────────────────────

async function getExportHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const exportRow = await db.dataExport.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!exportRow) {
    return Response.json(
      { success: false, error: 'Export not found.' },
      { status: 404 },
    );
  }

  return Response.json({ success: true, data: exportRow });
}

// ── DELETE: remove record + file ────────────────────────────────────────────

async function deleteExportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  const existing = await db.dataExport.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Export not found.' },
      { status: 404 },
    );
  }

  // Best-effort file deletion — the DB row is the source of truth.
  if (existing.filePath) {
    const filePath = path.join(EXPORTS_DIR, existing.filePath);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // File may already be missing (expired, manually removed, etc.).
      // Log a warning but continue with DB deletion.
      await systemLog({
        action: 'DATA_EXPORT_FILE_MISSING',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.WARN,
        message: `Export file ${existing.filePath} could not be deleted: ${
          err instanceof Error ? err.message : String(err)
        }`,
        storeId: existing.storeId,
        userId: userId || undefined,
        metadata: { exportId: id, filePath: existing.filePath },
      }).catch(() => {});
    }
  }

  await db.dataExport.delete({ where: { id } });

  await systemLog({
    action: 'DATA_EXPORT_DELETED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Data export ${id} (${existing.exportType}/${existing.format}) deleted.`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: {
      exportId: id,
      exportType: existing.exportType,
      format: existing.format,
      recordCount: existing.recordCount,
    },
  });

  return Response.json({
    success: true,
    message: 'Export deleted successfully.',
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getExportHandler, FINANCIAL_READ_ROLES),
  'DATA_EXPORT_GET',
);

export const DELETE = withErrorBoundary(
  withFinancialAuth(deleteExportHandler, FINANCIAL_WRITE_ROLES),
  'DATA_EXPORT_DELETE',
);
