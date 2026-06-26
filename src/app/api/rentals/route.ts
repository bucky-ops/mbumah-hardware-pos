// GET/POST /api/rentals

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, RentalStatus, StockMovementType } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getRentalsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const status = searchParams.get('status') || '';
  const customerId = searchParams.get('customerId') || '';
  const productId = searchParams.get('productId') || '';
  const overdue = searchParams.get('overdue') === 'true';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const sortBy = searchParams.get('sortBy') || 'rentalStartDate';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  }

  if (overdue) {
    where.status = RentalStatus.OVERDUE;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (productId) {
    where.productId = productId;
  }

  const validSortFields = ['rentalStartDate', 'expectedReturnDate', 'totalRentalCharge', 'status', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'rentalStartDate';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [rentals, total] = await Promise.all([
    db.equipmentRental.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, imageUrl: true } },
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.equipmentRental.count({ where }),
  ]);

    const now = new Date();
  const overdueRentals = rentals.filter(
    (r) => r.status === RentalStatus.ACTIVE && new Date(r.expectedReturnDate) < now
  );

  if (overdueRentals.length > 0) {
    await Promise.all(
      overdueRentals.map((rental) =>
        db.equipmentRental.update({
          where: { id: rental.id },
          data: { status: RentalStatus.OVERDUE },
        })
      )
    );
  }

    const rentalSummary = await db.equipmentRental.aggregate({
    where: { storeId, status: { in: [RentalStatus.ACTIVE, RentalStatus.OVERDUE] } },
    _sum: { totalRentalCharge: true, securityDeposit: true, lateFeeAccumulated: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: rentals.map((r) => ({
      ...r,
      status: overdueRentals.some((o) => o.id === r.id) ? RentalStatus.OVERDUE : r.status,
    })),
    summary: {
      activeRentals: rentalSummary._count,
      totalCharges: rentalSummary._sum.totalRentalCharge || 0,
      totalDeposits: rentalSummary._sum.securityDeposit || 0,
      totalLateFees: rentalSummary._sum.lateFeeAccumulated || 0,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createRentalHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    productId,
    customerId,
    expectedReturnDate,
    securityDeposit,
    ratePerDay,
    ratePerWeek,
    ratePerMonth,
    notes,
    createdBy,
  } = body;

  if (!storeId || !productId || !customerId || !expectedReturnDate || !ratePerDay) {
    return Response.json(
      { success: false, error: 'storeId, productId, customerId, expectedReturnDate, and ratePerDay are required.' },
      { status: 400 }
    );
  }

    const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 }
    );
  }

  if (!product.isRental) {
    return Response.json(
      { success: false, error: 'This product is not available for rental.' },
      { status: 400 }
    );
  }

  if (product.quantityInStock < 1) {
    return Response.json(
      { success: false, error: 'This rental item is currently out of stock.' },
      { status: 400 }
    );
  }

    const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

  const deposit = parseFloat(String(securityDeposit || 0));
  const dailyRate = parseFloat(String(ratePerDay));

  const result = await db.$transaction(async (tx) => {
    const rental = await tx.equipmentRental.create({
      data: {
        storeId,
        productId,
        customerId,
        status: RentalStatus.ACTIVE,
        expectedReturnDate: new Date(expectedReturnDate),
        securityDeposit: deposit,
        ratePerDay: dailyRate,
        ratePerWeek: ratePerWeek ? parseFloat(String(ratePerWeek)) : null,
        ratePerMonth: ratePerMonth ? parseFloat(String(ratePerMonth)) : null,
        totalRentalCharge: 0,
        lateFeeAccumulated: 0,
        notes: notes || null,
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

        await tx.product.update({
      where: { id: productId },
      data: { quantityInStock: { decrement: 1 } },
    });

        await tx.stockMovement.create({
      data: {
        storeId,
        productId,
        movementType: StockMovementType.RENTAL_OUT,
        quantity: -1,
        referenceId: rental.id,
        notes: `Rental to ${customer.name}`,
        performedBy: createdBy || null,
      },
    });

        if (deposit > 0) {
      const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
      });
      const currentBalance = lastDrawerEntry?.balance || 0;

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: createdBy || 'system',
          action: 'CASH_IN',
          amount: deposit,
          balance: currentBalance + deposit,
          notes: `Security deposit for rental - ${product.name}`,
        },
      });

            const jeNumber = generateJournalEntryNumber();
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { organizationId: true } });
      const orgId = store?.organizationId || 'org_mbumah';
      const accounts = await getAccountIds(orgId, [
        ACCOUNT_CODES.CASH_ON_HAND,
        ACCOUNT_CODES.RENTAL_DEPOSITS_HELD,
      ]);
      await tx.journalEntry.create({
        data: {
          storeId,
          entryNumber: jeNumber,
          description: `Security deposit received for ${product.name} rental`,
          referenceType: 'RENTAL',
          referenceId: rental.id,
          totalDebit: deposit,
          totalCredit: deposit,
          isPosted: true,
          postedAt: new Date(),
          createdBy: createdBy || null,
          lines: {
            create: [
              {
                accountId: accounts.CASH_ON_HAND,
                debit: deposit,
                credit: 0,
                description: `Security deposit from ${customer.name}`,
              },
              {
                accountId: accounts.RENTAL_DEPOSITS_HELD,
                debit: 0,
                credit: deposit,
                description: `Security deposit held for ${product.name}`,
              },
            ],
          },
        },
      });
    }

    return rental;
  });

  await systemLog({
    action: 'RENTAL_CREATED',
    component: LogComponent.RENTAL,
    severity: LogSeverity.INFO,
    message: `Rental created: ${product.name} to ${customer.name}`,
    storeId,
    userId: createdBy || undefined,
    metadata: {
      rentalId: result.id,
      productId,
      customerId,
      securityDeposit: deposit,
      ratePerDay: dailyRate,
    },
  });

  return Response.json({ success: true, data: result }, { status: 201 });
}

export const GET = withErrorBoundary(getRentalsHandler, 'RENTALS_LIST');
export const POST = withErrorBoundary(createRentalHandler, 'RENTALS_CREATE');
