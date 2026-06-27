// GET /api/financial/accounts
// POST /api/financial/accounts — create a new account in the chart of accounts.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { createAccount } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

async function getAccountsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  let organizationId = searchParams.get('organizationId');
  const storeId = searchParams.get('storeId');

    if (!organizationId && storeId) {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { organizationId: true },
    });
    if (store) {
      organizationId = store.organizationId;
    }
  }

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

export const GET = withFinancialAuth(
  withErrorBoundary(getAccountsHandler, LogComponent.FINANCIAL),
  FINANCIAL_ROLES.READ,
);

// ── POST /api/financial/accounts ────────────────────────────────────────────
//
// Create a new account in the chart of accounts via `createAccount()`. The
// normalBalance defaults by type (DEBIT for ASSET/EXPENSE, CREDIT for others)
// but can be overridden for contra accounts (e.g. Accumulated Depreciation).

async function createAccountHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    organizationId,
    code,
    name,
    type,
    subType,
    normalBalance,
    description,
    isActive,
    createdByUserId,
  } = body as {
    organizationId?: string;
    code?: string;
    name?: string;
    type?: string;
    subType?: string;
    normalBalance?: string;
    description?: string;
    isActive?: boolean;
    createdByUserId?: string;
  };

  if (!organizationId) {
    return Response.json(
      { success: false, error: 'organizationId is required.' },
      { status: 400 },
    );
  }
  if (!code || !name || !type) {
    return Response.json(
      { success: false, error: 'code, name, and type are required.' },
      { status: 400 },
    );
  }
  if (!createdByUserId) {
    return Response.json(
      { success: false, error: 'createdByUserId is required for the audit trail.' },
      { status: 400 },
    );
  }

  try {
    const account = await createAccount({
      organizationId,
      code,
      name,
      type,
      subType,
      normalBalance,
      description,
      isActive,
      createdByUserId,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    return Response.json({ success: true, data: account }, { status: 201 });
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

export const POST = withFinancialAuth(
  withErrorBoundary(createAccountHandler, LogComponent.FINANCIAL),
  FINANCIAL_ROLES.WRITE,
);
