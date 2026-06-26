// GET/POST /api/financial/journal

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';

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
            account: { select: { id: true, code: true, name: true, type: true } },
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

  return Response.json({
    success: true,
    data: entries,
    summary: {
      postedEntries: summary._count,
      totalDebits: summary._sum.totalDebit || 0,
      totalCredits: summary._sum.totalCredit || 0,
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

export const GET = withErrorBoundary(getJournalEntriesHandler, 'JOURNAL_LIST');
export const POST = withErrorBoundary(createJournalEntryHandler, 'JOURNAL_CREATE');
