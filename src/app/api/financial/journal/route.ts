// GET/POST /api/financial/journal

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getJournalEntriesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const referenceType = searchParams.get('referenceType') || '';
  const isPosted = searchParams.get('isPosted');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const sortBy = searchParams.get('sortBy') || 'entryDate';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (referenceType) {
    where.referenceType = referenceType;
  }

  if (isPosted !== null && isPosted !== undefined && isPosted !== '') {
    where.isPosted = isPosted === 'true';
  }

  if (dateFrom || dateTo) {
    const entryDate: Record<string, Date> = {};
    if (dateFrom) entryDate.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      entryDate.lte = to;
    }
    where.entryDate = entryDate;
  }

  const validSortFields = ['entryDate', 'entryNumber', 'totalDebit', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'entryDate';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      where,
      include: {
        lines: {
          include: {
            // subType is REQUIRED by the frontend P&L breakdown (Sales vs
            // Rental vs Late Fee vs COGS). It was missing here, so every
            // subType-based filter client-side matched nothing and all revenue
            // landed in "Other Revenue" while COGS showed 0.
            account: { select: { id: true, code: true, name: true, type: true, subType: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.journalEntry.count({ where }),
  ]);

    const summary = await db.journalEntry.aggregate({
    where: { ...where, isPosted: true },
    _sum: { totalDebit: true, totalCredit: true },
    _count: true,
  });

  // DECIMAL SERIALIZATION GUARD (financial audit — P&L 3.8e+89 incident):
  // Prisma Decimal fields pass through Response.json as STRINGS (decimal.js
  // toJSON). Client-side aggregations then string-concatenate instead of
  // adding ("0" + "3800" → "03800", then "03800" + "120" → "03800120"…),
  // which produced astronomically wrong figures (Ksh 3.8e+89 "Net Loss").
  // Convert EVERY monetary field to a JS number so the documented api.ts
  // contract (debit: number; totalDebit: number) actually holds at runtime.
  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return Response.json({
    success: true,
    data: entries.map((entry) => ({
      ...entry,
      totalDebit: toNum(entry.totalDebit),
      totalCredit: toNum(entry.totalCredit),
      lines: entry.lines.map((line) => ({
        ...line,
        debit: toNum(line.debit),
        credit: toNum(line.credit),
        taxRateApplied: line.taxRateApplied === null ? null : toNum(line.taxRateApplied),
        taxAmount: line.taxAmount === null ? null : toNum(line.taxAmount),
      })),
    })),
    summary: {
      postedEntries: summary._count,
      totalDebits: toNum(summary._sum.totalDebit),
      totalCredits: toNum(summary._sum.totalCredit),
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createJournalEntryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    description,
    referenceType,
    referenceId,
    lines,
    isPosted,
    createdBy,
  } = body;

  if (!storeId || !description || !lines || !Array.isArray(lines) || lines.length < 2) {
    return Response.json(
      { success: false, error: 'storeId, description, and at least 2 journal lines are required.' },
      { status: 400 }
    );
  }

    const totalDebit = lines.reduce((sum: number, line: { debit: number; credit: number }) => sum + (parseFloat(String(line.debit || 0))), 0);
  const totalCredit = lines.reduce((sum: number, line: { debit: number; credit: number }) => sum + (parseFloat(String(line.credit || 0))), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return Response.json(
      {
        success: false,
        error: `Journal entry must balance. Total debit: ${totalDebit}, Total credit: ${totalCredit}, Difference: ${Math.abs(totalDebit - totalCredit)}`,
      },
      { status: 400 }
    );
  }

    const accountIds = lines.map((line: { accountId: string }) => line.accountId);
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds } },
  });

  if (accounts.length !== accountIds.length) {
    const foundIds = accounts.map((a) => a.id);
    const missingIds = accountIds.filter((id: string) => !foundIds.includes(id));
    return Response.json(
      { success: false, error: `Accounts not found: ${missingIds.join(', ')}` },
      { status: 400 }
    );
  }

  const entryNumber = generateJournalEntryNumber();
  const shouldPost = isPosted !== false;

  const entry = await db.journalEntry.create({
    data: {
      storeId,
      entryNumber,
      description,
      referenceType: referenceType || 'MANUAL',
      referenceId: referenceId || null,
      totalDebit,
      totalCredit,
      isPosted: shouldPost,
      postedAt: shouldPost ? new Date() : null,
      createdBy: createdBy || null,
      lines: {
        create: lines.map((line: { accountId: string; debit: number; credit: number; description?: string }) => ({
          accountId: line.accountId,
          debit: parseFloat(String(line.debit || 0)),
          credit: parseFloat(String(line.credit || 0)),
          description: line.description || null,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
        },
      },
    },
  });

  await systemLog({
    action: 'JOURNAL_ENTRY_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Journal entry ${entryNumber} created: ${description}`,
    storeId,
    userId: createdBy || undefined,
    metadata: {
      entryId: entry.id,
      entryNumber,
      totalDebit,
      totalCredit,
      lineCount: lines.length,
      isPosted: shouldPost,
    },
  });

  return Response.json({ success: true, data: entry }, { status: 201 });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getJournalEntriesHandler, FINANCIAL_ROLES.READ),
  'JOURNAL_LIST',
);
export const POST = withErrorBoundary(
  withFinancialAuth(createJournalEntryHandler, FINANCIAL_ROLES.WRITE),
  'JOURNAL_CREATE',
);
