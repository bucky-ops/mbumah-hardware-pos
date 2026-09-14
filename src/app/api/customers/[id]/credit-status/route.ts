// Path: src/app/api/customers/[id]/credit-status/route.ts
// POST → suspend / reinstate / flag-default a customer's credit facility.
//
// Business impact (gap G3 from the audit — upstream had no credit status):
//   SUSPENDED / DEFAULTED customers are HARD-BLOCKED from new credit invoices
//   (see /api/invoices gate) and immediately surface as
//   "🔴 DO NOT EXTEND CREDIT" in the verdict engine.
//
// RBAC: OWNER or MANAGER only. A reason is mandatory and stored in the
// customer notes trail for collections audit.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator, requireRole } from '@/lib/api-helpers'
import { CreditApiError } from '@/lib/credit-service'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEFAULTED']),
  reason: z.string().trim().min(5, 'A reason (min 5 chars) is required for the audit trail').max(300),
  operatorId: z.string().min(1),
})

const AUDIT_PREFIX = '[CREDIT-STATUS]'

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const { status, reason, operatorId } = parsed.data

    const operator = await resolveOperator(operatorId)
    requireRole(operator, 'MANAGER', 'change a credit facility status')

    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')
    if (customer.creditStatus === status) {
      return fail(`Account is already ${status}`, 422, 'NO_CHANGE')
    }

    const stamp = `${AUDIT_PREFIX} ${new Date().toISOString()} — ${operator.name} (${operator.role}): ${customer.creditStatus} → ${status}. Reason: ${reason}`
    const updated = await db.customer.update({
      where: { id },
      data: {
        creditStatus: status,
        notes: customer.notes ? `${customer.notes}\n${stamp}` : stamp,
      },
    })

    return ok({
      customer: { id: updated.id, creditStatus: updated.creditStatus },
      message:
        status === 'ACTIVE'
          ? `${customer.name} reinstated — credit sales unblocked`
          : `${customer.name} is now ${status} — all credit sales blocked`,
    })
  } catch (err) {
    return handleError(err)
  }
}
