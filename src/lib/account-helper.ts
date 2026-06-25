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
  GIFT_CARD_LIABILITY: '2300', // Unearned revenue — credited when a gift card is sold, debited when redeemed.
  OWNER_EQUITY: '3000',
  RETAINED_EARNINGS: '3100',
  SALES_REVENUE: '4000',
  RENTAL_REVENUE: '4100',
  LATE_FEE_REVENUE: '4200',
  SALES_DISCOUNTS: '4300', // Contra-revenue — debited when a discount is granted at checkout.
  COST_OF_GOODS_SOLD: '5000',
  RENT_EXPENSE: '5100',
  SALARIES_EXPENSE: '5200',
  UTILITIES_EXPENSE: '5300',
  BAD_DEBT_EXPENSE: '5400',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

const accountCache = new Map<string, string>();

// Default account definitions for auto-creation.
// The Account model has: name, type, subType, normalBalance, isActive —
// it does NOT have a `description` column, so we map the old description
// intent into subType + normalBalance (proper chart-of-accounts metadata).
const ACCOUNT_DEFAULTS: Record<string, {
  name: string;
  type: string;
  subType: string;
  normalBalance: string;
}> = {
  '1000': { name: 'Cash on Hand',           type: 'ASSET',     subType: 'CURRENT_ASSET',     normalBalance: 'DEBIT'  },
  '1100': { name: 'M-Pesa Account',          type: 'ASSET',     subType: 'CURRENT_ASSET',     normalBalance: 'DEBIT'  },
  '1200': { name: 'Accounts Receivable',     type: 'ASSET',     subType: 'CURRENT_ASSET',     normalBalance: 'DEBIT'  },
  '1300': { name: 'Inventory',               type: 'ASSET',     subType: 'CURRENT_ASSET',     normalBalance: 'DEBIT'  },
  '1400': { name: 'Rental Deposits Held',    type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  '2000': { name: 'Accounts Payable',        type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  '2100': { name: 'VAT Payable',             type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  '2200': { name: 'Customer Deposits',       type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  '2300': { name: 'Gift Card Liability',     type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  '3000': { name: 'Owner Equity',            type: 'EQUITY',    subType: 'OWNER_EQUITY',      normalBalance: 'CREDIT' },
  '3100': { name: 'Retained Earnings',       type: 'EQUITY',    subType: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },
  '4000': { name: 'Sales Revenue',           type: 'REVENUE',   subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
  '4100': { name: 'Rental Revenue',          type: 'REVENUE',   subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
  '4200': { name: 'Late Fee Revenue',        type: 'REVENUE',   subType: 'OTHER_REVENUE',     normalBalance: 'CREDIT' },
  '4300': { name: 'Sales Discounts',         type: 'EXPENSE',   subType: 'CONTRA_REVENUE',    normalBalance: 'DEBIT'  },
  '5000': { name: 'Cost of Goods Sold',      type: 'EXPENSE',   subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT'  },
  '5100': { name: 'Rent Expense',            type: 'EXPENSE',   subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT'  },
  '5200': { name: 'Salaries Expense',        type: 'EXPENSE',   subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT'  },
  '5300': { name: 'Utilities Expense',       type: 'EXPENSE',   subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT'  },
  '5400': { name: 'Bad Debt Expense',        type: 'EXPENSE',   subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT'  },
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
          subType: defaults.subType,
          normalBalance: defaults.normalBalance,
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
              subType: defaults.subType,
              normalBalance: defaults.normalBalance,
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

// ─────────────────────────────────────────────────────────────────────────
// Double-entry journal helpers (Task 4)
// ─────────────────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client';
import { generateJournalEntryNumber } from '@/lib/helpers';

export interface SaleAccountingParams {
  storeId: string;
  organizationId: string;
  cashierId: string;
  receiptNumber: string;
  transactionId: string;
  grossRevenue: number; // subtotal − line discounts − cart-level discount
  taxAmount: number;
  discountAmount: number; // cart-level discount (discount code / manual)
  paymentBreakdown: {
    cash?: number;
    mpesa?: number;
    giftCard?: number;
    credit?: number;
  };
  cogsAmount?: number;
  postImmediately?: boolean; // false for MPESA (pending confirmation)
}

/**
 * Records the double-entry journal lines for a POS sale.
 * Credits Sales Revenue (4000) + VAT Payable (2100).
 * Debits Cash (1000), M-Pesa (1100), A/R (1200), Gift Card Liability (2300),
 * and Sales Discounts (4300 — contra-revenue).
 * COGS: Debit COGS (5000), Credit Inventory (1300).
 * Throws if total debits ≠ total credits (golden rule).
 */
export async function recordSaleJournalEntry(
  tx: Prisma.TransactionClient,
  params: SaleAccountingParams,
): Promise<void> {
  const {
    storeId,
    organizationId,
    cashierId,
    receiptNumber,
    transactionId,
    grossRevenue,
    taxAmount,
    discountAmount,
    paymentBreakdown,
    cogsAmount = 0,
    postImmediately = true,
  } = params;

  const needed = [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.MPESA_ACCOUNT,
    ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ACCOUNT_CODES.GIFT_CARD_LIABILITY,
    ACCOUNT_CODES.SALES_REVENUE,
    ACCOUNT_CODES.VAT_PAYABLE,
    ACCOUNT_CODES.SALES_DISCOUNTS,
    ACCOUNT_CODES.COST_OF_GOODS_SOLD,
    ACCOUNT_CODES.INVENTORY,
  ];
  const accounts = await getAccountIds(organizationId, needed);

  const jeNumber = generateJournalEntryNumber();
  const lines: Prisma.JournalEntryLineCreateManyJournalEntryInput[] = [];

  // ── Credits: revenue + tax ──
  if (grossRevenue > 0) {
    lines.push({
      accountId: accounts.SALES_REVENUE,
      debit: 0,
      credit: grossRevenue,
      description: `Sales revenue for ${receiptNumber}`,
    });
  }
  if (taxAmount > 0) {
    lines.push({
      accountId: accounts.VAT_PAYABLE,
      debit: 0,
      credit: taxAmount,
      description: `VAT collected on ${receiptNumber}`,
    });
  }

  // ── Debits: payments received + receivables + discounts ──
  if (paymentBreakdown.cash && paymentBreakdown.cash > 0) {
    lines.push({
      accountId: accounts.CASH_ON_HAND,
      debit: paymentBreakdown.cash,
      credit: 0,
      description: `Cash received for ${receiptNumber}`,
    });
  }
  if (paymentBreakdown.mpesa && paymentBreakdown.mpesa > 0) {
    lines.push({
      accountId: accounts.MPESA_ACCOUNT,
      debit: paymentBreakdown.mpesa,
      credit: 0,
      description: `M-Pesa received for ${receiptNumber}`,
    });
  }
  if (paymentBreakdown.giftCard && paymentBreakdown.giftCard > 0) {
    lines.push({
      accountId: accounts.GIFT_CARD_LIABILITY,
      debit: paymentBreakdown.giftCard,
      credit: 0,
      description: `Gift card redeemed for ${receiptNumber}`,
    });
  }
  if (paymentBreakdown.credit && paymentBreakdown.credit > 0) {
    lines.push({
      accountId: accounts.ACCOUNTS_RECEIVABLE,
      debit: paymentBreakdown.credit,
      credit: 0,
      description: `Accounts receivable for ${receiptNumber}`,
    });
  }
  if (discountAmount > 0) {
    lines.push({
      accountId: accounts.SALES_DISCOUNTS,
      debit: discountAmount,
      credit: 0,
      description: `Discount allowed on ${receiptNumber}`,
    });
  }

  // ── COGS ──
  if (cogsAmount > 0) {
    lines.push({
      accountId: accounts.COST_OF_GOODS_SOLD,
      debit: cogsAmount,
      credit: 0,
      description: `COGS for ${receiptNumber}`,
    });
    lines.push({
      accountId: accounts.INVENTORY,
      debit: 0,
      credit: cogsAmount,
      description: `Inventory reduction for ${receiptNumber}`,
    });
  }

  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Journal entry unbalanced for ${receiptNumber}: debits=${totalDebits.toFixed(2)} credits=${totalCredits.toFixed(2)}`,
    );
  }

  await tx.journalEntry.create({
    data: {
      storeId,
      entryNumber: jeNumber,
      description: `Sale ${receiptNumber}`,
      referenceType: 'SALE',
      referenceId: transactionId,
      totalDebit: totalDebits,
      totalCredit: totalCredits,
      isPosted: postImmediately,
      postedAt: postImmediately ? new Date() : null,
      createdBy: cashierId,
      lines: { createMany: { data: lines } },
    },
  });
}

/**
 * Records the ISSUANCE of a gift card (selling it to a customer).
 * Debits Cash/M-Pesa, Credits Gift Card Liability (unearned revenue).
 */
export async function recordGiftCardIssuance(
  tx: Prisma.TransactionClient,
  params: {
    storeId: string;
    organizationId: string;
    cashierId: string;
    giftCardId: string;
    giftCardCode: string;
    amount: number;
    paymentMethod: 'CASH' | 'MPESA';
  },
): Promise<void> {
  const { storeId, organizationId, cashierId, giftCardId, giftCardCode, amount, paymentMethod } = params;
  const accounts = await getAccountIds(organizationId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.MPESA_ACCOUNT,
    ACCOUNT_CODES.GIFT_CARD_LIABILITY,
  ]);
  const debitAccount = paymentMethod === 'CASH' ? accounts.CASH_ON_HAND : accounts.MPESA_ACCOUNT;
  const jeNumber = generateJournalEntryNumber();

  await tx.journalEntry.create({
    data: {
      storeId,
      entryNumber: jeNumber,
      description: `Gift card issued ${giftCardCode}`,
      referenceType: 'GIFT_CARD',
      referenceId: giftCardId,
      totalDebit: amount,
      totalCredit: amount,
      isPosted: true,
      postedAt: new Date(),
      createdBy: cashierId,
      lines: {
        createMany: {
          data: [
            {
              accountId: debitAccount,
              debit: amount,
              credit: 0,
              description: `${paymentMethod} received for gift card ${giftCardCode}`,
            },
            {
              accountId: accounts.GIFT_CARD_LIABILITY,
              debit: 0,
              credit: amount,
              description: `Unearned revenue for gift card ${giftCardCode}`,
            },
          ],
        },
      },
    },
  });
}
