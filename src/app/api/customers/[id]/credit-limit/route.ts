// Path: src/app/api/customers/[id]/credit-limit/route.ts
// POST → credit-limit change WITH approval trail (the "approved by" feature).
//
// Governance rules implemented here (gap G2 from the audit):
//  1. Approver must be MANAGER or OWNER.
//  2. A MANAGER cannot approve their own request (segregation of duties);
//     the OWNER may self-approve.
//  3. Every change writes an immutable CreditLimitChange row
//     (old → new, reason, requester, approver, timestamp).
//  4. The customer's approvedBy/at stamps are updated so the 360° view always
//     shows who granted the CURRENT limit.
//  5. Reducing a limit below the current outstanding balance is allowed only
//     with an explicit `acknowledgeExposure` flag — the engine never silently
//     strands a customer over their limit.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator, requireRole } from '@/lib/api-helpers'
import { CreditApiError, recomputeCustomerScore } from '@/lib/credit-service'
import { formatKES } from '@/lib/credit-engine'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  newLimit: z.number().min(0, 'Limit cannot be negative').max(50_000_000),
  reason: z.string().trim().min(5, 'A reason (min 5 chars) is required for audit').max(300),
  approverId: z.string().min(1, 'Approver identity is required'),
  /** Set true to accept newLimit < outstanding (collections mode). */
  acknowledgeExposure: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const { newLimit, reason, approverId, acknowledgeExposure } = parsed.data

    const approver = await resolveOperator(approverId)
    requireRole(approver, 'MANAGER', 'approve a credit-limit change')

    const result = await db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } })
      if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')

      const oldLimit = new Prisma.Decimal(customer.creditLimit)
      const newLimitD = new Prisma.Decimal(newLimit)
      if (newLimitD.eq(oldLimit)) {
        throw new CreditApiError(422, 'NO_CHANGE', 'New limit equals the current limit')
      }

      // Segregation of duties: managers cannot approve their own raise.
      if (approver.role === 'MANAGER' && approver.id === customer.approvedById && newLimitD.gt(oldLimit)) {
        throw new CreditApiError(
          409,
          'SELF_APPROVAL_BLOCKED',
          'A manager cannot raise their own previously-approved limit — request OWNER approval',
        )
      }

      const outstanding = new Prisma.Decimal(customer.outstanding)
      if (newLimitD.lt(outstanding) && !acknowledgeExposure) {
        throw new CreditApiError(
          422,
          'EXPOSURE_ACK_REQUIRED',
          `New limit ${formatKES(newLimitD)} is below the outstanding balance ${formatKES(outstanding)} — pass acknowledgeExposure=true to accept the exposure`,
        )
      }

      await tx.creditLimitChange.create({
        data: {
          customerId: id,
          oldLimit,
          newLimit: newLimitD,
          reason,
          requestedById: approver.id,
          requestedByName: approver.name,
          approvedById: approver.id,
          approvedByName: approver.name,
        },
      })

      const updated = await tx.customer.update({
        where: { id },
        data: {
          creditLimit: newLimitD,
          approvedById: approver.id,
          approvedByName: approver.name,
          approvedAt: new Date(),
        },
      })

      await recomputeCustomerScore(tx, id)
      return updated
    })

    return ok({
      customer: { id: result.id, creditLimit: result.creditLimit.toNumber() },
      message: `Limit changed to ${formatKES(newLimit)} — approved by ${approver.name} (${approver.role})`,
    })
  } catch (err) {
    return handleError(err)
  }
}
