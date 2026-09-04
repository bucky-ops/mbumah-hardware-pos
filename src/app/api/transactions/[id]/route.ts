// GET /api/transactions/[id]
//
// AUDIT FIX (6): this route previously had NO server-side auth guard —
// any caller that slipped past the proxy's Bearer-presence check could read
// ANY transaction, including the grossProfit / profitMargin analytics and
// the per-line costPrice (supplier cost). It is now wrapped in
// requireStoreAccess (DB-backed session validation + ORM-level tenant
// scoping — the same pattern as the transactions list route), and
// cost/profit data is stripped unless the caller's role is BRANCH_MANAGER
// or above (PERMISSION_MATRIX hierarchy in src/lib/types.ts).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import Decimal from 'decimal.js';
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Manager-or-above per PERMISSION_MATRIX (src/lib/types.ts): the roles that
// hold `financials: read`. CASHIER / ACCOUNTANT do not see margin or cost.
const PROFIT_VISIBLE_ROLES: readonly string[] = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

async function getTransactionDetailHandler(...args: unknown[]): Promise<Response> {
  // requireStoreAccess passes (request, session, ...nextArgs) — for a dynamic
  // route, args[2] is the original route context ({ params }).
  const _request = args[0] as NextRequest;
  const session = args[1] as AuthSession;
  const context = args[2] as RouteContext;
  const { id } = await context.params;

  const transaction = await db.salesTransaction.findUnique({
    where: { id },
    include: {
      cashier: { select: { id: true, name: true, email: true, role: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unitType: true,
              imageUrl: true,
              isRental: true,
            },
          },
        },
      },
      payments: true,
      debtLedgers: {
        include: {
          debtPayments: true,
        },
      },
      receipt: true,
    },
  });

  if (!transaction) {
    return Response.json(
      { success: false, error: 'Transaction not found.' },
      { status: 404 }
    );
  }

  // FINANCIAL MATH AUDIT — canonical profit chain (mirrors src/lib/profit.ts):
  //   netRevenue  = totalAmount − taxAmount   (VAT belongs to KRA, not the
  //               store; this identity holds for legacy VAT-exclusive rows
  //               AND current VAT-inclusive rows)
  //   COGS        = Σ(costPrice × quantity) — snapshot WAC at sale time
  //   grossProfit = netRevenue − COGS − totalDiscounts (line + cart).
  // The previous formula (`subtotal − cost`, pre-discount, VAT-mixed basis)
  // overstated profit by every shilling of discount and the VAT component.
  const totalCost = transaction.items.reduce(
    (sum: Decimal, item) => sum.plus(toDec(item.costPrice).mul(toDec(item.quantity))),
    new Decimal(0),
  ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const netRevenue = toDec(transaction.totalAmount).minus(toDec(transaction.taxAmount));
  const totalDiscounts = toDec(transaction.discountAmount);
  const grossProfit = round2(netRevenue.minus(totalCost).minus(totalDiscounts));
  const profitBase = round2(netRevenue.minus(totalDiscounts));
  const profitMargin = profitBase > 0 ? (grossProfit / profitBase) * 100 : 0;

  // AUDIT FIX (6): profit/cost fields are set to undefined (dropped from the
  // JSON payload) for non-manager roles. The per-item costPrice is the same
  // supplier-cost leak as the analytics block, so it is stripped too.
  const canViewProfit = PROFIT_VISIBLE_ROLES.includes(session.role);

  return Response.json({
    success: true,
    data: {
      ...transaction,
      items: canViewProfit
        ? transaction.items
        : transaction.items.map((item) => ({ ...item, costPrice: undefined })),
      analytics: {
        totalCost: canViewProfit ? totalCost.toNumber() : undefined,
        grossProfit: canViewProfit ? grossProfit : undefined,
        profitMargin: canViewProfit ? round2(profitMargin) : undefined,
        averageItemValue: transaction.items.length > 0
          ? round2(toDec(transaction.totalAmount).div(transaction.items.length))
          : 0,
      },
    },
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getTransactionDetailHandler) as (...args: unknown[]) => Promise<Response>,
  'TRANSACTION_DETAIL',
);
