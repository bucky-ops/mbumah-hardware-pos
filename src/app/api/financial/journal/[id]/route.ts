// PUT /api/financial/journal/[id] - Void a journal entry

import { db, withImmutabilityBypass } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { voidJournalEntry } from '@/lib/accounting-helpers';
import { getSessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function voidJournalEntryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

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

  // F7-3 remediation: the API void now DELEGATES to voidJournalEntry() —
  // the audited helper that posts a balanced REVERSING entry, requires a
  // meaningful reason, and writes an AuditLog row inside the same
  // transaction. The previous inline UPDATE-void had no reversal, no reason,
  // and no audit record (divergent semantics from the helper's contract).
  const session = await getSessionFromRequest(request);
  const voidReason = String(body?.reason || '').trim();
  if (voidReason.length < 3) {
    return Response.json(
      { success: false, error: 'A void reason (at least 3 characters) is required for the audit trail.' },
      { status: 400 }
    );
  }
  const { voidedEntry: entry, reversingEntry } = await voidJournalEntry(
    id,
    session?.userId || 'system',
    voidReason,
    {
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    }
  );

  if (existing.referenceType === 'EXPENSE' && existing.referenceId) {
    // Keep the source document in sync with the ledger (sanctioned bypass).
    await withImmutabilityBypass(() =>
      db.expense.updateMany({
        where: { id: existing.referenceId, journalEntryId: id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
        },
      }),
      'journal_entry_void_expense_sync',
    );
  }
  void reversingEntry;

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

export const PUT = withErrorBoundary(
  withFinancialAuth(voidJournalEntryHandler, FINANCIAL_ROLES.WRITE),
  'JOURNAL_ENTRY_VOID',
);
