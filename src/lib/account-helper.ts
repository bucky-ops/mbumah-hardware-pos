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

// Default account names for auto-creation
const ACCOUNT_DEFAULTS: Record<string, { name: string; type: string; description: string }> = {
  '1000': { name: 'Cash on Hand', type: 'ASSET', description: 'Physical cash in drawer' },
  '1100': { name: 'M-Pesa Account', type: 'ASSET', description: 'M-Pesa mobile money account' },
  '1200': { name: 'Accounts Receivable', type: 'ASSET', description: 'Money owed by customers' },
  '1300': { name: 'Inventory', type: 'ASSET', description: 'Inventory asset' },
  '1400': { name: 'Rental Deposits Held', type: 'LIABILITY', description: 'Security deposits held for rentals' },
  '2000': { name: 'Accounts Payable', type: 'LIABILITY', description: 'Money owed to suppliers' },
  '2100': { name: 'VAT Payable', type: 'LIABILITY', description: 'VAT collected and owed to KRA' },
  '2200': { name: 'Customer Deposits', type: 'LIABILITY', description: 'Advance payments from customers' },
  '3000': { name: 'Owner Equity', type: 'EQUITY', description: 'Owner investment in the business' },
  '3100': { name: 'Retained Earnings', type: 'EQUITY', description: 'Accumulated profits' },
  '4000': { name: 'Sales Revenue', type: 'REVENUE', description: 'Revenue from product sales' },
  '4100': { name: 'Rental Revenue', type: 'REVENUE', description: 'Revenue from equipment rentals' },
  '4200': { name: 'Late Fee Revenue', type: 'REVENUE', description: 'Revenue from late return fees' },
  '5000': { name: 'Cost of Goods Sold', type: 'EXPENSE', description: 'Direct cost of products sold' },
  '5100': { name: 'Rent Expense', type: 'EXPENSE', description: 'Shop rent expense' },
  '5200': { name: 'Salaries Expense', type: 'EXPENSE', description: 'Employee salaries' },
  '5300': { name: 'Utilities Expense', type: 'EXPENSE', description: 'Electricity, water, internet' },
  '5400': { name: 'Bad Debt Expense', type: 'EXPENSE', description: 'Uncollectible customer debts' },
};

export async function getAccountId(organizationId: string, code: AccountCode): Promise<string> {
  const cacheKey = `${organizationId}:${code}`;

  if (accountCache.has(cacheKey)) {
    return accountCache.get(cacheKey)!;
  }

  let account = await db.account.findFirst({
    where: { organizationId, code },
    select: { id: true },
  });

  // Auto-create account if missing
  if (!account) {
    const defaults = ACCOUNT_DEFAULTS[code];
    if (defaults) {
      account = await db.account.create({
        data: {
          organizationId,
          code,
          name: defaults.name,
          type: defaults.type,
          description: defaults.description,
          isActive: true,
        },
        select: { id: true },
      });
    } else {
      throw new Error(`Account with code ${code} not found for organization ${organizationId}`);
    }
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

    const foundCodes = new Set(accounts.map(a => a.code));

    for (const account of accounts) {
      const cacheKey = `${organizationId}:${account.code}`;
      accountCache.set(cacheKey, account.id);
      const key = codeToKey.get(account.code) || account.code;
      result[key] = account.id;
    }

    // Auto-create any missing accounts
    const missingCodes = uncachedCodes.filter(code => !foundCodes.has(code));

    for (const code of missingCodes) {
      const defaults = ACCOUNT_DEFAULTS[code];
      if (defaults) {
        try {
          const newAccount = await db.account.create({
            data: {
              organizationId,
              code,
              name: defaults.name,
              type: defaults.type,
              description: defaults.description,
              isActive: true,
            },
            select: { id: true },
          });

          const cacheKey = `${organizationId}:${code}`;
          accountCache.set(cacheKey, newAccount.id);
          const key = codeToKey.get(code) || code;
          result[key] = newAccount.id;
        } catch {
          // Account may have been created by another request — try to find it
          const existing = await db.account.findFirst({
            where: { organizationId, code },
            select: { id: true },
          });
          if (existing) {
            const cacheKey = `${organizationId}:${code}`;
            accountCache.set(cacheKey, existing.id);
            const key = codeToKey.get(code) || code;
            result[key] = existing.id;
          }
        }
      }
    }
  }

  return result;
}

export { ACCOUNT_CODES };
