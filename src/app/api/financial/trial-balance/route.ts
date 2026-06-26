// GET /api/financial/trial-balance
//
// Generates a trial balance as of a given date. Sums all non-voided
// JournalEntryLine rows grouped by account and verifies that total debits
// equal total credits.
//
// Query params:
//   storeId   — scope to a single store (SUPER_ADMIN only). Omit for org-wide.
//   asOfDate  — ISO date (default: now)

import { type NextRequest } from 'next/server';
import { generateTrialBalance } from '@/lib/financial-audit';
import { runWithoutTenant, runWithTenant } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function handler(...args: unknown[]): Promise<Response> {
  const req = args[0] as NextRequest;
  const { searchParams } = new URL(req.url);

  const storeId = searchParams.get('storeId') || undefined;
  const asOfDateParam = searchParams.get('asOfDate');
  const asOfDate = asOfDateParam ? new Date(asOfDateParam) : new Date();

  if (asOfDateParam && isNaN(asOfDate.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid asOfDate. Use ISO 8601 format.' },
      { status: 400 },
    );
  }

  const trialFn = () => generateTrialBalance(storeId, asOfDate);

  const result = storeId
    ? await runWithTenant(storeId, trialFn)
    : await runWithoutTenant(trialFn);

  return Response.json({
    success: true,
    data: {
      asOfDate: result.asOfDate,
      storeId: result.storeId,
      totalDebits: result.totalDebits.toNumber(),
      totalCredits: result.totalCredits.toNumber(),
      totalDebitsFormatted: result.totalDebits.formatKES(),
      totalCreditsFormatted: result.totalCredits.formatKES(),
      isBalanced: result.isBalanced,
      variance: result.variance.toNumber(),
      varianceFormatted: result.variance.formatKES(),
      accounts: result.accounts.map((acct) => ({
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        accountType: acct.accountType,
        totalDebit: acct.totalDebit.toNumber(),
        totalDebitFormatted: acct.totalDebit.formatKES(),
        totalCredit: acct.totalCredit.toNumber(),
        totalCreditFormatted: acct.totalCredit.formatKES(),
        netBalance: acct.netBalance.toNumber(),
        netBalanceFormatted: acct.netBalance.formatKES(),
        lineCount: acct.lineCount,
      })),
    },
  });
}

export const GET = withErrorBoundary(handler, LogComponent.FINANCIAL);
