// GET /api/financial/accounts
// POST /api/financial/accounts — create a new account in the chart of accounts.

import { type NextRequest } from 'next/server';
import type Decimal from 'decimal.js';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { createAccount } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';
// Task 12-b: Prisma Decimal valueOf() returns a STRING — `sum + line.debit`
// STRING-CONCATENATED. Balances accumulate via toDec() and emit 2dp HALF_UP.
import { toDec, round2 } from '@/lib/utils/financialMath';

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
      journalEntryLines?: Array<{ debit: Decimal; credit: Decimal; journalEntry: { isPosted: boolean } }>;
    };

    let balance = toDec(0);
    if (includeBalances && journalEntryLines) {
      // Task 12-b: Decimal-safe debit/credit sums (was `0 + Decimal` concat).
      const totalDebits = journalEntryLines.reduce((acc, line) => acc.plus(toDec(line.debit)), toDec(0));
      const totalCredits = journalEntryLines.reduce((acc, line) => acc.plus(toDec(line.credit)), toDec(0));

      // Normal balance: Assets & Expenses are debit-normal, Liabilities, Equity, Revenue are credit-normal
      balance = account.normalBalance === 'DEBIT'
        ? totalDebits.minus(totalCredits)
        : totalCredits.minus(totalDebits);
    }

    return {
      ...accountData,
      ...(includeBalances ? { balance: round2(balance) } : {}),
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
      // Task 12-b: Decimal-safe total (was float sum of 2dp values).
      totalBalance: round2(
        accountsOfType.reduce(
          (acc, a) => acc.plus(toDec((a as typeof result[0] & { balance?: number }).balance)),
          toDec(0),
        ),
      ),
    };
  }

  return Response.json({
    success: true,
    data: result,
    grouped: accountsByType,
    summary,
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getAccountsHandler, FINANCIAL_ROLES.READ),
  LogComponent.FINANCIAL,
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

export const POST = withErrorBoundary(
  withFinancialAuth(createAccountHandler, FINANCIAL_ROLES.WRITE),
  LogComponent.FINANCIAL,
);
