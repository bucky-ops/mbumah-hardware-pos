// PUT /api/financial/journal/[id] - Void a journal entry

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function voidJournalEntryHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.journalEntry.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Journal entry not found.' },
      { status: 404 }
    );
  }

  if (existing.isVoided) {
    return Response.json(
      { success: false, error: 'Journal entry is already voided.' },
      { status: 400 }
    );
  }

  const entry = await db.journalEntry.update({
    where: { id },
    data: {
      isVoided: true,
      voidedAt: new Date(),
    },
    include: {
      lines: {
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
        },
      },
    },
  });

  if (existing.referenceType === 'EXPENSE' && existing.referenceId) {
    await db.expense.updateMany({
      where: { id: existing.referenceId, journalEntryId: id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
      },
    });
  }

  await systemLog({
    action: 'JOURNAL_ENTRY_VOIDED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Journal entry ${existing.entryNumber} voided`,
    storeId: existing.storeId,
    metadata: {
      journalEntryId: id,
      entryNumber: existing.entryNumber,
      referenceType: existing.referenceType,
      referenceId: existing.referenceId,
    },
  });

  return Response.json({
    success: true,
    message: 'Journal entry voided successfully.',
    data: entry,
  });
}

export const PUT = withErrorBoundary(voidJournalEntryHandler, 'JOURNAL_ENTRY_VOID');
