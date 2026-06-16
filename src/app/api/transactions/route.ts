// GET/POST /api/transactions

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateReceiptNumber, generateJournalEntryNumber, calculateLineTotal } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
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
    items,
    paymentMethod,
    paymentDetails,
    discountAmount,
    notes,
  } = validation.data;
  // SECURITY: Must use session user ID after requireAuth() is added
  const cashierId = validation.data.cashierId; // TODO: Replace with session user ID from requireAuth()

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

  const receiptNumber = generateReceiptNumber();

    const cashierOrg = await db.user.findUnique({ where: { id: cashierId }, select: { organizationId: true } });
  const orgId = cashierOrg?.organizationId || 'org_mbumah';
  const accounts = await getAccountIds(orgId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.MPESA_ACCOUNT,
    ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ACCOUNT_CODES.SALES_REVENUE,
    ACCOUNT_CODES.VAT_PAYABLE,
  ]);

    const result = await db.$transaction(async (tx) => {
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

        for (const [productId, deduction] of stockDeductions) {
      const { quantity, product } = deduction;

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
