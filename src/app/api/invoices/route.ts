// Path: src/app/api/invoices/route.ts
// POST → issue a CREDIT invoice (charge to the customer account).
// GET  → list invoices for a customer or the whole branch.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE CREDIT GATE — three layers, mirroring the upstream checkout defence:
//   L1 (engine verdict): if the customer's live verdict is DO_NOT_EXTEND the
//        sale is refused 403 unless a MANAGER+ supplies `override` + reason.
//   L2 (friendly pre-check inside the tx): headroom = limit − outstanding;
//        requested total > headroom → 422 with exact figures.
//   L3 (TOCTOU-proof claim): customer.updateMany({
//         where: { id, outstanding: { lte: headroom } },
//         data:  { outstanding: { increment: total } } })
//        The predicate is re-evaluated AT WRITE TIME — a concurrent charge
//        that slips past L2 makes count===0 and the WHOLE invoice rolls back.
// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL MATH: discount applied BEFORE 16% VAT (computeInvoiceTotals),
// Decimal exact end-to-end. Stock deduction is upstream-POS concern and
// intentionally out of scope for this module (documented in CREDIT_ENGINE.md).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator, requireRole } from '@/lib/api-helpers'
import { CreditApiError, nextInvoiceNumber, recomputeCustomerScore } from '@/lib/credit-service'
import {
  assessCredit,
  computeInvoiceTotals,
  daysOverdue,
  formatKES,
  round2,
  toNumber,
  type OpenInvoiceView,
} from '@/lib/credit-engine'

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Line description required').max(120),
  sku: z.string().trim().max(40).optional().or(z.literal('')),
  qty: z.number().positive('Quantity must be positive').max(100_000),
  unitPrice: z.number().min(0, 'Unit price cannot be negative').max(10_000_000),
})

