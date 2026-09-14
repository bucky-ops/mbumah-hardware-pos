// Path: src/app/api/customers/[id]/repay/route.ts
// POST → record a customer payment using the OLDEST-FIRST WATERFALL.
//
// FIXES gap G8 from the audit (upstream /api/debt was per-row only and
// REJECTED overpayment with a 400): a single payment here automatically
// settles arrears in strict due-date order across ALL open invoices.
//
// ATOMICITY (all-or-nothing inside one $transaction):
//   1. Re-read the customer + open invoices INSIDE the transaction.
//   2. Allocate via the pure waterfall engine (oldest dueDate first).
//   3. Per slice: increment invoice.amountPaid, flip status UNPAID→PARTIAL→PAID,
//      write a Payment row (method/reference/receivedBy).
//   4. Decrement customer.outstanding with a CONDITIONAL claim
//      (where outstanding >= applied) — re-evaluated at write time, so a
//      concurrent charge cannot push the balance negative (drift → abort).
//   5. Append a signed CreditLedgerEntry with the resulting balance.
//   6. Recompute the credit score from the fresh payment record.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator } from '@/lib/api-helpers'
import { CreditApiError, recomputeCustomerScore } from '@/lib/credit-service'
import { allocateWaterfall, formatKES, round2, type WaterfallTarget } from '@/lib/credit-engine'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  amount: z.number().positive('Amount must be greater than zero').max(100_000_000),
  method: z.enum(['CASH', 'MPESA', 'BANK', 'CHEQUE']),
  reference: z.string().trim().max(60).optional().or(z.literal('')),
  note: z.string().trim().max(300).optional().or(z.literal('')),
  operatorId: z.string().optional(),
  /** When false, amounts exceeding the total debt are rejected. */
  allowOverpay: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const { amount, method, reference, note, operatorId, allowOverpay } = parsed.data

    const operator = await resolveOperator(operatorId ?? null)
    const amountD = round2(new Prisma.Decimal(amount))

    const result = await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } })
        if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')

        const openInvoices = await tx.invoice.findMany({
          where: { customerId: id, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
        })

        const targets: WaterfallTarget[] = openInvoices
          .map((inv) => ({
            id: inv.id,
            number: inv.number,
            balance: round2(new Prisma.Decimal(inv.total).minus(inv.amountPaid)),
            dueDate: inv.dueDate,
          }))
          .filter((t) => (t.balance as Prisma.Decimal).gt(0))

        const totalDebt = targets.reduce((s, t) => s.plus(t.balance as Prisma.Decimal), new Prisma.Decimal(0))
        if (totalDebt.lte(0)) {
          throw new CreditApiError(422, 'NO_OPEN_DEBT', `${customer.name} has no outstanding invoices`)
        }
        if (amountD.gt(totalDebt)) {
          if (!allowOverpay) {
            throw new CreditApiError(
              422,
              'EXCEEDS_DEBT',
              `Payment ${formatKES(amountD)} exceeds the total debt ${formatKES(totalDebt)} by ${formatKES(amountD.minus(totalDebt))} — reduce the amount or pass allowOverpay`,
            )
          }
        }

        const plan = allocateWaterfall(targets, amountD)
        if (plan.applied.lte(0)) {
          throw new CreditApiError(422, 'NOTHING_ALLOCATED', 'Payment could not be allocated to any invoice')
        }

        const now = new Date()
        // Per-slice: settle the invoice + write the payment row.
        for (const slice of plan.slices) {
          const applied = new Prisma.Decimal(slice.applied)
          const inv = openInvoices.find((i) => i.id === slice.invoiceId)!
          const newPaid = round2(new Prisma.Decimal(inv.amountPaid).plus(applied))
          const newStatus = newPaid.gte(new Prisma.Decimal(inv.total)) ? 'PAID' : 'PARTIAL'
          await tx.invoice.update({
            where: { id: inv.id },
            data: { amountPaid: newPaid, status: newStatus },
          })
          await tx.payment.create({
            data: {
              branchId: customer.branchId,
              customerId: id,
              invoiceId: inv.id,
              amount: applied,
              method,
              reference: reference || null,
              note: note || null,
              receivedById: operator.id,
              receivedByName: operator.name,
              createdAt: now,
            },
          })
        }

        // Conditional decrement — drift-proof against concurrent charges.
        const claim = await tx.customer.updateMany({
          where: { id, outstanding: { gte: plan.applied } },
          data: { outstanding: { decrement: plan.applied } },
        })
        if (claim.count === 0) {
          throw new CreditApiError(
            409,
            'BALANCE_DRIFT',
            'Outstanding balance changed concurrently — payment aborted, no partial state written',
          )
        }

        const newOutstanding = round2(new Prisma.Decimal(customer.outstanding).minus(plan.applied))
        await tx.creditLedgerEntry.create({
          data: {
            branchId: customer.branchId,
            customerId: id,
            type: 'PAYMENT',
            amount: plan.applied.negated(),
            balanceAfter: newOutstanding,
            refType: 'PAYMENT',
            note:
              note ||
              `${method}${reference ? ` ref ${reference}` : ''} — waterfall across ${plan.slices.length} invoice(s)`,
            createdById: operator.id,
            createdByName: operator.name,
            createdAt: now,
          },
        })

        await recomputeCustomerScore(tx, id)

        return {
          applied: plan.applied.toNumber(),
          creditBalance: plan.creditBalance.toNumber(),
          newOutstanding: newOutstanding.toNumber(),
          slices: plan.slices,
          customerName: customer.name,
        }
      },
      { timeout: 15_000 },
    )

    return ok({
      ...result,
      message: `${formatKES(result.applied)} received from ${result.customerName} — ${result.slices.length} invoice(s) settled via waterfall`,
    })
  } catch (err) {
    return handleError(err)
  }
}
