// GET/POST /api/rentals

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, RentalStatus, StockMovementType } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest } from '@/lib/auth';
// Task 12-c: canonical financial math. Prisma Decimal `valueOf()` returns a
// STRING — `currentBalance + deposit` used to STRING-CONCATENATE, and
// parseFloat() let IEEE-754 dust into the Decimal rate/deposit columns.
import { toDec, round2 } from '@/lib/utils/financialMath';

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

  // Non-blocking status sync: update overdue rentals in the background.
  // Wrapped in try/catch so a write failure (concurrent update, constraint)
  // never breaks the list read — the response still returns the rentals
  // with corrected in-memory status below.
  if (overdueRentals.length > 0) {
    Promise.all(
      overdueRentals.map((rental) =>
        db.equipmentRental
          .update({
            where: { id: rental.id },
            data: { status: RentalStatus.OVERDUE },
          })
          .catch(() => {
            /* ignore — best-effort status sync */
          })
      )
    ).catch(() => {
      /* ignore — best-effort status sync */
    });
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
  } = body;

  // AUDIT FIX (governance): the actor identity previously came from the request
  // body (`createdBy`) — any caller could impersonate another user. Identity is
  // now derived from the authenticated session (withSessionAuth above has
  // already validated it; same in-handler pattern as gift-cards/debt routes).
  const session = await getSessionFromRequest(request);
  if (!session) {
    // Defensive — withSessionAuth already returned 401 for unauthenticated calls.
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }
  const actorId = session.userId;

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

  // Advisory fast-fail only — the AUTHORITATIVE guard is the conditional
  // updateMany inside the transaction below (AUDIT FIX: the old outside-tx
  // check was a read-then-act race that concurrent rentals/checkouts could beat).
  if (Number(product.quantityInStock) < 1) {
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

  // Task 12-c: Decimal coercion + HALF_UP 2dp rounding for money columns.
  const deposit = round2(toDec(securityDeposit ?? 0));
  const dailyRate = round2(toDec(ratePerDay));

  const result = await db.$transaction(async (tx) => {
    // AUDIT FIX (oversell): this was a blind `product.update` decrement AFTER
    // creating the rental, preceded by an outside-the-tx stock check — a
    // concurrent rental/checkout of the last unit could drive stock negative
    // and strand a phantom rental. The claim is now a conditional updateMany
    // (row lock + atomic `gte 1` predicate re-check) that runs FIRST so a
    // failed claim aborts before any rental row is written; count === 0 →
    // typed 409 below. Same pattern as transactions/route.ts:583-591.
    const claimed = await tx.product.updateMany({
      where: { id: productId, quantityInStock: { gte: 1 } },
      data: { quantityInStock: { decrement: 1 } },
    });
    if (claimed.count === 0) {
      return { ok: false as const, reason: 'unavailable' as const };
    }

    const rental = await tx.equipmentRental.create({
      data: {
        storeId,
        productId,
        customerId,
        status: RentalStatus.ACTIVE,
        expectedReturnDate: new Date(expectedReturnDate),
        securityDeposit: deposit,
        ratePerDay: dailyRate,
        ratePerWeek: ratePerWeek ? round2(toDec(ratePerWeek)) : null,
        ratePerMonth: ratePerMonth ? round2(toDec(ratePerMonth)) : null,
        totalRentalCharge: 0,
        lateFeeAccumulated: 0,
        notes: notes || null,
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

        await tx.stockMovement.create({
      data: {
        storeId,
        productId,
        movementType: StockMovementType.RENTAL_OUT,
        quantity: -1,
        referenceId: rental.id,
        notes: `Rental to ${customer.name}`,
        // AUDIT FIX (governance): session-derived identity (was `createdBy || null`
        // from the request body).
        performedBy: actorId,
      },
    });

        if (deposit > 0) {
      // AUDIT FIX (integration): read-latest-row lost-update race — derive the
      // running balance from the SUM of signed drawer amounts (same aggregate
      // pattern as cash-drawer/route.ts and the R6 remediation), never the
      // latest row's possibly-stale balance snapshot.
      const balanceAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId },
        _sum: { amount: true },
      });
      // Task 12-c: Decimal running balance (was `currentBalance + deposit`, a
      // number + Prisma-Decimal STRING concat). NOTE: CashDrawerLog is an
      // APPEND-ONLY ledger (no mutable balance row), so Prisma's atomic
      // increment/decrement does not apply — the SUM-derived derivation below
      // is the concurrency-safe equivalent (R6 pattern).
      const currentBalanceDec = toDec(balanceAgg._sum.amount ?? 0);

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          // AUDIT FIX (governance): session-derived identity (was `createdBy || 'system'`).
          userId: actorId,
          action: 'CASH_IN',
          amount: deposit,
          balance: round2(currentBalanceDec.plus(deposit)),
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
          // AUDIT FIX (governance): session-derived identity (was `createdBy || null`).
          createdBy: actorId,
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

    return { ok: true as const, rental };
  });

  if (!result.ok) {
    // Typed conflict: the atomic stock claim lost the race for the last unit.
    return Response.json(
      { success: false, error: 'Item not available for rental.' },
      { status: 409 }
    );
  }
  const rental = result.rental;

  await systemLog({
    action: 'RENTAL_CREATED',
    component: LogComponent.RENTAL,
    severity: LogSeverity.INFO,
    message: `Rental created: ${product.name} to ${customer.name}`,
    storeId,
    // AUDIT FIX (governance): audit actor from session (was body `createdBy`).
    userId: actorId,
    metadata: {
      rentalId: rental.id,
      productId,
      customerId,
      securityDeposit: deposit,
      ratePerDay: dailyRate,
    },
  });

  return Response.json({ success: true, data: rental }, { status: 201 });
}

export const GET = withErrorBoundary(withSessionAuth(getRentalsHandler), 'RENTALS_LIST');
export const POST = withErrorBoundary(withSessionAuth(createRentalHandler), 'RENTALS_CREATE');
