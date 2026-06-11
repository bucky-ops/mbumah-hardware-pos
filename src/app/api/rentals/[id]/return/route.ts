/**
 * MBUMAH HARDWARE POS - Rental Return API
 * POST /api/rentals/[id]/return - Process rental return with late fee calculation
 *
 * Flow:
 * 1. Validate rental exists and is active/overdue
 * 2. Calculate total rental charges based on actual rental duration
 * 3. Calculate late fees if returned after expected date
 * 4. Assess damage charges if applicable
 * 5. Calculate final settlement (deposit - charges + fees)
 * 6. Return stock to inventory
 * 7. Create journal entries
 * 8. Update rental status
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { calculateLateFee, generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, RentalStatus, StockMovementType } from '@/lib/types';

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
    processedBy,
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

  const actualReturnDate = new Date();
  const rentalStartDate = new Date(rental.rentalStartDate);
  const expectedReturnDate = new Date(rental.expectedReturnDate);

  // Calculate rental duration in days
  const rentalDurationMs = actualReturnDate.getTime() - rentalStartDate.getTime();
  const rentalDays = Math.max(1, Math.ceil(rentalDurationMs / (1000 * 60 * 60 * 24)));

  // Calculate total rental charge
  const totalRentalCharge = rentalDays * rental.ratePerDay;

  // Calculate late fee
  const lateFee = calculateLateFee(rental.ratePerDay, expectedReturnDate, actualReturnDate);

  // Damage charges
  const assessedDamage = damageAssessment || 'NONE';
  const assessedDamageCharge = parseFloat(String(damageCharge || 0));

  // Determine final status
  let returnStatus: string = RentalStatus.RETURNED;
  if (assessedDamage !== 'NONE') {
    returnStatus = assessedDamage === 'SEVERE' ? RentalStatus.LOST : RentalStatus.DAMAGED;
  }

  // Calculate settlement
  const totalCharges = totalRentalCharge + lateFee + assessedDamageCharge;
  const settlement = rental.securityDeposit - totalCharges;

  // Resolve account IDs
  const orgId = rental.store.organizationId;
  const accounts = await getAccountIds(orgId, [
    ACCOUNT_CODES.CASH_ON_HAND,
    ACCOUNT_CODES.RENTAL_DEPOSITS_HELD,
    ACCOUNT_CODES.RENTAL_REVENUE,
    ACCOUNT_CODES.LATE_FEE_REVENUE,
  ]);

  const result = await db.$transaction(async (tx) => {
    // Update the rental record
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

    // Return stock to inventory
    await tx.product.update({
      where: { id: rental.productId },
      data: { quantityInStock: { increment: 1 } },
    });

    // Create stock movement for return
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

    // Handle settlement through cash drawer
    if (settlement < 0) {
      // Customer owes additional money
      const amountOwed = Math.abs(settlement);
      const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
        where: { storeId: rental.storeId },
        orderBy: { createdAt: 'desc' },
      });
      const currentBalance = lastDrawerEntry?.balance || 0;

      await tx.cashDrawerLog.create({
        data: {
          storeId: rental.storeId,
          userId: processedBy || 'system',
          action: 'CASH_IN',
          amount: amountOwed,
          balance: currentBalance + amountOwed,
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
          totalDebit: amountOwed + rental.securityDeposit,
          totalCredit: totalRentalCharge + lateFee,
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
            ],
          },
        },
      });
    } else if (settlement > 0) {
      // Refund excess deposit to customer
      const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
        where: { storeId: rental.storeId },
        orderBy: { createdAt: 'desc' },
      });
      const currentBalance = lastDrawerEntry?.balance || 0;

      await tx.cashDrawerLog.create({
        data: {
          storeId: rental.storeId,
          userId: processedBy || 'system',
          action: 'CASH_OUT',
          amount: settlement,
          balance: currentBalance - settlement,
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
          totalDebit: rental.securityDeposit,
          totalCredit: settlement + totalRentalCharge + lateFee,
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
            ],
          },
        },
      });
    } else {
      // Exact match - deposit equals charges
      const jeNumber = generateJournalEntryNumber();
      await tx.journalEntry.create({
        data: {
          storeId: rental.storeId,
          entryNumber: jeNumber,
          description: `Rental settlement - exact match for ${rental.customer.name}`,
          referenceType: 'RENTAL',
          referenceId: rental.id,
          totalDebit: rental.securityDeposit,
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
        securityDeposit: rental.securityDeposit,
        settlement,
        settlementType: settlement < 0 ? 'CUSTOMER_OWES' : settlement > 0 ? 'REFUND_DUE' : 'EXACT',
        settlementAmount: Math.abs(settlement),
      },
    },
  });
}

export const POST = withErrorBoundary(processRentalReturnHandler, 'RENTAL_RETURN');
