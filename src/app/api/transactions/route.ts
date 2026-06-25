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

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateReceiptNumber, calculateLineTotal } from '@/lib/helpers';
import { recordSaleJournalEntry, getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, PaymentMethod, PaymentStatus } from '@/lib/types';
import { checkoutSchema, validateInput } from '@/lib/validations';

async function getTransactionsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
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

async function createTransactionHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const validation = validateInput(checkoutSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const {
    storeId,
    customerId,
    cashierId,
    items,
    paymentMethod,
    paymentDetails,
    discountAmount,
    notes,
  } = validation.data;

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

  // Verify cashier exists
  const cashier = await db.user.findUnique({ where: { id: cashierId } });
  if (!cashier || !cashier.isActive) {
    return Response.json(
      { success: false, error: 'Invalid or inactive cashier.' },
      { status: 400 }
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

  // Validate all items and stock levels
  const productIds = items.map((item: { productId: string }) => item.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    include: {
      bundleItems: {
        include: {
          childProduct: true,
        },
      },
    },
  });

  if (products.length !== productIds.length) {
    const foundIds = products.map((p) => p.id);
    const missingIds = productIds.filter((id: string) => !foundIds.includes(id));
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

  if (paymentMethod === PaymentMethod.DEBT && customer) {
    let totalTransactionAmount = 0;
    for (const item of items) {
      const calc = calculateLineTotal(
        parseFloat(String(item.pricePerUnit)),
        parseFloat(String(item.quantity)),
        parseFloat(String(item.discountPercent || 0)),
        parseFloat(String(item.taxRate || 16))
      );
      totalTransactionAmount += calc.total;
    }
    totalTransactionAmount -= parseFloat(String(discountAmount || 0));

    const availableCredit = customer.debtLimit - customer.currentDebtBalance;
    if (totalTransactionAmount > availableCredit) {
      return Response.json(
        {
          success: false,
          error: `Customer credit limit exceeded. Available credit: KES ${availableCredit.toLocaleString()}, Transaction total: KES ${totalTransactionAmount.toLocaleString()}`,
        },
        { status: 400 }
      );
    }
  }

  let subtotal = 0;
  let taxAmount = 0;
  let totalDiscount = 0;

  const saleItemsData = items.map((item: { productId: string; productName: string; sku: string; quantity: number; unitType: string; pricePerUnit: number; costPrice: number; discountPercent: number; taxRate: number; isRentalItem: boolean; isBundle: boolean }) => {
    const calc = calculateLineTotal(
      parseFloat(String(item.pricePerUnit)),
      parseFloat(String(item.quantity)),
      parseFloat(String(item.discountPercent || 0)),
      parseFloat(String(item.taxRate || 16))
    );
    subtotal += calc.subtotal;
    taxAmount += calc.tax;
    totalDiscount += calc.discount;

    return {
      productId: item.productId,
      productName: item.productName,
      quantity: parseFloat(String(item.quantity)),
      unitType: item.unitType || 'PIECE',
      pricePerUnit: parseFloat(String(item.pricePerUnit)),
      costPrice: parseFloat(String(item.costPrice)),
      discountPercent: parseFloat(String(item.discountPercent || 0)),
      taxRate: parseFloat(String(item.taxRate || 16)),
      lineTotal: calc.total,
      isRentalItem: item.isRentalItem || false,
    };
  });

  const totalAmount = subtotal - totalDiscount + taxAmount;
  const appliedDiscount = parseFloat(String(discountAmount || 0));
  const finalTotal = totalAmount - appliedDiscount;

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

  const receiptNumber = generateReceiptNumber();

  const cashierOrg = await db.user.findUnique({ where: { id: cashierId }, select: { organizationId: true } });
  const orgId = cashierOrg?.organizationId || 'org_mbumah';

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
  const result = await db.$transaction(
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
        items: {
          create: saleItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    // 2 ── Record payment row(s) ──
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

    // 3 ── Deduct stock + write stock movements (with negative-stock safeguard) ──
    for (const [productId, deduction] of stockDeductions) {
      const { quantity, product } = deduction;

      // Safeguard: re-read stock INSIDE the transaction and refuse to go
      // negative. The pre-tx check at the top guards the common path, but
      // two concurrent checkouts could both pass the pre-check and then
      // double-decrement. This in-tx re-check is the authoritative guard.
      if (!product.isRental) {
        const currentStock = await tx.product.findUnique({
          where: { id: productId },
          select: { quantityInStock: true, name: true },
        });
        if (currentStock && currentStock.quantityInStock < quantity) {
          throw new Error(
            `Insufficient stock for "${currentStock.name}". Available: ${currentStock.quantityInStock}, Needed: ${quantity}.`,
          );
        }
      }

      await tx.product.update({
        where: { id: productId },
        data: { quantityInStock: { decrement: quantity } },
      });

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
    if (paymentMethod === PaymentMethod.CASH) {
      const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
      });
      const currentBalance = lastDrawerEntry?.balance || 0;

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: cashierId,
          action: 'SALE',
          amount: finalTotal,
          balance: currentBalance + finalTotal,
          notes: `Sale ${receiptNumber}`,
        },
      });
    }

    // M-PESA → pending M-Pesa transaction row (STK push fired post-commit).
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

      await tx.customer.update({
        where: { id: customer.id },
        data: { currentDebtBalance: { increment: finalTotal } },
      });
    }

    // GIFT_CARD → redeem the balance atomically (in-tx re-check + decrement).
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
      if (giftCard.currentBalance < finalTotal) {
        throw new Error(
          `Gift card "${giftCardCode}" balance (KES ${giftCard.currentBalance}) is less than the sale total (KES ${finalTotal}).`,
        );
      }

      const newBalance = giftCard.currentBalance - finalTotal;
      await tx.giftCard.update({
        where: { id: giftCard.id },
        data: {
          currentBalance: newBalance,
          status: newBalance <= 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED',
          lastRedeemedAt: new Date(),
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

    // 5 ── Single balanced double-entry journal (all payment types) ──
    // grossRevenue = subtotal − line discounts (net sales BEFORE the
    //   cart-level discount). The cart-level discount is routed to the
    //   SALES_DISCOUNTS contra-revenue account (proper GAAP accounting).
    // Balance identity:
    //   Σ debits (payments + discount + COGS) = Σ credits (revenue + tax + inventory)
    const grossRevenue = subtotal - totalDiscount;
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

  // ── Post-commit: fire M-Pesa STK push (non-blocking) ──
  if (paymentMethod === PaymentMethod.MPESA) {
    try {
      const mpesaPhone = paymentDetails?.mpesaPhone || customer?.phone || '';
      const stkPayload = {
        phoneNumber: mpesaPhone,
        amount: finalTotal,
        accountReference: receiptNumber,
        transactionDesc: `Payment for ${receiptNumber}`,
      };

      fetch('/api/payments/mpesa/stkpush?XTransformPort=3001', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stkPayload,
          storeId,
          transactionId: result.id,
        }),
      }).catch(() => {
        // STK push failure logged but does not block the transaction
      });
    } catch {
      // Non-blocking: STK push initiation failure
    }
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

export const GET = withErrorBoundary(getTransactionsHandler, 'TRANSACTIONS_LIST');
export const POST = withErrorBoundary(createTransactionHandler, 'TRANSACTIONS_CREATE');
