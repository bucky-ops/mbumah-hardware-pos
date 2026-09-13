// GET /api/data-exports/[id]/download
//
// Streams a completed data export (CSV/JSON) back to the browser as an
// attachment. This route is the missing half of the Data Export module —
// the frontend (`dataExportsApi.download` in src/lib/api.ts) has always
// called `/api/data-exports/<id>/download`, but no route handled it, so
// every download click produced the console error
// `Download failed (HTTP 404)` (mislabelled UNKNOWN_ERROR/500 by the
// client error normaliser).
//
// Payload resolution order (DOWNLOAD FIX v2.5.5):
//   1. `DataExport.content` — inline copy of the generated file stored in
//      the DB at creation time. This is the reliable source on Vercel
//      serverless, where the tmp filesystem is ephemeral per instance.
//   2. On-disk file under resolveExportsDir() — fast path for self-hosted
//      deployments that pin EXPORTS_DIR to a persistent volume.
//   If neither exists (expired instance, 10 MB+ export on serverless),
//   responds 410 Gone with a clear, actionable message.
//
// Auth: same FINANCIAL_READ_ROLES as /api/data-exports/[id]. Non-super-admin
// callers may only download exports belonging to their own store (the
// download route takes no storeId param, so the row itself is the scope).

import { type NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { resolveExportsDir } from '@/lib/export-paths';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

const EXPORTS_DIR = resolveExportsDir();

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Sanitise a string into a safe filename fragment (a-z0-9- only). */
function filenameFragment(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'export'
  );
}

async function downloadExportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const session = await getSessionFromRequest(request);

  const exportRow = await db.dataExport.findUnique({ where: { id } });

  if (!exportRow) {
    return Response.json(
      { success: false, error: 'Export not found. It may have been deleted.' },
      { status: 404 },
    );
  }

  // Zero-trust tenancy: non-super-admins can only download their own store's
  // exports. Mirror the FINANCIAL_ACCESS_DENIED audit trail used elsewhere.
  if (session && session.role !== 'SUPER_ADMIN' && exportRow.storeId !== session.storeId) {
    await systemLog({
      action: 'FINANCIAL_ACCESS_DENIED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: `User ${session.email} (role: ${session.role}) attempted to download export ${id} belonging to store ${exportRow.storeId}.`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { exportId: id, exportStoreId: exportRow.storeId },
    }).catch(() => {});

    return Response.json(
      { success: false, error: 'You do not have permission to download this export.' },
      { status: 403 },
    );
  }

  if (exportRow.status === 'PENDING' || exportRow.status === 'PROCESSING') {
    return Response.json(
      {
        success: false,
        error: 'This export is still being generated. Please try again in a few moments.',
      },
      { status: 409 },
    );
  }

  if (exportRow.status === 'FAILED') {
    return Response.json(
      {
        success: false,
        error: `Export generation failed${exportRow.errorMessage ? `: ${exportRow.errorMessage}` : '.'} Please create a new export.`,
      },
      { status: 409 },
    );
  }

  if (exportRow.expiresAt && exportRow.expiresAt.getTime() < Date.now()) {
    return Response.json(
      {
        success: false,
        error: 'This export has expired (files are kept for 7 days). Please generate a new export.',
      },
      { status: 410 },
    );
  }

  if (exportRow.status !== 'COMPLETED') {
    return Response.json(
      { success: false, error: `Export is not downloadable in its current state (${exportRow.status}).` },
      { status: 409 },
    );
  }

  const isJson = exportRow.format === 'JSON';
  const ext = isJson ? 'json' : 'csv';
  const contentType = isJson ? 'application/json' : 'text/csv';

  // 1. Preferred source — inline DB content (serverless-safe).
  let fileContent: string | null = exportRow.content ?? null;
  let source: 'DB' | 'FILE' = 'DB';

  // 2. Fallback — on-disk file (self-hosted persistent volume).
  if (fileContent === null && exportRow.filePath) {
    try {
      fileContent = await fs.readFile(path.join(EXPORTS_DIR, exportRow.filePath), 'utf8');
      source = 'FILE';
    } catch {
      fileContent = null;
    }
  }

  if (fileContent === null) {
    return Response.json(
      {
        success: false,
        error: 'This export file is no longer available. Please generate a new export with the same settings.',
      },
      { status: 410 },
    );
  }

  const datePart = (exportRow.completedAt ?? exportRow.createdAt)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const fileName = `mbumah-${filenameFragment(exportRow.exportType)}-${datePart}-${id.slice(0, 8)}.${ext}`;

  // Audit trail — never blocks the response.
  await systemLog({
    action: 'DATA_EXPORT_DOWNLOADED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Export ${exportRow.exportType}/${exportRow.format} (${exportRow.recordCount} records) downloaded from ${source}.`,
    storeId: exportRow.storeId,
    userId: session?.userId,
    metadata: { exportId: id, source, format: exportRow.format },
  }).catch(() => {});

  const body = Buffer.from(fileContent, 'utf8');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(downloadExportHandler, FINANCIAL_READ_ROLES),
  'DATA_EXPORT_DOWNLOAD',
);