const createSchema = z.object({
  customerId: z.string().min(1, 'customerId is required'),
  lines: z.array(lineSchema).min(1, 'At least one line item is required').max(100),
  discount: z.number().min(0).max(10_000_000).optional().default(0),
  termsDays: z.number().int().min(0, 'Terms cannot be negative').max(180).default(30),
  notes: z.string().trim().max(300).optional().or(z.literal('')),
  operatorId: z.string().optional(),
  /** MANAGER+ override when the verdict is DO_NOT_EXTEND (audited in notes). */
  override: z.boolean().optional().default(false),
  overrideReason: z.string().trim().max(300).optional().or(z.literal('')),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerId = searchParams.get('customerId')
    const where = customerId ? { customerId } : {}
    const invoices = await db.invoice.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 100,
      include: { customer: { select: { name: true } } },
    })
    return ok({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        customerName: inv.customer.name,
        total: toNumber(inv.total),
        amountPaid: toNumber(inv.amountPaid),
        balance: toNumber(round2(new Prisma.Decimal(inv.total).minus(inv.amountPaid))),
        status: inv.status,
        dueDate: inv.dueDate.toISOString(),
        daysOverdue: Math.max(0, daysOverdue(inv.dueDate)),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const { customerId, lines, discount, termsDays, notes, operatorId, override, overrideReason } =
      parsed.data

    const operator = await resolveOperator(operatorId ?? null)

    const result = await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } })
        if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')

        // ── Exact totals (Decimal; discount BEFORE 16% VAT) ──
        const totals = computeInvoiceTotals(
          lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
          discount,
        )

        // ── L1: verdict gate ──
        const invoices = await tx.invoice.findMany({ where: { customerId } })
        const payments = await tx.payment.findMany({ where: { customerId } })
        const openViews: OpenInvoiceView[] = invoices
          .map((inv) => ({
            id: inv.id,
            number: inv.number,
            balance: round2(new Prisma.Decimal(inv.total).minus(inv.amountPaid)),
            dueDate: inv.dueDate,
          }))
          .filter((v) => (v.balance as Prisma.Decimal).gt(0))
        const assessment = assessCredit({
          name: customer.name,
          type: customer.type,
          phone: customer.phone,
          creditStatus: customer.creditStatus,
          creditLimit: customer.creditLimit,
          outstanding: customer.outstanding,
          openInvoices: openViews,
          settledInvoices: invoices
            .filter((i) => i.status === 'PAID')
            .map(() => ({ daysLate: 0 })), // deep history irrelevant to the gate
          lifetimeRevenue: invoices.reduce((s, i) => s.plus(i.total), new Prisma.Decimal(0)),
          firstInvoiceAt: invoices.length ? invoices[0].issuedAt : null,
        })

        const verdictCode = assessment.verdict.code
        if (verdictCode === 'DO_NOT_EXTEND' || customer.creditStatus !== 'ACTIVE') {
          if (!override) {
            throw new CreditApiError(
              403,
              'CREDIT_BLOCKED',
              `${assessment.verdict.label}: ${assessment.verdict.reasons[0]} — a MANAGER may override with a documented reason`,
            )
          }
          requireRole(operator, 'MANAGER', 'override a DO-NOT-EXTEND verdict')
          if (!overrideReason || overrideReason.length < 5) {
            throw new CreditApiError(
              422,
              'OVERRIDE_REASON_REQUIRED',
              'Overriding a DO-NOT-EXTEND verdict requires an overrideReason (min 5 chars)',
            )
          }
        }

        const limit = round2(new Prisma.Decimal(customer.creditLimit))
        const outstanding = round2(new Prisma.Decimal(customer.outstanding))
        const headroom = round2(limit.minus(outstanding))
        if (totals.total.gt(headroom)) {
          throw new CreditApiError(
            422,
            'CREDIT_LIMIT_EXCEEDED',
            `Requested ${formatKES(totals.total)} exceeds available credit ${formatKES(headroom)} (limit ${formatKES(limit)} − outstanding ${formatKES(outstanding)})`,
          )
        }

        // ── Create invoice + items ──
        const number = await nextInvoiceNumber(tx)
        const dueDate = new Date(Date.now() + termsDays * 86_400_000)
        const invoice = await tx.invoice.create({
          data: {
            branchId: customer.branchId,
            customerId,
            number,
            subtotal: totals.subtotal,
            discount: totals.discount,
            vatAmount: totals.vatAmount,
            total: totals.total,
            status: 'UNPAID',
            termsDays,
            dueDate,
            notes:
              notes ||
              (override
                ? `OVERRIDE by ${operator.name}: ${overrideReason}`
                : null),
            items: {
              create: lines.map((l) => ({
                description: l.description,
                sku: l.sku || null,
                qty: new Prisma.Decimal(l.qty),
                unitPrice: new Prisma.Decimal(l.unitPrice),
                lineTotal: round2(new Prisma.Decimal(l.qty).times(new Prisma.Decimal(l.unitPrice))),
              })),
            },
          },
        })

        // ── L3: TOCTOU-proof conditional claim ──
        // After the increment the balance must still respect the limit:
        //   outstanding' = outstanding + total ≤ limit  ⇔  outstanding ≤ limit − total.
        // The predicate is re-evaluated AT WRITE TIME, so any concurrent charge
        // that slipped past the L2 pre-check makes count===0 and rolls the
        // whole invoice back atomically.
        const claim = await tx.customer.updateMany({
          where: { id: customerId, outstanding: { lte: round2(limit.minus(totals.total)) } },
          data: { outstanding: { increment: totals.total } },
        })
        if (claim.count === 0) {
          throw new CreditApiError(
            409,
            'CREDIT_LIMIT_RACE',
            'Credit utilisation changed concurrently — invoice rolled back atomically, retry with refreshed figures',
          )
        }

        await tx.creditLedgerEntry.create({
          data: {
            branchId: customer.branchId,
            customerId,
            type: 'CHARGE',
            amount: totals.total,
            balanceAfter: round2(outstanding.plus(totals.total)),
            refType: 'INVOICE',
            refId: invoice.id,
            note: `${number} — ${lines.length} line(s), terms ${termsDays}d`,
            createdById: operator.id,
            createdByName: operator.name,
          },
        })

        await recomputeCustomerScore(tx, customerId)

        return {
          invoice: {
            id: invoice.id,
            number,
            total: toNumber(totals.total),
            subtotal: toNumber(totals.subtotal),
            vatAmount: toNumber(totals.vatAmount),
            dueDate: dueDate.toISOString(),
          },
          newOutstanding: toNumber(round2(outstanding.plus(totals.total))),
          newAvailable: toNumber(round2(limit.minus(outstanding).minus(totals.total))),
        }
      },
      { timeout: 15_000 },
    )

    return ok(
      {
        ...result,
        message: `${result.invoice.number} issued for ${formatKES(result.invoice.total)} — outstanding now ${formatKES(result.newOutstanding)} (available ${formatKES(result.newAvailable)})`,
      },
      201,
    )
  } catch (err) {
    return handleError(err)
  }
}
