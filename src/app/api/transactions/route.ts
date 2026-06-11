/**
 * MBUMAH HARDWARE POS - Transactions API
 * GET /api/transactions - List transactions with filtering
 * POST /api/transactions - Create transaction (complete checkout flow)
 *
 * Complete checkout flow:
 * a) Validate all items and stock levels
 * b) For bundle items, auto-resolve constituent items and deduct stock
 * c) Create SalesTransaction with all SaleItems
 * d) Create Payment records
 * e) For CASH: record in cash drawer, create journal entries (DR Cash, CR Sales Revenue, CR VAT Payable)
 * f) For MPESA: create pending MpesaTransaction, initiate STK push
 * g) For DEBT: verify customer debt ceiling, create DebtLedger, create journal entries (DR AR, CR Sales Revenue)
 * h) Deduct stock quantities and create StockMovement records
 * i) Generate receipt number
 * j) Log the transaction to SystemLog
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateReceiptNumber, generateJournalEntryNumber, calculateLineTotal } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, PaymentMethod, PaymentStatus } from '@/lib/types';

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

  const {
    storeId,
    customerId,
    cashierId,
    items,
    paymentMethod,
    paymentDetails,
    discountAmount,
    notes,
  } = body;

  // ===== VALIDATION =====
  if (!storeId || !cashierId || !items || !Array.isArray(items) || items.length === 0 || !paymentMethod) {
    return Response.json(
      { success: false, error: 'storeId, cashierId, items, and paymentMethod are required.' },
      { status: 400 }
    );
  }

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

  // ===== STEP A: Validate all items and stock levels =====
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
      // ===== STEP B: For bundle items, auto-resolve constituent items =====
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

  // ===== DEBT CEILING CHECK (STEP G - early validation) =====
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

  // ===== CALCULATE TOTALS =====
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

  const receiptNumber = generateReceiptNumber();

  // Resolve account IDs for journal entries
  const cashierOrg = await db.user.findUnique({ where: { id: cashierId }, select: { organizationId: true } });
  const orgId = cashierOrg?.organizationId || 'org_mbumah';
  const accounts = await getAccountIds(orgId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.MPESA_ACCOUNT,
    ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ACCOUNT_CODES.SALES_REVENUE,
    ACCOUNT_CODES.VAT_PAYABLE,
  ]);

  // ===== EXECUTE TRANSACTION =====
  const result = await db.$transaction(async (tx) => {
    // ===== STEP C: Create SalesTransaction with SaleItems =====
    let paymentStatusValue: string = PaymentStatus.COMPLETED;

    if (paymentMethod === PaymentMethod.MPESA) {
      paymentStatusValue = PaymentStatus.PENDING;
    } else if (paymentMethod === PaymentMethod.DEBT) {
      paymentStatusValue = PaymentStatus.COMPLETED;
    }

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

    // ===== STEP D: Create Payment records =====
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

    // ===== STEP H: Deduct stock and create StockMovement records =====
    for (const [productId, deduction] of stockDeductions) {
      const { quantity, product } = deduction;

      // Update product stock
      await tx.product.update({
        where: { id: productId },
        data: { quantityInStock: { decrement: quantity } },
      });

      // Create stock movement record
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

    // ===== STEP E: CASH payment - Cash drawer + Journal entries =====
    if (paymentMethod === PaymentMethod.CASH) {
      // Get current cash drawer balance
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

      // Create journal entries: DR Cash, CR Sales Revenue, CR VAT Payable
      const jeNumber = generateJournalEntryNumber();
      const salesRevenue = subtotal - totalDiscount - appliedDiscount;
      const vatAmount = taxAmount;

      const journalEntry = await tx.journalEntry.create({
        data: {
          storeId,
          entryNumber: jeNumber,
          description: `Sale ${receiptNumber}`,
          referenceType: 'SALE',
          referenceId: transaction.id,
          totalDebit: finalTotal,
          totalCredit: salesRevenue + vatAmount,
          isPosted: true,
          postedAt: new Date(),
          createdBy: cashierId,
          lines: {
            create: [
              {
                accountId: accounts.CASH_ON_HAND,
                debit: finalTotal,
                credit: 0,
                description: `Cash received for sale ${receiptNumber}`,
              },
              {
                accountId: accounts.SALES_REVENUE,
                debit: 0,
                credit: salesRevenue,
                description: `Sales revenue for ${receiptNumber}`,
              },
              {
                accountId: accounts.VAT_PAYABLE,
                debit: 0,
                credit: vatAmount,
                description: `VAT collected on sale ${receiptNumber}`,
              },
            ],
          },
        },
      });
    }

    // ===== STEP F: MPESA payment - Create pending MpesaTransaction =====
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

      // Journal entry: DR M-Pesa Account (pending), CR Sales Revenue, CR VAT Payable
      const jeNumber = generateJournalEntryNumber();
      const salesRevenue = subtotal - totalDiscount - appliedDiscount;
      const vatAmount = taxAmount;

      await tx.journalEntry.create({
        data: {
          storeId,
          entryNumber: jeNumber,
          description: `M-Pesa sale ${receiptNumber} (pending)`,
          referenceType: 'SALE',
          referenceId: transaction.id,
          totalDebit: finalTotal,
          totalCredit: salesRevenue + vatAmount,
          isPosted: false,
          createdBy: cashierId,
          lines: {
            create: [
              {
                accountId: accounts.MPESA_ACCOUNT,
                debit: finalTotal,
                credit: 0,
                description: `M-Pesa payment pending for ${receiptNumber}`,
              },
              {
                accountId: accounts.SALES_REVENUE,
                debit: 0,
                credit: salesRevenue,
                description: `Sales revenue for ${receiptNumber}`,
              },
              {
                accountId: accounts.VAT_PAYABLE,
                debit: 0,
                credit: vatAmount,
                description: `VAT collected on sale ${receiptNumber}`,
              },
            ],
          },
        },
      });
    }

    // ===== STEP G: DEBT payment - DebtLedger + Journal entries =====
    if (paymentMethod === PaymentMethod.DEBT && customer) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // 30-day payment terms

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

      // Update customer debt balance
      await tx.customer.update({
        where: { id: customer.id },
        data: { currentDebtBalance: { increment: finalTotal } },
      });

      // Journal entry: DR Accounts Receivable, CR Sales Revenue, CR VAT Payable
      const jeNumber = generateJournalEntryNumber();
      const salesRevenue = subtotal - totalDiscount - appliedDiscount;
      const vatAmount = taxAmount;

      await tx.journalEntry.create({
        data: {
          storeId,
          entryNumber: jeNumber,
          description: `Credit sale ${receiptNumber} to ${customer.name}`,
          referenceType: 'SALE',
          referenceId: transaction.id,
          totalDebit: finalTotal,
          totalCredit: salesRevenue + vatAmount,
          isPosted: true,
          postedAt: new Date(),
          createdBy: cashierId,
          lines: {
            create: [
              {
                accountId: accounts.ACCOUNTS_RECEIVABLE,
                debit: finalTotal,
                credit: 0,
                description: `Accounts receivable for ${receiptNumber}`,
              },
              {
                accountId: accounts.SALES_REVENUE,
                debit: 0,
                credit: salesRevenue,
                description: `Sales revenue for ${receiptNumber}`,
              },
              {
                accountId: accounts.VAT_PAYABLE,
                debit: 0,
                credit: vatAmount,
                description: `VAT collected on sale ${receiptNumber}`,
              },
            ],
          },
        },
      });
    }

    // ===== STEP I: Create Receipt =====
    await tx.receipt.create({
      data: {
        storeId,
        transactionId: transaction.id,
        receiptNumber,
        receiptType: 'DIGITAL',
      },
    });

    return transaction;
  });

  // ===== STEP F (cont): For MPESA, initiate STK Push after transaction =====
  if (paymentMethod === PaymentMethod.MPESA) {
    try {
      const mpesaPhone = paymentDetails?.mpesaPhone || customer?.phone || '';
      const stkPayload = {
        phoneNumber: mpesaPhone,
        amount: finalTotal,
        accountReference: receiptNumber,
        transactionDesc: `Payment for ${receiptNumber}`,
      };

      // Call M-Pesa mock service
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

  // ===== STEP J: Log the transaction =====
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

  // Fetch complete transaction for response
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
