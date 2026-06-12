/**
 * MBUMAH HARDWARE - Chart of Accounts API
 * GET /api/financial/accounts - List chart of accounts with balances
 * Accepts both organizationId and storeId (derives organizationId from store)
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

async function getAccountsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  let organizationId = searchParams.get('organizationId');
  const storeId = searchParams.get('storeId');

  // If storeId is provided but not organizationId, derive it from the store
  if (!organizationId && storeId) {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { organizationId: true },
    });
    if (store) {
      organizationId = store.organizationId;
    }
  }

  // If still no organizationId, try to get the first organization (for demo/development)
  if (!organizationId) {
    const firstOrg = await db.organization.findFirst({
      select: { id: true },
    });
    if (firstOrg) {
      organizationId = firstOrg.id;
    }
  }

  if (!organizationId) {
    return Response.json(
      { success: false, error: 'organizationId or storeId is required.' },
      { status: 400 }
    );
  }

  const type = searchParams.get('type') || '';
  const isActive = searchParams.get('isActive');
  const includeBalances = searchParams.get('includeBalances') === 'true';

  const where: Record<string, unknown> = { organizationId };

  if (type) {
    where.type = type;
  }

  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  const accounts = await db.account.findMany({
    where,
    orderBy: { code: 'asc' },
    include: includeBalances
      ? {
          journalEntryLines: {
            select: {
              debit: true,
              credit: true,
              journalEntry: {
                select: { isPosted: true },
              },
            },
            where: {
              journalEntry: { isPosted: true },
            },
          },
        }
      : undefined,
  });

  const result = accounts.map((account) => {
    const { journalEntryLines, ...accountData } = account as typeof account & {
      journalEntryLines?: Array<{ debit: number; credit: number; journalEntry: { isPosted: boolean } }>;
    };

    let balance = 0;
    if (includeBalances && journalEntryLines) {
      const totalDebits = journalEntryLines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredits = journalEntryLines.reduce((sum, line) => sum + line.credit, 0);

      // Normal balance: Assets & Expenses are debit-normal, Liabilities, Equity, Revenue are credit-normal
      if (account.normalBalance === 'DEBIT') {
        balance = totalDebits - totalCredits;
      } else {
        balance = totalCredits - totalDebits;
      }
    }

    return {
      ...accountData,
      ...(includeBalances ? { balance: Math.round(balance * 100) / 100 } : {}),
    };
  });

  // Group accounts by type for summary
  const accountsByType = result.reduce(
    (acc, account) => {
      const accountType = account.type;
      if (!acc[accountType]) {
        acc[accountType] = [];
      }
      acc[accountType].push(account);
      return acc;
    },
    {} as Record<string, typeof result>
  );

  // Summary totals by account type
  const summary: Record<string, { count: number; totalBalance: number }> = {};
  for (const [accountType, accountsOfType] of Object.entries(accountsByType)) {
    summary[accountType] = {
      count: accountsOfType.length,
      totalBalance: accountsOfType.reduce((sum, a) => sum + ((a as typeof result[0] & { balance?: number }).balance || 0), 0),
    };
  }

  return Response.json({
    success: true,
    data: result,
    grouped: accountsByType,
    summary,
  });
}

export const GET = withErrorBoundary(getAccountsHandler, 'ACCOUNTS_LIST');
