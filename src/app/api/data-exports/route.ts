// GET/POST /api/data-exports
//
// Data Export Dashboard — list past exports and create new ones.
//
// Auth pattern mirrors /api/debt-payment-plans:
//   `withErrorBoundary(withFinancialAuth(handler, ROLES), COMPONENT)`
//
// POST flow:
//   1. Create a DataExport row with status=PROCESSING
//   2. Call the appropriate generator from `src/lib/data-export-utils.ts`
//   3. Write the file to `/home/z/my-project/download/exports/{id}.{ext}`
//   4. Update the row: status=COMPLETED, recordCount, fileSizeBytes,
//      filePath, completedAt, expiresAt (now + 7 days)
//   5. Return the updated row
//   6. On error: update status=FAILED with errorMessage, return 500.

import { type NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  runExportGenerator,
  parseExportFilters,
  csvToJson,
  type ExportType,
  type ExportFormat,
} from '@/lib/data-export-utils';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

const EXPORTS_DIR = '/home/z/my-project/download/exports';
const EXPIRY_DAYS = 7;

const VALID_EXPORT_TYPES: ExportType[] = [
  'PRODUCTS',
  'CUSTOMERS',
  'TRANSACTIONS',
  'DEBT',
  'INVENTORY',
  'EMPLOYEES',
  'SUPPLIERS',
  'LOYALTY',
  'TAX',
  'SALES_SUMMARY',
];

const VALID_FORMATS: ExportFormat[] = ['CSV', 'JSON'];

// ── GET: list exports ────────────────────────────────────────────────────────

async function listExportsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const status = searchParams.get('status') || '';
  const exportType = searchParams.get('exportType') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);

  const where: Record<string, unknown> = { storeId };
  if (status) where.status = status;
  if (exportType) where.exportType = exportType;

  const exports = await db.dataExport.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return Response.json({ success: true, data: exports });
}

// ── POST: create + synchronously process an export ─────────────────────────

async function createExportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json().catch(() => ({}));

  const { storeId, exportType, format, dateFrom, dateTo, filters } = body ?? {};

  if (!storeId || !exportType || !format) {
    return Response.json(
      {
        success: false,
        error: 'storeId, exportType, and format are required.',
      },
      { status: 400 },
    );
  }

  if (!VALID_EXPORT_TYPES.includes(exportType as ExportType)) {
    return Response.json(
      {
        success: false,
        error: `Unsupported exportType "${exportType}". Allowed: ${VALID_EXPORT_TYPES.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  if (!VALID_FORMATS.includes(format as ExportFormat)) {
    return Response.json(
      {
        success: false,
        error: `Unsupported format "${format}". Allowed: ${VALID_FORMATS.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  // Parse dates (optional).
  let parsedDateFrom: Date | null = null;
  let parsedDateTo: Date | null = null;
  if (dateFrom) {
    parsedDateFrom = new Date(dateFrom);
    if (Number.isNaN(parsedDateFrom.getTime())) {
      return Response.json(
        { success: false, error: 'dateFrom is not a valid date.' },
        { status: 400 },
      );
    }
  }
  if (dateTo) {
    // Include the entire end day — set to end of day.
    parsedDateTo = new Date(dateTo);
    if (Number.isNaN(parsedDateTo.getTime())) {
      return Response.json(
        { success: false, error: 'dateTo is not a valid date.' },
        { status: 400 },
      );
    }
    parsedDateTo.setUTCHours(23, 59, 59, 999);
  }

  // Filters can be an object or a JSON string — normalise to a JSON string for
  // storage, and to a typed object for the generators.
  let filtersObj: Record<string, unknown> = {};
  if (filters) {
    if (typeof filters === 'string') {
      try {
        filtersObj = JSON.parse(filters);
      } catch {
        return Response.json(
          { success: false, error: 'filters is not valid JSON.' },
          { status: 400 },
        );
      }
    } else if (typeof filters === 'object') {
      filtersObj = filters as Record<string, unknown>;
    }
  }
  const filtersJson = JSON.stringify(filtersObj);

  const session = await getSessionFromRequest(request);
  const createdById = session?.userId;
  if (!createdById) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  // 1. Create the row as PROCESSING.
  const exportRow = await db.dataExport.create({
    data: {
      storeId,
      createdById,
      exportType: exportType as ExportType,
      format: format as ExportFormat,
      filters: filtersJson,
      dateFrom: parsedDateFrom,
      dateTo: parsedDateTo,
      status: 'PROCESSING',
    },
  });

  try {
    // 2. Run the generator.
    const parsedFilters = parseExportFilters(filtersJson);
    const result = await runExportGenerator(
      storeId,
      exportType,
      parsedFilters,
      parsedDateFrom,
      parsedDateTo,
    );

    // 3. Build the file content (CSV or JSON-wrapped CSV).
    const fileContent = format === 'JSON' ? csvToJson(result.csv) : result.csv;
    const ext = format === 'JSON' ? 'json' : 'csv';

    // Ensure the exports directory exists.
    await fs.mkdir(EXPORTS_DIR, { recursive: true });

    const fileName = `${exportRow.id}.${ext}`;
    const filePath = path.join(EXPORTS_DIR, fileName);

    await fs.writeFile(filePath, fileContent, 'utf8');
    const stat = await fs.stat(filePath);

    // 4. Update the row as COMPLETED.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const updated = await db.dataExport.update({
      where: { id: exportRow.id },
      data: {
        status: 'COMPLETED',
        recordCount: result.recordCount,
        fileSizeBytes: stat.size,
        filePath: fileName,
        completedAt: now,
        expiresAt,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await systemLog({
      action: 'DATA_EXPORT_CREATED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.INFO,
      message: `Data export "${exportType}" (${format}) generated — ${result.recordCount} records, ${stat.size} bytes.`,
      storeId,
      userId: createdById,
      metadata: {
        exportId: exportRow.id,
        exportType,
        format,
        recordCount: result.recordCount,
        fileSizeBytes: stat.size,
        dateFrom: parsedDateFrom?.toISOString() ?? null,
        dateTo: parsedDateTo?.toISOString() ?? null,
      },
    });

    return Response.json({ success: true, data: updated }, { status: 201 });
  } catch (err) {
    // 6. Mark as FAILED and surface the error.
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error during export generation.';

    const failed = await db.dataExport.update({
      where: { id: exportRow.id },
      data: {
        status: 'FAILED',
        errorMessage: errorMessage.slice(0, 1000),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await systemLog({
      action: 'DATA_EXPORT_FAILED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.ERROR,
      message: `Data export "${exportType}" failed: ${errorMessage}`,
      storeId,
      userId: createdById,
      metadata: {
        exportId: exportRow.id,
        exportType,
        format,
        error: errorMessage,
      },
    });

    return Response.json(
      {
        success: false,
        error: `Export generation failed: ${errorMessage}`,
        data: failed,
      },
      { status: 500 },
    );
  }
}

export const GET = withErrorBoundary(
  withFinancialAuth(listExportsHandler, FINANCIAL_READ_ROLES),
  'DATA_EXPORTS_LIST',
);

export const POST = withErrorBoundary(
  withFinancialAuth(createExportHandler, FINANCIAL_WRITE_ROLES),
  'DATA_EXPORT_CREATE',
);
