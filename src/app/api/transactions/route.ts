// GET/POST /api/transactions
//
// POST (checkout) is the financial heart of the POS. It runs a single
// `db.$transaction` that atomically:
//   1. Creates the SalesTransaction + SaleItem rows.
//   2. Records Payment row(s) (single or SPLIT).
//   3. Deducts stock + writes StockMovement rows — with an in-tx re-check
//      that refuses to let any product go negative (ISO 9001 integrity).
//   4. Records payment-method side effects:
//        CASH      → CashDrawerLog entry
//        MPESA     → MpesaTransaction (PENDING)
//        DEBT      → DebtLedger entry + customer balance increment
//        GIFT_CARD → GiftCard balance decrement + GiftCardRedemption row
//   5. Writes ONE balanced double-entry JournalEntry via
//      `recordSaleJournalEntry` — credits Sales Revenue + VAT Payable,
//      debits the relevant payment asset / receivable / gift-card
//      liability, debits Sales Discounts (contra-revenue) for cart-level
//      discounts, and records COGS. Throws if debits ≠ credits.
//   6. Creates the Receipt row.
//
// If ANY step throws, the entire transaction rolls back — no partial
// sales, no orphaned stock movements, no unbalanced journal entries.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary, sanitizeForLog } from '@/lib/logger';
import { generateReceiptNumber, calculateLineTotal } from '@/lib/helpers';
import { recordSaleJournalEntry, getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, PaymentMethod, PaymentStatus } from '@/lib/types';
import { checkoutSchema, validateInput } from '@/lib/validations';
import { calculateEarnedPoints, getTierFromPoints } from '@/lib/loyalty-utils';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import { KES } from '@/lib/money';
import { enqueueOutbox } from '@/lib/outbox';
import { withSequenceRetry, isP2002 } from '@/lib/sequence';

export const dynamic = 'force-dynamic';

// AUDIT FIX (2): typed credit-limit failure. Thrown from INSIDE the checkout
// transaction when the conditional credit-limit write claims 0 rows (i.e. a
// concurrent sale consumed the customer's remaining headroom). It is caught
// in the handler and surfaced as the same 400 the friendly pre-check returns,
// so the POS treats a race-loser identically to a known-over-limit customer.
class CreditLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditLimitExceededError';
  }
}

// Typed client-input failure: a payload field that passed Zod's coercion but
// cannot be applied to the loaded Product rows (NaN price/qty/tax/cost).
// These used to escape as raw `throw new Error` → HTTP 500; they are client
// errors and MUST be 400s. Caught in createTransactionHandler below.
class CheckoutInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutInputError';
  }
}

