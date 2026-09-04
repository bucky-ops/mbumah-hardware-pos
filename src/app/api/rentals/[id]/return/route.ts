// POST /api/rentals/[id]/return

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, RentalStatus, StockMovementType } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';
import { getSessionFromRequest } from '@/lib/auth';
// Task 12-c: canonical financial math (HALF_UP 2dp). Prisma Decimal
// `valueOf()` returns a STRING — `rentalDays * rental.ratePerDay` and
// `rental.securityDeposit - totalCharges` coerced through float (and the
// charge line fed a Decimal into a number-typed helper).
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function processRentalReturnHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const {
    damageAssessment,
    damageCharge,
    notes,
    // SYS-2: actor identity from the authenticated session (body ignored).
    processedBy: _bodyProcessedBy,
  } = body;

  // Validate rental exists
  const rental = await db.equipmentRental.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, sku: true, costPrice: true } },
      customer: { select: { id: true, name: true, phone: true } },
      store: { select: { id: true, name: true, organizationId: true } },
    },
  });

  if (!rental) {
    return Response.json(
      { success: false, error: 'Rental not found.' },
      { status: 404 }
    );
  }

  if (rental.status !== RentalStatus.ACTIVE && rental.status !== RentalStatus.OVERDUE) {
    return Response.json(
      { success: false, error: `Cannot return a rental with status: ${rental.status}` },
      { status: 400 }
    );
  }

  const session = await getSessionFromRequest(request);
  const processedBy = session?.userId || null;
  void _bodyProcessedBy; // body value ignored by design (spoofable actor)

  const actualReturnDate = new Date();
  const rentalStartDate = new Date(rental.rentalStartDate);
  const expectedReturnDate = new Date(rental.expectedReturnDate);

    const rentalDurationMs = actualReturnDate.getTime() - rentalStartDate.getTime();
  // Days are integers derived from the date difference (unchanged formula).
  const rentalDays = Math.max(1, Math.ceil(rentalDurationMs / (1000 * 60 * 60 * 24)));

    // Task 12-c: Decimal money math.
  // totalRentalCharge = round2(days × ratePerDay) — was float coercion of the
  // Prisma Decimal rate.
  const totalRentalCharge = round2(toDec(rentalDays).mul(toDec(rental.ratePerDay)));

  // lateFee = round2(daysLate × lateFeeRate) — inline Decimal re-derivation of
  // helpers.calculateLateFee's formula (floor of full late days, floored at 0),
  // which also removes the old Decimal-into-number-arg type error.
  const daysLate = Math.max(0, Math.floor(
    (actualReturnDate.getTime() - expectedReturnDate.getTime()) / (1000 * 60 * 60 * 24)
  ));
  const lateFee = round2(toDec(daysLate).mul(toDec(rental.ratePerDay)));

    const assessedDamage = damageAssessment || 'NONE';
  const assessedDamageCharge = round2(toDec(damageCharge || 0));

    let returnStatus: string = RentalStatus.RETURNED;
  if (assessedDamage !== 'NONE') {
    returnStatus = assessedDamage === 'SEVERE' ? RentalStatus.LOST : RentalStatus.DAMAGED;
  }

  // Task 12-c: charges and settlement in exact Decimal. NO max0 clamp is
  // applied to the settlement — the existing logic intentionally branches on
  // the sign (negative ⇒ CUSTOMER_OWES, positive ⇒ REFUND_DUE).
  const totalChargesDec = toDec(totalRentalCharge).plus(lateFee).plus(assessedDamageCharge);
  const totalCharges = round2(totalChargesDec);
  const settlementDec = toDec(rental.securityDeposit).minus(totalChargesDec);
  const settlement = round2(settlementDec);

    const orgId = rental.store.organizationId;
  const accounts = await getAccountIds(orgId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.RENTAL_DEPOSITS_HELD,
    ACCOUNT_CODES.RENTAL_REVENUE,
    ACCOUNT_CODES.LATE_FEE_REVENUE,
  ]);

  const result = await db.$transaction(async (tx) => {
    // R8 remediation: ATOMIC status claim — the old code checked status
    // BEFORE the transaction and then updated unconditionally, so two
    // concurrent returns both passed and double-credited stock.
    const claimed = await tx.equipmentRental.updateMany({
      where: { id, status: { in: [RentalStatus.ACTIVE, RentalStatus.OVERDUE] } },
      data: { status: returnStatus },
    });
    if (claimed.count === 0) {
      throw Object.assign(new Error('Rental already returned (concurrent request).'), { statusCode: 409 });
    }

        const updatedRental = await tx.equipmentRental.update({
      where: { id },
      data: {
        status: returnStatus,
        actualReturnDate,
        totalRentalCharge,
        lateFeeAccumulated: lateFee,
        damageAssessment: assessedDamage !== 'NONE' ? assessedDamage : null,
        damageCharge: assessedDamageCharge,
        notes: notes ? `${rental.notes || ''}\nReturn: ${notes}` : rental.notes,
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

        // R8/F3-7 remediation: a LOST (destroyed) rental must NOT return to
    // sellable stock — previously SEVERE damage outcomes restocked the unit.
    if (returnStatus !== RentalStatus.LOST) {
      await tx.product.update({
        where: { id: rental.productId },
        data: { quantityInStock: { increment: 1 } },
      });

      await tx.stockMovement.create({
        data: {
          storeId: rental.storeId,
          productId: rental.productId,
          movementType: StockMovementType.RENTAL_RETURN,
          quantity: 1,
          referenceId: rental.id,
          notes: `Rental return - ${rental.product.name}`,
          performedBy: processedBy || null,
        },
      });
    }

        if (settlementDec.isNegative()) {
            // Task 12-c: exact Decimal abs (was Math.abs over a coerced float).
      const amountOwedDec = settlementDec.abs();
      const amountOwed = round2(amountOwedDec);
      // R6 remediation: SUM-derived drawer balance (concurrency-safe).
      const drawerAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId: rental.storeId },
        _sum: { amount: true },
      });
      // Task 12-c: Decimal running balance.
      const drawerBalanceDec = toDec(drawerAgg._sum.amount ?? 0);

      await tx.cashDrawerLog.create({
        data: {
          storeId: rental.storeId,
          userId: processedBy || 'system',
          action: 'CASH_IN',
          amount: amountOwed,
          balance: round2(drawerBalanceDec.plus(amountOwed)),
          notes: `Additional rental charge from ${rental.customer.name} - ${rental.product.name}`,
        },
      });

      // Journal entry for additional charge
      const jeNumber = generateJournalEntryNumber();
      await tx.journalEntry.create({
        data: {
          storeId: rental.storeId,
          entryNumber: jeNumber,
          description: `Rental settlement - additional charges from ${rental.customer.name}`,
          referenceType: 'RENTAL',
          referenceId: rental.id,
          // F3-7 remediation: the damage charge is now INCLUDED on the
          // credit side — previously debits exceeded credits by exactly the
          // damage amount, corrupting the GL on every damaged return.
          // Task 12-c: exact Decimal sums for the JE headers (were float
          // `amountOwed + Number(rental.securityDeposit)`).
          totalDebit: round2(amountOwedDec.plus(rental.securityDeposit)),
          totalCredit: totalCharges,
          isPosted: true,
          postedAt: new Date(),
          createdBy: processedBy || null,
          lines: {
            create: [
              {
                accountId: accounts.CASH_ON_HAND,
                debit: amountOwed,
                credit: 0,
                description: 'Additional rental charges received',
              },
              {
                accountId: accounts.RENTAL_DEPOSITS_HELD,
                debit: rental.securityDeposit,
                credit: 0,
                description: 'Release security deposit held',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: totalRentalCharge,
                description: `Rental revenue for ${rentalDays} days`,
              },
              {
                accountId: accounts.LATE_FEE_REVENUE,
                debit: 0,
                credit: lateFee,
                description: lateFee > 0 ? `Late fee revenue` : 'No late fee',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: assessedDamageCharge,
                description: 'Damage charge assessed at return',
              },
            ],
          },
        },
      });
    } else if (settlementDec.gt(0)) {
            // R6 remediation: SUM-derived drawer balance (concurrency-safe).
      const drawerAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId: rental.storeId },
        _sum: { amount: true },
      });
      // Task 12-c: Decimal running balance.
      const drawerBalanceDec = toDec(drawerAgg._sum.amount ?? 0);

      await tx.cashDrawerLog.create({
        data: {
          storeId: rental.storeId,
          userId: processedBy || 'system',
          action: 'CASH_OUT',
          amount: settlement,
          balance: round2(drawerBalanceDec.minus(settlement)),
          notes: `Refund excess deposit to ${rental.customer.name} - ${rental.product.name}`,
        },
      });

      // Journal entry for settlement
      const jeNumber = generateJournalEntryNumber();
      await tx.journalEntry.create({
        data: {
          storeId: rental.storeId,
          entryNumber: jeNumber,
          description: `Rental settlement - refund to ${rental.customer.name}`,
          referenceType: 'RENTAL',
          referenceId: rental.id,
          // F3-7: damage charge included in the credit side.
          // Task 12-c: exact Decimal JE header (was
          // `settlement + totalRentalCharge + lateFee + assessedDamageCharge`).
          totalDebit: round2(toDec(rental.securityDeposit)),
          totalCredit: totalCharges,
          isPosted: true,
          postedAt: new Date(),
          createdBy: processedBy || null,
          lines: {
            create: [
              {
                accountId: accounts.RENTAL_DEPOSITS_HELD,
                debit: rental.securityDeposit,
                credit: 0,
                description: 'Release security deposit held',
              },
              {
                accountId: accounts.CASH_ON_HAND,
                debit: 0,
                credit: settlement,
                description: 'Refund excess deposit',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: totalRentalCharge,
                description: `Rental revenue for ${rentalDays} days`,
              },
              {
                accountId: accounts.LATE_FEE_REVENUE,
                debit: 0,
                credit: lateFee,
                description: lateFee > 0 ? 'Late fee revenue' : 'No late fee',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: assessedDamageCharge,
                description: 'Damage charge assessed at return',
              },
            ],
          },
        },
      });
    } else {
            const jeNumber = generateJournalEntryNumber();
      await tx.journalEntry.create({
        data: {
          storeId: rental.storeId,
          entryNumber: jeNumber,
          description: `Rental settlement - exact match for ${rental.customer.name}`,
          referenceType: 'RENTAL',
          referenceId: rental.id,
          totalDebit: round2(toDec(rental.securityDeposit)),
          totalCredit: totalCharges,
          isPosted: true,
          postedAt: new Date(),
          createdBy: processedBy || null,
          lines: {
            create: [
              {
                accountId: accounts.RENTAL_DEPOSITS_HELD,
                debit: rental.securityDeposit,
                credit: 0,
                description: 'Release security deposit held',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: totalRentalCharge,
                description: `Rental revenue for ${rentalDays} days`,
              },
              {
                accountId: accounts.LATE_FEE_REVENUE,
                debit: 0,
                credit: lateFee,
                description: lateFee > 0 ? 'Late fee revenue' : 'No late fee',
              },
              {
                accountId: accounts.RENTAL_REVENUE,
                debit: 0,
                credit: assessedDamageCharge,
                description: 'Damage charge assessed at return',
              },
            ],
          },
        },
      });
    }

    return updatedRental;
  });

  await systemLog({
    action: 'RENTAL_RETURNED',
    component: LogComponent.RENTAL,
    severity: LogSeverity.INFO,
    message: `Rental returned: ${rental.product.name} from ${rental.customer.name}. Days: ${rentalDays}, Charges: KES ${totalCharges.toLocaleString()}, Late fee: KES ${lateFee.toLocaleString()}`,
    storeId: rental.storeId,
    userId: processedBy || undefined,
    metadata: {
      rentalId: id,
      rentalDays,
      totalRentalCharge,
      lateFee,
      damageCharge: assessedDamageCharge,
      settlement,
      returnStatus,
    },
  });

  return Response.json({
    success: true,
    data: {
      rental: result,
      returnSummary: {
        rentalDays,
        totalRentalCharge,
        lateFee,
        damageCharge: assessedDamageCharge,
        totalCharges,
        securityDeposit: round2(rental.securityDeposit),
        settlement,
        // Task 12-c: sign branches on the exact Decimal (was float coercion).
        settlementType: settlementDec.isNegative() ? 'CUSTOMER_OWES' : settlementDec.gt(0) ? 'REFUND_DUE' : 'EXACT',
        settlementAmount: round2(settlementDec.abs()),
      },
    },
  });
}

export const POST = withErrorBoundary(withSessionAuth(processRentalReturnHandler), 'RENTAL_RETURN');
