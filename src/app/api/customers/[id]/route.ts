// Path: src/app/api/customers/[id]/route.ts
// GET → Customer 360° credit profile: live assessment, invoices with
//       days-overdue, payments, ledger, limit-change approvals, reminders.
// PATCH → update contact details only (credit fields have dedicated routes).
//
// FIXES vs upstream: the upstream detail route returned static totals; here
// every number (outstanding/available/overdue/days) is derived from the same
// engine the verdict uses — one source of truth.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handleError, ok } from '@/lib/api-helpers'
import { loadCustomerAssessment } from '@/lib/credit-service'
import { daysOverdue, round2, toNumber } from '@/lib/credit-engine'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const { customer, invoices, payments, assessment } = await loadCustomerAssessment(id)

    const [ledger, limitChanges, reminders] = await Promise.all([
      db.creditLedgerEntry.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      db.creditLimitChange.findMany({
        where: { customerId: id },
        orderBy: { approvedAt: 'desc' },
      }),
      db.paymentReminder.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    const lastPaymentByInvoice = new Map<string, Date>()
    for (const p of payments) {
      if (!p.invoiceId) continue
      const prev = lastPaymentByInvoice.get(p.invoiceId)
      if (!prev || p.createdAt > prev) lastPaymentByInvoice.set(p.invoiceId, p.createdAt)
    }

    const invoiceViews = invoices
      .map((inv) => {
        const balance = round2(new Prisma.Decimal(inv.total).minus(inv.amountPaid))
        const late = balance.gt(0) ? daysOverdue(inv.dueDate) : 0
        return {
          id: inv.id,
          number: inv.number,
          subtotal: toNumber(inv.subtotal),
          discount: toNumber(inv.discount),
          vatAmount: toNumber(inv.vatAmount),
          total: toNumber(inv.total),
          amountPaid: toNumber(inv.amountPaid),
          balance: toNumber(balance),
          status: inv.status,
          issuedAt: inv.issuedAt.toISOString(),
          dueDate: inv.dueDate.toISOString(),
          daysOverdue: Math.max(0, late),
          overdue: balance.gt(0) && late > 0,
          notes: inv.notes,
        }
      })
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))

    return ok({
      customer: {
        id: customer.id,
        name: customer.name,
        type: customer.type,
        phone: customer.phone,
        email: customer.email,
        kraPin: customer.kraPin,
        address: customer.address,
        creditStatus: customer.creditStatus,
        notes: customer.notes,
        approvedByName: customer.approvedByName,
        approvedAt: customer.approvedAt,
        createdAt: customer.createdAt,
      },
      assessment,
      invoices: invoiceViews,
      payments: payments
        .slice()
        .reverse()
        .slice(0, 50)
        .map((p) => ({
          id: p.id,
          invoiceId: p.invoiceId,
          amount: toNumber(p.amount),
          method: p.method,
          reference: p.reference,
          note: p.note,
          receivedByName: p.receivedByName,
          createdAt: p.createdAt.toISOString(),
        })),
      ledger: ledger.map((l) => ({
        id: l.id,
        type: l.type,
        amount: toNumber(l.amount),
        balanceAfter: toNumber(l.balanceAfter),
        refType: l.refType,
        refId: l.refId,
        note: l.note,
        createdByName: l.createdByName,
        createdAt: l.createdAt.toISOString(),
      })),
      limitChanges: limitChanges.map((c) => ({
        id: c.id,
        oldLimit: toNumber(c.oldLimit),
        newLimit: toNumber(c.newLimit),
        reason: c.reason,
        approvedByName: c.approvedByName,
        approvedAt: c.approvedAt.toISOString(),
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        channel: r.channel,
        message: r.message,
        status: r.status,
        invoiceId: r.invoiceId,
        sentAt: r.sentAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?254|0)[17]\d{8}$/, 'Invalid Kenyan phone')
    .optional()
    .or(z.literal('')),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  kraPin: z
    .string()
    .trim()
    .regex(/^[A-Z]\d{9}[A-Z]$/i, 'KRA PIN format: A000000000Z')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const existing = await db.customer.findUnique({ where: { id } })
    if (!existing) return fail('Customer not found', 404, 'NOT_FOUND')

    const d = parsed.data
    const customer = await db.customer.update({
      where: { id },
      data: {
        ...(d.name ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
        ...(d.email !== undefined ? { email: d.email || null } : {}),
        ...(d.address !== undefined ? { address: d.address || null } : {}),
        ...(d.kraPin !== undefined ? { kraPin: d.kraPin ? d.kraPin.toUpperCase() : null } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
    })
    return ok({ customer })
  } catch (err) {
    return handleError(err)
  }
}