async function getTransactionsHandler(
  request: NextRequest,
  _session: AuthSession,
  ..._args: unknown[]
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const search = searchParams.get('search') || '';
  const paymentMethod = searchParams.get('paymentMethod') || '';
  const paymentStatus = searchParams.get('paymentStatus') || '';
  const transactionType = searchParams.get('transactionType') || '';
  const cashierId = searchParams.get('cashierId') || '';
  const customerId = searchParams.get('customerId') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (search) {
    where.OR = [
      { receiptNumber: { contains: search } },
      { notes: { contains: search } },
    ];
  }

  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }

  if (paymentStatus) {
    where.paymentStatus = paymentStatus;
  }

  if (transactionType) {
    where.transactionType = transactionType;
  }

  if (cashierId) {
    where.cashierId = cashierId;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const validSortFields = ['createdAt', 'totalAmount', 'receiptNumber', 'paymentStatus'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [transactions, total] = await Promise.all([
    db.salesTransaction.findMany({
      where,
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        payments: true,
        _count: { select: { items: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.salesTransaction.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// ═════════════════════════════════════════════════════════════════════
// POST /api/transactions — error-containment wrapper.
//
// ROOT-CAUSE RUNBOOK (checkout 500 incident, 2026-09):
// A production 500 with body {"error":"An unexpected error occurred. Please
// try again."} was completely undiagnosable: no payload on stdout, no detail
// in the response. The actual cause was Prisma P2022 — the deployed Neon
// database was missing the `idempotencyKey` column added by the financial
// remediation because the Vercel build never synced the schema (fixed by
// scripts/sync-db-schema.mjs, wired into `npm run vercel-build`).
//
// This wrapper guarantees that can never be invisible again:
//   1. Malformed JSON → 400 (previously an unhandled throw → 500).
//   2. ANY unhandled error from the checkout flow is logged to stdout as
//      [TRANSACTION-API-ERROR] with the error, its stack, and a PII-redacted,
//      size-capped copy of the request payload — Vercel Runtime Logs captures
//      console.error, so production failures are triageable from the logs.
//   3. CheckoutInputError (bad item field values) → clean 400.
//   4. Everything else rethrows to withErrorBoundary, which emits the
//      [API-ERROR] stdout breadcrumb and a sanitized 500 carrying the
//      non-sensitive {name, code, component} diagnostic pair.
// ═════════════════════════════════════════════════════════════════════
async function createTransactionHandler(
  request: NextRequest,
  session: AuthSession,
  ..._args: unknown[]
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  try {
    return await createTransactionInner(request, session, body);
  } catch (err) {
    console.error('[TRANSACTION-API-ERROR]', {
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
      payload: sanitizeForLog(body),
    });

    if (err instanceof CheckoutInputError) {
      return Response.json({ success: false, error: err.message }, { status: 400 });
    }
    throw err;
  }
}

async function createTransactionInner(
  request: NextRequest,
  session: AuthSession,
  body: unknown,
): Promise<Response> {
  // ── SYS-10: idempotent checkout replay ──────────────────────────────────
  // The offline queue (src/lib/offline-sync.ts) re-POSTs sales whose response
  // was lost. A client-generated idempotencyKey makes that replay safe: the
  // original committed transaction is returned instead of re-applying stock,
  // payments and journals.
  // `body` arrives typed `unknown` from the error-containment wrapper —
  // narrow through a Record cast before touching the optional key.
  const rawBody = (body ?? {}) as Record<string, unknown>;
  const rawIdempotencyKey = rawBody.idempotencyKey;
  const idempotencyKey =
    typeof rawIdempotencyKey === 'string' && rawIdempotencyKey.trim().length >= 8
      ? rawIdempotencyKey.trim()
      : undefined;
  if (idempotencyKey) {
    const existing = await db.salesTransaction.findUnique({
      where: { idempotencyKey },
      include: {
        items: true,
        payments: true,
        receipt: true,
      },
    });
    if (existing) {
      return Response.json(
        { success: true, data: existing, idempotentReplay: true },
        { status: 200 }
      );
    }
  }

  const validation = validateInput(checkoutSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const {
    storeId,
    customerId,
    items,
    paymentMethod,
    paymentDetails,
    discountAmount,
    notes,
    serials,
  } = validation.data;

  // SYS-2 (F5-1): the cashier identity ALWAYS comes from the authenticated
  // session — the request body can no longer attribute a sale to another user.
  const cashierId = session.userId;

  if (!Object.values(PaymentMethod).includes(paymentMethod)) {
    return Response.json(
      { success: false, error: `Invalid payment method. Must be one of: ${Object.values(PaymentMethod).join(', ')}` },
      { status: 400 }
    );
  }

  if (paymentMethod === PaymentMethod.DEBT && !customerId) {
    return Response.json(
      { success: false, error: 'Customer is required for debt payments.' },
      { status: 400 }
    );
  }

  // GIFT_CARD requires a gift card code (or an auto-applied giftCardId).
  const giftCardCode = paymentDetails?.giftCardCode?.trim();
  const giftCardIdFromDetails = paymentDetails?.giftCardId;
  if (paymentMethod === PaymentMethod.GIFT_CARD && !giftCardCode && !giftCardIdFromDetails) {
    return Response.json(
      { success: false, error: 'A gift card code is required for gift card payments.' },
      { status: 400 }
    );
  }

  // SPLIT requires at least 2 split entries.
  if (paymentMethod === PaymentMethod.SPLIT) {
    const splits = paymentDetails?.splits;
    if (!splits || splits.length < 2) {
      return Response.json(
        { success: false, error: 'Split payments require at least 2 payment splits.' },
        { status: 400 }
      );
    }
  }

  // F5-1 (store binding): non-admin users can only check out in their own
  // store — a body-borne storeId for another store is rejected.
  if (session.role !== 'SUPER_ADMIN' && session.storeId && session.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'You can only create transactions for your own store.' },
      { status: 403 }
    );
  }

  // Verify customer if provided
  let customer: Awaited<ReturnType<typeof db.customer.findUnique>> | null = null;
  if (customerId) {
    customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return Response.json(
        { success: false, error: 'Customer not found.' },
        { status: 400 }
      );
    }
  }

  // M-Pesa requires a destination phone — validate AFTER the customer lookup
  // (which may supply it via customer.phone) and BEFORE the transaction so a
  // missing number is a clean 400 instead of a throw inside the checkout
  // transaction (the sale would roll back and surface as a 500).
  if (paymentMethod === PaymentMethod.MPESA && !(paymentDetails?.mpesaPhone || customer?.phone)) {
    return Response.json(
      { success: false, error: 'M-Pesa phone number is required for M-Pesa payments.' },
      { status: 400 }
    );
  }

  // Verify all items and stock levels.
  // NOTE: the existence check uses the DEDUPLICATED id list — a cart may
  // legitimately contain the same product on two lines (e.g. two serial
  // ranges of one SKU). Comparing against the raw list rejected every such
  // checkout with a false "Products not found or inactive" 400.
  const productIds = items.map((item: { productId: string }) => item.productId);
  const uniqueProductIds = [...new Set(productIds)];
  const products = await db.product.findMany({
    where: { id: { in: uniqueProductIds }, storeId, isActive: true },
    include: {
      bundleItems: {
        include: {
          childProduct: true,
        },
      },
    },
  });

  if (products.length !== uniqueProductIds.length) {
    const foundIds = products.map((p) => p.id);
    const missingIds = uniqueProductIds.filter((id: string) => !foundIds.includes(id));
    return Response.json(
      { success: false, error: `Products not found or inactive: ${missingIds.join(', ')}` },
      { status: 400 }
    );
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Build stock deduction map: productId -> total quantity to deduct
  const stockDeductions = new Map<string, { quantity: number; product: typeof products[0] }>();

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) continue;

    const quantity = parseFloat(String(item.quantity));

    if (product.isBundle) {
      // For bundle items, auto-resolve constituent items
      if (!product.bundleItems || product.bundleItems.length === 0) {
        return Response.json(
          { success: false, error: `Bundle "${product.name}" has no constituent items configured.` },
          { status: 400 }
        );
      }

      for (const bundleItem of product.bundleItems) {
        const childProduct = bundleItem.childProduct;
        const childQtyNeeded = bundleItem.quantityRequired * quantity;

        const existing = stockDeductions.get(childProduct.id);
        const totalNeeded = (existing?.quantity || 0) + childQtyNeeded;

        if (childProduct.quantityInStock < totalNeeded) {
          return Response.json(
            {
              success: false,
              error: `Insufficient stock for "${childProduct.name}" (bundle constituent). Available: ${childProduct.quantityInStock}, Needed: ${totalNeeded}`,
            },
            { status: 400 }
          );
        }

        stockDeductions.set(childProduct.id, {
          quantity: totalNeeded,
          product: childProduct as typeof products[0],
        });
      }
    } else {
      // Regular product
      if (!product.isRental) {
        const existing = stockDeductions.get(product.id);
        const totalNeeded = (existing?.quantity || 0) + quantity;

        if (product.quantityInStock < totalNeeded) {
          return Response.json(
            {
              success: false,
              error: `Insufficient stock for "${product.name}". Available: ${product.quantityInStock}, Needed: ${totalNeeded}`,
            },
            { status: 400 }
          );
        }

        stockDeductions.set(product.id, {
          quantity: totalNeeded,
          product,
        });
      }
    }
  }

  // ── F5-1: server-authoritative pricing ──────────────────────────────────
  // The checkout previously trusted client-supplied pricePerUnit, costPrice
  // and taxRate — a compromised/misbehaving client could sell KES 10,000 of
  // stock for KES 1 or poison COGS. Prices, cost and tax now come from the
  // Product row loaded above; client values are ignored.
  let subtotal = 0;
  let taxAmount = 0;
  let totalDiscount = 0;

  const saleItemsData = items.map((item: { productId: string; productName: string; sku: string; quantity: number; unitType: string; pricePerUnit: number; costPrice: number; discountPercent: number; taxRate: number; isRentalItem: boolean; isBundle: boolean }, index: number) => {
    const product = productMap.get(item.productId);

    // Safe numeric coercion with NaN guard — prevents silent NaN propagation
    // into the database. If any numeric field cannot be parsed, we reject the
    // entire checkout with a clear 400 error.
    const safePrice = product ? Number(product.pricePerUnit) : parseFloat(String(item.pricePerUnit));
    const safeCost  = product ? Number(product.costPrice) : parseFloat(String(item.costPrice));
    const safeQty   = parseFloat(String(item.quantity));
    const safeDisc  = Math.min(100, Math.max(0, parseFloat(String(item.discountPercent || 0)) || 0));
    const safeTax   = product ? Number(product.taxRate) : parseFloat(String(item.taxRate || 16));

    if (Number.isNaN(safePrice) || safePrice < 0) {
      throw new CheckoutInputError(`items[${index}].pricePerUnit: Invalid value "${item.pricePerUnit}" — expected a non-negative number.`);
    }
    if (Number.isNaN(safeCost) || safeCost < 0) {
      throw new CheckoutInputError(`items[${index}].costPrice: Invalid value "${item.costPrice}" — expected a non-negative number.`);
    }
    if (Number.isNaN(safeQty) || safeQty <= 0) {
      throw new CheckoutInputError(`items[${index}].quantity: Invalid value "${item.quantity}" — expected a positive number.`);
    }
    if (Number.isNaN(safeTax) || safeTax < 0 || safeTax > 100) {
      throw new CheckoutInputError(`items[${index}].taxRate: Invalid value "${item.taxRate}" — expected a number between 0 and 100.`);
    }

    const calc = calculateLineTotal(safePrice, safeQty, safeDisc, safeTax);
    subtotal += calc.subtotal;
    taxAmount += calc.tax;
    totalDiscount += calc.discount;

    return {
      productId: item.productId,
      productName: product?.name || item.productName,
      quantity: safeQty,
      unitType: item.unitType || 'PIECE',
      pricePerUnit: safePrice,
      costPrice: safeCost,
      discountPercent: safeDisc,
      taxRate: safeTax,
      lineTotal: calc.total,
      isRentalItem: item.isRentalItem || false,
    };
  });

  // AUDIT FIX (5): calculateLineTotal now returns HALF_EVEN-rounded 2dp
  // values per line; re-round the accumulated header aggregates so float
  // summation dust (Σ of 2dp doubles) can never be frozen into the Decimal
  // columns. With all aggregates exact at 2dp, the journal balance identity
  // holds exactly and the ±0.01 backstop in recordSaleJournalEntry can
  // never trip.
  subtotal = KES(subtotal).round().toNumber();
  taxAmount = KES(taxAmount).round().toNumber();
  totalDiscount = KES(totalDiscount).round().toNumber();

  const totalAmount = KES(subtotal - totalDiscount + taxAmount).round().toNumber();
  // F5-1: discount cap — a discount larger than the line-discounted total
  // used to produce a NEGATIVE finalTotal (negative Payment, negative debt).
  const appliedDiscount = Math.max(0, Math.min(Number(discountAmount) || 0, totalAmount));
  const finalTotal = KES(totalAmount - appliedDiscount).round().toNumber();

  // AUDIT FIX (3): explicit split-tender total validation. Σ(split legs)
  // must equal the server-computed finalTotal within 0.005 — the route
  // returns a clear 400 instead of relying on the deep ±0.01 journal-entry
  // balance throw in recordSaleJournalEntry to catch a mismatched tender.
  if (paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits) {
    let splitSum = 0;
    for (let i = 0; i < paymentDetails.splits.length; i++) {
      const split = paymentDetails.splits[i];
      const legAmount = Number(split.amount);
      if (!Number.isFinite(legAmount) || legAmount <= 0) {
        return Response.json(
          { success: false, error: `Split payment ${i + 1} amount must be a positive number.` },
          { status: 400 }
        );
      }
      splitSum += legAmount;
    }
    const roundedSplitSum = KES(splitSum).round().toNumber();
    if (Math.abs(roundedSplitSum - finalTotal) > 0.005) {
      return Response.json(
        {
          success: false,
          error: `Split payment total (KES ${roundedSplitSum.toFixed(2)}) does not match the sale total (KES ${finalTotal.toFixed(2)}).`,
        },
        { status: 400 }
      );
    }
  }

  // F5-1: credit-limit check now uses SERVER-computed totals (it previously
  // re-derived totals from client prices and could be bypassed).
  // AUDIT FIX (2): the check now also covers SPLIT tenders containing DEBT
  // legs — those charge the customer's credit account exactly like a
  // pure-DEBT sale. This pre-check is the friendly early 400; the
  // authoritative guard is the conditional write inside the transaction
  // below (TOCTOU-proof against concurrent sales to the same customer).
  if (customer) {
    const debtCharge =
      paymentMethod === PaymentMethod.DEBT
        ? finalTotal
        : paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits
          ? paymentDetails.splits
              .filter((s) => s.method === PaymentMethod.DEBT)
              .reduce((sum, s) => sum + Number(s.amount), 0)
          : 0;
    if (debtCharge > 0) {
      const availableCredit = KES(customer.debtLimit)
        .subtract(customer.currentDebtBalance)
        .round()
        .toNumber();
      const roundedCharge = KES(debtCharge).round().toNumber();
      if (roundedCharge > availableCredit) {
        return Response.json(
          {
            success: false,
            error: `Customer credit limit exceeded. Available credit: KES ${availableCredit.toLocaleString()}, Transaction total: KES ${roundedCharge.toLocaleString()}`,
          },
          { status: 400 }
        );
      }
    }
  }

  // ── Pre-validate gift card payments (fail fast with 400) ──────────────
  // We validate existence / status / expiry / balance BEFORE opening the
  // transaction so the cashier gets a clean 400 rather than a 500 from a
  // thrown tx error. A second in-tx re-check guards against race conditions.
  if (paymentMethod === PaymentMethod.GIFT_CARD && giftCardCode) {
    const giftCard = await db.giftCard.findUnique({ where: { code: giftCardCode } });
    if (!giftCard) {
      return Response.json(
        { success: false, error: `Gift card "${giftCardCode}" not found.` },
        { status: 400 }
      );
    }
    if (giftCard.status !== 'ACTIVE' && giftCard.status !== 'PARTIALLY_REDEEMED') {
      return Response.json(
        { success: false, error: `Gift card "${giftCardCode}" is not active (status: ${giftCard.status}).` },
        { status: 400 }
      );
    }
    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      return Response.json(
        { success: false, error: `Gift card "${giftCardCode}" has expired.` },
        { status: 400 }
      );
    }
    if (giftCard.currentBalance < finalTotal) {
      return Response.json(
        {
          success: false,
          error: `Gift card "${giftCardCode}" balance (KES ${giftCard.currentBalance.toLocaleString()}) is less than the sale total (KES ${finalTotal.toLocaleString()}).`,
        },
        { status: 400 }
      );
    }
  }

  // SYS-7/F5-6: receipt numbers are crypto-random (see helpers.ts) and the
  // whole checkout is retried on the rare P2002 unique-number collision —
  // the old Math.random suffix could abort a live checkout with a 500.
  const orgId = session.organizationId || 'org_mbumah';

  // Pre-fetch (and auto-create if missing) ALL accounting chart-of-account
  // IDs BEFORE opening the transaction. `recordSaleJournalEntry` calls
  // `getAccountIds` internally — if that runs inside the $transaction and a
  // missing account (e.g. SALES_DISCOUNTS 4300) triggers an auto-create on
  // the DEFAULT client, the extra DB round-trips can push past Prisma's 5s
  // interactive-transaction timeout. Pre-warming the in-memory cache here
  // means the in-tx lookup is a zero-IO cache hit.
  await getAccountIds(orgId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.MPESA_ACCOUNT,
    ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ACCOUNT_CODES.GIFT_CARD_LIABILITY,
    ACCOUNT_CODES.SALES_REVENUE,
    ACCOUNT_CODES.VAT_PAYABLE,
    ACCOUNT_CODES.SALES_DISCOUNTS,
    ACCOUNT_CODES.COST_OF_GOODS_SOLD,
    ACCOUNT_CODES.INVENTORY,
  ]);

  // ═══════════════════════════════════════════════════════════════════════
  //  ATOMIC CHECKOUT TRANSACTION
  //  Every side effect below either commits together or rolls back together.
  //  Timeout raised to 15s (default 5s) to accommodate Daraja STK push prep
  //  and journal-entry line creation on slow connections.
  // ═══════════════════════════════════════════════════════════════════════
  // Wrapped in withSequenceRetry: on a receipt-number P2002 the retry
  // regenerates the number and re-runs (SYS-7). On an idempotency-key
  // P2002 (concurrent same-key replay) the committed original is returned.
  const checkoutAttempt = await withSequenceRetry(async () => {
    const receiptNumber = generateReceiptNumber();
    try {
      const txResult = await runCheckoutTransaction(receiptNumber);
      return { transaction: txResult, receiptNumber };
    } catch (err) {
      // Concurrent same-idempotency-key checkout: the other request committed
      // first — return ITS transaction instead of failing the client.
      if (idempotencyKey && isP2002(err)) {
        const existing = await db.salesTransaction.findUnique({
          where: { idempotencyKey },
          include: { items: true, payments: true, receipt: true },
        });
        if (existing) {
          return { transaction: existing, receiptNumber };
        }
      }
      throw err;
    }
  }).catch((err: unknown) => {
    // AUDIT FIX (2): map the typed in-transaction credit-limit failure to the
    // same client-facing 400 the friendly pre-check returns (a concurrent
    // sale may have consumed the customer's remaining headroom).
    if (err instanceof CreditLimitExceededError) {
      return { creditLimitExceeded: true as const, message: err.message };
    }
    throw err;
  });

  if ('creditLimitExceeded' in checkoutAttempt) {
    await systemLog({
      action: 'CREDIT_LIMIT_EXCEEDED',
      component: LogComponent.POS,
      severity: LogSeverity.WARN,
      message: `Checkout aborted: ${checkoutAttempt.message}`,
      storeId,
      userId: cashierId,
      metadata: {
        customerId: customerId || null,
        paymentMethod,
      },
    });
    return Response.json(
      { success: false, error: checkoutAttempt.message },
      { status: 400 }
    );
  }

  const { transaction: result, receiptNumber } = checkoutAttempt;

  // ══ The transaction body is factored into runCheckoutTransaction so the
  // ══ retry wrapper can regenerate the receipt number per attempt.
  async function runCheckoutTransaction(receiptNumber: string) {
    return db.$transaction(
    async (tx) => {
    let paymentStatusValue: string = PaymentStatus.COMPLETED;

    if (paymentMethod === PaymentMethod.MPESA) {
      paymentStatusValue = PaymentStatus.PENDING;
    } else if (paymentMethod === PaymentMethod.DEBT) {
      paymentStatusValue = PaymentStatus.COMPLETED;
    }

    // 1 ── Create the sales transaction + line items ──
    const transaction = await tx.salesTransaction.create({
      data: {
        storeId,
        receiptNumber,
        customerId: customerId || null,
        cashierId,
        subtotal,
        taxAmount,
        discountAmount: appliedDiscount,
        totalAmount: finalTotal,
        paymentMethod,
        paymentStatus: paymentStatusValue,
        transactionType: 'SALE',
        notes: notes || null,
        // SYS-10: stores the client idempotency key (unique) so replayed
        // checkouts are detectable at the database level.
        idempotencyKey: idempotencyKey || null,
        items: {
          create: saleItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    // 2 ── Record payment row(s) ──
    // AUDIT FIX (1): a SPLIT may now include DEBT legs. The Payment row for
    // EVERY leg (including DEBT, COMPLETED — same as the pure-DEBT path) is
    // created here; the DEBT leg's DebtLedger charge + customer balance
    // increment + A/R journal treatment are applied further below, inside
    // this SAME interactive transaction.
    if (paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits) {
      for (const split of paymentDetails.splits) {
        await tx.payment.create({
          data: {
            storeId,
            transactionId: transaction.id,
            paymentMethod: split.method,
            amount: parseFloat(String(split.amount)),
            currency: 'KES',
            status: split.method === PaymentMethod.MPESA ? PaymentStatus.PENDING : PaymentStatus.COMPLETED,
            reference: split.reference || null,
          },
        });
      }
    } else {
      await tx.payment.create({
        data: {
          storeId,
          transactionId: transaction.id,
          paymentMethod,
          amount: finalTotal,
          currency: 'KES',
          status: paymentMethod === PaymentMethod.MPESA ? PaymentStatus.PENDING : PaymentStatus.COMPLETED,
          reference: paymentMethod === PaymentMethod.CASH ? receiptNumber : null,
        },
      });
    }

    // 3 ── Deduct stock + write stock movements ──
    for (const [productId, deduction] of stockDeductions) {
      const { quantity, product } = deduction;

      // R1 remediation: ATOMIC conditional decrement. The previous
      // read-then-check (`findUnique` → compare → `decrement`) was a TOCTOU
      // race — two concurrent checkouts of the last unit could both pass and
      // drive stock negative. `updateMany` with a `gte` predicate takes the
      // row lock and re-evaluates the predicate atomically: only ONE of the
      // concurrent checkouts can succeed; the loser aborts the whole sale.
      if (!product.isRental) {
        const claimed = await tx.product.updateMany({
          where: { id: productId, quantityInStock: { gte: quantity } },
          data: { quantityInStock: { decrement: quantity } },
        });
        if (claimed.count === 0) {
          throw new Error(
            `Insufficient stock for "${product.name}". Needed: ${quantity}. (Concurrent sale may have consumed the last units.)`,
          );
        }
      }

      await tx.stockMovement.create({
        data: {
          storeId,
          productId,
          movementType: product.isRental ? 'RENTAL_OUT' : 'SALE',
          quantity: -quantity,
          referenceId: transaction.id,
          notes: `Sale ${receiptNumber}`,
          performedBy: cashierId,
        },
      });
    }

    // 4 ── Payment-method-specific side effects ──

    // CASH → cash drawer ledger entry.
    // AUDIT FIX (4): a SPLIT tender's CASH portion previously never reached
    // the drawer ledger, so the drawer balance drifted from reality whenever
    // a sale was split across cash + another tender. The full-CASH path and
    // the split's cash portion now share the SAME aggregate-then-insert
    // pattern (running balance derived from Σ signed amounts — never
    // read-latest-row, which loses concurrent updates).
    const splitCashTotal =
      paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits
        ? paymentDetails.splits
            .filter((s) => s.method === PaymentMethod.CASH)
            .reduce((sum, s) => sum + Number(s.amount), 0)
        : 0;
    const cashDrawerAmount =
      paymentMethod === PaymentMethod.CASH
        ? finalTotal
        : KES(splitCashTotal).round().toNumber();

    if (cashDrawerAmount > 0) {
      // R6 remediation: running balance derived from the SUM of signed
      // amounts instead of read-latest-row + write — the old pattern lost
      // updates whenever two cash events ran concurrently.
      const agg = await tx.cashDrawerLog.aggregate({
        where: { storeId },
        _sum: { amount: true },
      });
      const runningBalance = Number(agg._sum.amount ?? 0) + Number(cashDrawerAmount);

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: cashierId,
          action: 'SALE',
          amount: cashDrawerAmount,
          balance: runningBalance,
          notes:
            paymentMethod === PaymentMethod.CASH
              ? `Sale ${receiptNumber}`
              : `Split-tender cash portion of sale ${receiptNumber}`,
        },
      });
    }

    // M-PESA → pending M-Pesa transaction row + outbox STK-push event.
    if (paymentMethod === PaymentMethod.MPESA) {
      const mpesaPhone = paymentDetails?.mpesaPhone || customer?.phone || '';
      if (!mpesaPhone) {
        throw new Error('M-Pesa phone number is required for M-Pesa payments.');
      }

      await tx.mpesaTransaction.create({
        data: {
          storeId,
          phoneNumber: mpesaPhone,
          amount: finalTotal,
          status: 'PENDING',
          transactionId: transaction.id,
        },
      });

      // F6-2 remediation: the server-side STK push is no longer a
      // fire-and-forget relative-URL fetch (which could never resolve and
      // silently stranded every M-Pesa sale in PENDING). The push request is
      // enqueued INSIDE this transaction and delivered right after commit by
      // the outbox pump — atomically with the sale, retried on failure.
      await enqueueOutbox(tx, {
        storeId,
        kind: 'MPESA_STK_PUSH',
        payload: {
          phoneNumber: mpesaPhone,
          amount: finalTotal,
          accountReference: receiptNumber,
          transactionDesc: `Payment for ${receiptNumber}`,
          storeId,
          transactionId: transaction.id,
        },
      });
    }

    // DEBT → debt ledger entry + customer balance increment.
    if (paymentMethod === PaymentMethod.DEBT && customer) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      await tx.debtLedger.create({
        data: {
          storeId,
          customerId: customer.id,
          transactionId: transaction.id,
          amountOwed: finalTotal,
          amountPaid: 0,
          balance: finalTotal,
          dueDate,
          status: 'OUTSTANDING',
          agingBucket: 'CURRENT',
          notes: `Auto-created from sale ${receiptNumber}`,
        },
      });

      // AUDIT FIX (2) TOCTOU: the old code did a pre-check OUTSIDE the tx
      // followed by an UNCONDITIONAL `increment` inside it — two concurrent
      // DEBT sales could both pass the check and push the customer past
      // their limit. The `lte` predicate makes the limit check and the
      // increment ONE atomic operation under the row lock: only checkouts
      // that keep `balance + charge ≤ debtLimit` commit; a losing checkout
      // claims 0 rows and aborts the whole sale (typed error → 400).
      // Schema note: currentDebtBalance/debtLimit are Prisma `Decimal`
      // (decimal.js) columns — headroom is computed via `KES` (HALF_EVEN,
      // 2dp) so no float dust can skew the predicate.
      const chargeAmount = KES(finalTotal).round().toNumber();
      const headroom = KES(customer.debtLimit).subtract(chargeAmount).round().toNumber();
      const claimedCredit = await tx.customer.updateMany({
        where: {
          id: customer.id,
          currentDebtBalance: { lte: headroom },
        },
        data: { currentDebtBalance: { increment: chargeAmount } },
      });
      if (claimedCredit.count === 0) {
        throw new CreditLimitExceededError(
          `Customer credit limit exceeded. Available credit: KES ${KES(customer.debtLimit)
            .subtract(customer.currentDebtBalance)
            .round()
            .toNumber()
            .toLocaleString()}, Charge: KES ${chargeAmount.toLocaleString()} (a concurrent sale may have used the remaining credit).`,
        );
      }
    }

    // GIFT_CARD → redeem the balance with an ATOMIC conditional decrement.
    if (paymentMethod === PaymentMethod.GIFT_CARD && giftCardCode) {
      const giftCard = await tx.giftCard.findUnique({
        where: { code: giftCardCode },
      });
      if (!giftCard) {
        throw new Error(`Gift card "${giftCardCode}" not found.`);
      }
      if (giftCard.status !== 'ACTIVE' && giftCard.status !== 'PARTIALLY_REDEEMED') {
        throw new Error(`Gift card "${giftCardCode}" is not active (status: ${giftCard.status}).`);
      }
      if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
        throw new Error(`Gift card "${giftCardCode}" has expired.`);
      }

      // R2 remediation: the previous read-balance-then-write-absolute-value
      // pattern allowed two concurrent redemptions to both drain the same
      // card (double-spend). The `gte` predicate makes the balance check and
      // decrement one atomic operation — at most ONE concurrent checkout can
      // claim the balance.
      const claimed = await tx.giftCard.updateMany({
        where: {
          id: giftCard.id,
          status: { in: ['ACTIVE', 'PARTIALLY_REDEEMED'] },
          currentBalance: { gte: finalTotal },
        },
        data: {
          currentBalance: { decrement: finalTotal },
          lastRedeemedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new Error(
          `Gift card "${giftCardCode}" has insufficient balance or was concurrently redeemed.`,
        );
      }

      // Re-read INSIDE the tx to observe the post-decrement balance (our own
      // write + any committed concurrent writes) for the status flags.
      const freshCard = await tx.giftCard.findUnique({ where: { id: giftCard.id } });
      const newBalance = Number(freshCard?.currentBalance ?? 0);
      await tx.giftCard.update({
        where: { id: giftCard.id },
        data: {
          status: newBalance <= 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED',
          isVisible: newBalance > 0 ? giftCard.isVisible : false,
        },
      });

      await tx.giftCardRedemption.create({
        data: {
          giftCardId: giftCard.id,
          transactionId: transaction.id,
          amount: finalTotal,
          redeemedBy: cashierId,
          notes: `Redeemed for sale ${receiptNumber}`,
        },
      });
    }

    // F5-3 remediation: SPLIT payments that include a GIFT_CARD leg now
    // REDEEM the card. Previously the split only aggregated the amount into
    // the journal's gift-card liability debit — the card balance was never
    // touched, so the card remained fully spendable while the GL said the
    // liability was consumed (double-spend + misstated liability).
    if (paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits) {
      for (const split of paymentDetails.splits) {
        if (split.method !== PaymentMethod.GIFT_CARD) continue;
        const splitAmount = parseFloat(String(split.amount));
        const splitCode = split.giftCardCode?.trim();
        if (!splitCode) {
          throw new Error(
            'A gift card code is required for every GIFT_CARD split (paymentDetails.splits[].giftCardCode).',
          );
        }
        const splitCard = await tx.giftCard.findUnique({ where: { code: splitCode } });
        if (!splitCard) throw new Error(`Gift card "${splitCode}" not found.`);
        if (splitCard.status !== 'ACTIVE' && splitCard.status !== 'PARTIALLY_REDEEMED') {
          throw new Error(`Gift card "${splitCode}" is not active (status: ${splitCard.status}).`);
        }
        if (splitCard.expiresAt && splitCard.expiresAt < new Date()) {
          throw new Error(`Gift card "${splitCode}" has expired.`);
        }
        const claimedSplit = await tx.giftCard.updateMany({
          where: {
            id: splitCard.id,
            status: { in: ['ACTIVE', 'PARTIALLY_REDEEMED'] },
            currentBalance: { gte: splitAmount },
          },
          data: { currentBalance: { decrement: splitAmount }, lastRedeemedAt: new Date() },
        });
        if (claimedSplit.count === 0) {
          throw new Error(
            `Gift card "${splitCode}" has insufficient balance for the split amount or was concurrently redeemed.`,
          );
        }
        await tx.giftCardRedemption.create({
          data: {
            giftCardId: splitCard.id,
            transactionId: transaction.id,
            amount: splitAmount,
            redeemedBy: cashierId,
            notes: `Split-tender redemption for sale ${receiptNumber}`,
          },
        });
      }
    }

    // AUDIT FIX (1): SPLIT tender with a DEBT leg previously recorded ONLY a
    // COMPLETED Payment row — no DebtLedger charge row, no customer balance
    // increment, and no A/R debit in the journal. The customer received
    // goods on credit that existed nowhere in the debt system, and the JE
    // was one-sided. Each DEBT leg now runs the EXACT same treatment as the
    // pure-DEBT path, inside this SAME interactive transaction:
    //   (a) credit-limit enforcement via the conditional optimistic write
    //       (AUDIT FIX 2 pattern — TOCTOU-proof),
    //   (b) a DebtLedger charge row,
    //   (c) a customer.currentDebtBalance increment,
    //   (d) the A/R debit is routed via paymentBreakdown.credit below
    //       (identical to the pure-DEBT journal treatment).
    // The Payment row itself was already created in step 2 above.
    if (paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits) {
      for (const split of paymentDetails.splits) {
        if (split.method !== PaymentMethod.DEBT) continue;
        if (!customer) {
          // Defense in depth — the checkout schema refinement already
          // requires customerId for DEBT split legs; the customer row is
          // re-checked here in case it was deleted after the pre-check.
          throw new Error('Customer is required for every DEBT split payment.');
        }
        const splitAmount = KES(split.amount).round().toNumber();

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);
        await tx.debtLedger.create({
          data: {
            storeId,
            customerId: customer.id,
            transactionId: transaction.id,
            amountOwed: splitAmount,
            amountPaid: 0,
            balance: splitAmount,
            dueDate,
            status: 'OUTSTANDING',
            agingBucket: 'CURRENT',
            notes: `Auto-created from split-tender payment on sale ${receiptNumber}`,
          },
        });

        // Conditional optimistic write (see AUDIT FIX 2): the predicate is
        // re-evaluated under the row lock, so it accounts for prior DEBT
        // legs in this same tx AND committed concurrent sales.
        const headroom = KES(customer.debtLimit).subtract(splitAmount).round().toNumber();
        const claimedCredit = await tx.customer.updateMany({
          where: {
            id: customer.id,
            currentDebtBalance: { lte: headroom },
          },
          data: { currentDebtBalance: { increment: splitAmount } },
        });
        if (claimedCredit.count === 0) {
          throw new CreditLimitExceededError(
            `Customer credit limit exceeded for ${customer.name}. Available credit: KES ${KES(customer.debtLimit)
              .subtract(customer.currentDebtBalance)
              .round()
              .toNumber()
              .toLocaleString()}, Split charge: KES ${splitAmount.toLocaleString()}.`,
          );
        }
      }
    }

    // ── F2-1: claim serialized assets (IN_STOCK → SOLD) ──
    // Conditional updateMany per serial = the double-sell lock: only ONE
    // concurrent checkout can flip a serial out of IN_STOCK; the loser
    // aborts the entire sale before the journal/receipt are written.
    if (serials && serials.length > 0) {
      for (const s of serials) {
        const claimedSerial = await tx.serialNumber.updateMany({
          where: { serial: s.serial, productId: s.productId, storeId, status: 'IN_STOCK' },
          data: {
            status: 'SOLD',
            soldInTransactionId: transaction.id,
          },
        });
        if (claimedSerial.count === 0) {
          throw new Error(
            `Serial "${s.serial}" is not available in this store (already sold, reserved, or unknown). Sale aborted.`,
          );
        }
      }
    }

    // 5 ── Single balanced double-entry journal (all payment types) ──
    // grossRevenue = subtotal − line discounts (net sales BEFORE the
    //   cart-level discount). The cart-level discount is routed to the
    //   SALES_DISCOUNTS contra-revenue account (proper GAAP accounting).
    // Balance identity:
    //   Σ debits (payments + discount + COGS) = Σ credits (revenue + tax + inventory)
    const grossRevenue = KES(subtotal - totalDiscount).round().toNumber();
    const cogsAmount = saleItemsData.reduce(
      (sum: number, item: { costPrice: number; quantity: number; isRentalItem: boolean }) =>
        item.isRentalItem ? sum : sum + (item.costPrice || 0) * item.quantity,
      0,
    );

    const paymentBreakdown: {
      cash?: number;
      mpesa?: number;
      giftCard?: number;
      credit?: number;
    } = {};

    if (paymentMethod === PaymentMethod.CASH) {
      paymentBreakdown.cash = finalTotal;
    } else if (paymentMethod === PaymentMethod.MPESA) {
      paymentBreakdown.mpesa = finalTotal;
    } else if (paymentMethod === PaymentMethod.DEBT) {
      paymentBreakdown.credit = finalTotal;
    } else if (paymentMethod === PaymentMethod.GIFT_CARD) {
      paymentBreakdown.giftCard = finalTotal;
    } else if (paymentMethod === PaymentMethod.SPLIT && paymentDetails?.splits) {
      for (const split of paymentDetails.splits) {
        const splitAmount = parseFloat(String(split.amount));
        if (split.method === PaymentMethod.CASH) {
          paymentBreakdown.cash = (paymentBreakdown.cash || 0) + splitAmount;
        } else if (split.method === PaymentMethod.MPESA) {
          paymentBreakdown.mpesa = (paymentBreakdown.mpesa || 0) + splitAmount;
        } else if (split.method === PaymentMethod.GIFT_CARD) {
          paymentBreakdown.giftCard = (paymentBreakdown.giftCard || 0) + splitAmount;
        } else if (split.method === PaymentMethod.DEBT) {
          // AUDIT FIX (1d): a DEBT split leg debits Accounts Receivable —
          // the exact journal treatment the pure-DEBT path gets via
          // `paymentBreakdown.credit = finalTotal`. Without this line the
          // JE was unbalanced by the DEBT leg's amount and the ±0.01
          // backstop aborted the whole sale.
          paymentBreakdown.credit = (paymentBreakdown.credit || 0) + splitAmount;
        }
      }
    }

    await recordSaleJournalEntry(tx, {
      storeId,
      organizationId: orgId,
      cashierId,
      receiptNumber,
      transactionId: transaction.id,
      grossRevenue,
      taxAmount,
      discountAmount: appliedDiscount,
      paymentBreakdown,
      cogsAmount,
      // M-Pesa stays unposted until the Daraja callback confirms payment.
      postImmediately: paymentMethod !== PaymentMethod.MPESA,
    });

    // 6 ── Receipt ──
    await tx.receipt.create({
      data: {
        storeId,
        transactionId: transaction.id,
        receiptNumber,
        receiptType: 'DIGITAL',
      },
    });

    return transaction;
    },
    { timeout: 15000, maxWait: 10000 },
  );
  }

  // ── Post-commit: opportunistic outbox pump ──
  // The MPESA_STK_PUSH event enqueued inside the transaction is delivered
  // here in-process (fast, best-effort) AND by the cron pump as the durable
  // fallback (F6-2/F8-4). Failures leave the event queued with backoff.
  try {
    const { pumpOutbox } = await import('@/lib/outbox');
    const { ensureOutboxHandlers } = await import('@/lib/outbox-handlers');
    ensureOutboxHandlers();
    await pumpOutbox();
  } catch {
    // Pump failure is non-fatal — the cron pump will retry with backoff.
  }

  await systemLog({
    action: 'TRANSACTION_CREATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Transaction ${receiptNumber} created: KES ${finalTotal.toLocaleString()} via ${paymentMethod}`,
    storeId,
    userId: cashierId,
    metadata: {
      transactionId: result.id,
      receiptNumber,
      totalAmount: finalTotal,
      paymentMethod,
      itemCount: items.length,
      customerId: customerId || null,
    },
  });

  // F9-1: tamper-evident audit entry for every completed sale (best-effort —
  // the sale is already committed; chain logging must never block the POS).
  try {
    const { auditTrail } = await import('@/lib/audit-trail');
    await auditTrail.log({
      action: 'CREATE',
      resourceType: 'SalesTransaction',
      resourceId: result.id,
      actorId: cashierId,
      actorRole: session.role,
      storeId,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      newValues: { receiptNumber, totalAmount: finalTotal, paymentMethod, itemCount: items.length },
    });
  } catch {
    /* audit chain must never block checkout */
  }

  // ── Phase 3: Award loyalty points to the customer (non-blocking) ──
  //
  // Rule: 1 point per KES 100 spent (see src/lib/loyalty-utils.ts).
  // F5-5 remediation: points are awarded ONLY when payment is COMPLETED at
  // checkout — M-Pesa sales start PENDING and earn points only if the
  // Daraja callback confirms (previously failed M-Pesa sales kept points).
  // R5 remediation: the balance update uses atomic `increment` operations
  // instead of read-then-write so concurrent sales to one customer cannot
  // lose updates; the tier is recomputed AFTER the atomic increment.
  if (customerId && customer && paymentMethod !== PaymentMethod.MPESA) {
    try {
      const earnedPoints = calculateEarnedPoints(finalTotal);
      if (earnedPoints > 0) {
        // Reload the customer inside a fresh tx to get the authoritative
        // loyaltyPoints + totalLoyaltyEarned values (concurrent sales to the
        // same customer could otherwise cause a lost update).
        await db.$transaction(
          async (tx) => {
            const fresh = await tx.customer.findUnique({
              where: { id: customerId },
              select: {
                id: true,
                loyaltyPoints: true,
                totalLoyaltyEarned: true,
                storeId: true,
              },
            });
            if (!fresh) return;

            // R5 remediation: ATOMIC increments (not read-then-write) so
            // concurrent sales to the same customer can never lose points.
            await tx.customer.update({
              where: { id: customerId },
              data: {
                loyaltyPoints: { increment: earnedPoints },
                totalLoyaltyEarned: { increment: earnedPoints },
              },
            });

            // Re-read AFTER the atomic increment to compute the tier from the
            // authoritative post-increment lifetime total.
            const updated = await tx.customer.findUnique({
              where: { id: customerId },
              select: { loyaltyPoints: true, totalLoyaltyEarned: true },
            });
            const newBalance = Number(updated?.loyaltyPoints ?? Number(fresh.loyaltyPoints) + earnedPoints);
            const newLifetime = Number(updated?.totalLoyaltyEarned ?? Number(fresh.totalLoyaltyEarned) + earnedPoints);
            const newTier = getTierFromPoints(newLifetime);
            await tx.customer.update({
              where: { id: customerId },
              data: { loyaltyTier: newTier },
            });

            await tx.loyaltyTransaction.create({
              data: {
                storeId: fresh.storeId,
                customerId,
                // Legacy field — positive for earned
                points: earnedPoints,
                transactionType: 'EARN',
                // Phase-3 fields
                type: 'EARNED',
                transactionId: result.id,
                balanceAfter: newBalance,
                reason: `Earned from sale ${receiptNumber} (KES ${finalTotal.toFixed(2)})`,
                description: `Earned from sale ${receiptNumber}`,
                reference: receiptNumber,
                referenceId: result.id,
                referenceType: 'SALE',
                createdBy: cashierId,
              },
            });
          },
          { timeout: 8000, maxWait: 6000 },
        );

        // Best-effort audit log — never block the response on logging.
        void systemLog({
          action: 'LOYALTY_POINTS_EARNED',
          component: LogComponent.POS,
          severity: LogSeverity.INFO,
          message: `Customer ${customerId}: earned ${earnedPoints} points from sale ${receiptNumber}`,
          storeId,
          userId: cashierId,
          metadata: {
            customerId,
            transactionId: result.id,
            receiptNumber,
            saleTotal: finalTotal,
            earnedPoints,
          },
        }).catch(() => {
          /* logging must never block */
        });
      }
    } catch (loyaltyErr) {
      // Swallow — sale is already committed. Log for diagnostics.
      void systemLog({
        action: 'LOYALTY_AWARD_FAILED',
        component: LogComponent.POS,
        severity: LogSeverity.WARN,
        message: `Failed to award loyalty points for sale ${receiptNumber}: ${
          loyaltyErr instanceof Error ? loyaltyErr.message : 'Unknown error'
        }`,
        storeId,
        userId: cashierId,
        metadata: {
          customerId,
          transactionId: result.id,
          receiptNumber,
          saleTotal: finalTotal,
        },
      }).catch(() => {
        /* logging must never block */
      });
    }
  }

  const fullTransaction = await db.salesTransaction.findUnique({
    where: { id: result.id },
    include: {
      cashier: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
      payments: true,
      receipt: true,
    },
  });

  return Response.json({ success: true, data: fullTransaction }, { status: 201 });
}

export const GET = withErrorBoundary(requireStoreAccess(getTransactionsHandler) as (...args: unknown[]) => Promise<Response>, 'TRANSACTIONS_LIST');
export const POST = withErrorBoundary(requireStoreAccess(createTransactionHandler) as (...args: unknown[]) => Promise<Response>, 'TRANSACTIONS_CREATE');
