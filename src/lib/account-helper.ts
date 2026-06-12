// Account code lookup with caching

import { db } from '@/lib/db';

const ACCOUNT_CODES = {
  CASH_ON_HAND: '1000',
  MPESA_ACCOUNT: '1100',
  ACCOUNTS_RECEIVABLE: '1200',
  INVENTORY: '1300',
  RENTAL_DEPOSITS_HELD: '1400',
  ACCOUNTS_PAYABLE: '2000',
  VAT_PAYABLE: '2100',
  CUSTOMER_DEPOSITS: '2200',
  OWNER_EQUITY: '3000',
  RETAINED_EARNINGS: '3100',
  SALES_REVENUE: '4000',
  RENTAL_REVENUE: '4100',
  LATE_FEE_REVENUE: '4200',
  COST_OF_GOODS_SOLD: '5000',
  RENT_EXPENSE: '5100',
  SALARIES_EXPENSE: '5200',
  UTILITIES_EXPENSE: '5300',
  BAD_DEBT_EXPENSE: '5400',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

const accountCache = new Map<string, string>();

export async function getAccountId(organizationId: string, code: AccountCode): Promise<string> {
  const cacheKey = `${organizationId}:${code}`;

  if (accountCache.has(cacheKey)) {
    return accountCache.get(cacheKey)!;
  }

  const account = await db.account.findFirst({
    where: { organizationId, code },
    select: { id: true },
  });

  if (!account) {
    throw new Error(`Account with code ${code} not found for organization ${organizationId}`);
  }

  accountCache.set(cacheKey, account.id);
  return account.id;
}

export async function getAccountIds(
  organizationId: string,
  codes: AccountCode[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  const uncachedCodes: AccountCode[] = [];
  const codeToKey = new Map<string, string>();

  for (const code of codes) {
    const cacheKey = `${organizationId}:${code}`;
    const key = Object.entries(ACCOUNT_CODES).find(([, v]) => v === code)?.[0] || code;
    codeToKey.set(code, key);

    if (accountCache.has(cacheKey)) {
      result[key] = accountCache.get(cacheKey)!;
    } else {
      uncachedCodes.push(code);
    }
  }

  if (uncachedCodes.length > 0) {
    const accounts = await db.account.findMany({
      where: { organizationId, code: { in: uncachedCodes } },
      select: { id: true, code: true },
    });

    for (const account of accounts) {
      const cacheKey = `${organizationId}:${account.code}`;
      accountCache.set(cacheKey, account.id);
      const key = codeToKey.get(account.code) || account.code;
      result[key] = account.id;
    }
  }

  return result;
}

export { ACCOUNT_CODES };
