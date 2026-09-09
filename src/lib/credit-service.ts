// Path: src/lib/credit-service.ts
// Server-side service layer for the Customer Credit Engine.
// Bridges Prisma queries and the pure domain logic in credit-engine.ts.
//
// SECURITY NOTE (production): every exported function takes `branchId` from
// the authenticated session (upstream repo: `requireStoreAccess` → session
// storeId). The sandbox demo passes the seeded branch; wire the session guard
// in the repo per SECURITY_REPORT.md §BOLA.

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  assessCredit,
  computeCreditScore,
  daysOverdue,
  round2,
  toNumber,
  type CreditAggregateInput,
  type CustomerCreditAssessment,
  type OpenInvoiceView,
  type SettledInvoiceView,
} from '@/lib/credit-engine'

export class CreditApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Rows needed to score one customer. */
type InvoiceRow = {
  id: string
  number: string
  total: Prisma.Decimal
  amountPaid: Prisma.Decimal
  dueDate: Date
  issuedAt: Date
  status: string
}

type PaymentRow = { invoiceId: string | null; createdAt: Date }

function buildAggregate(
  customer: {
    name: string
    type: string
    phone: string | null
    creditStatus: string
    creditLimit: Prisma.Decimal
    outstanding: Prisma.Decimal
  },
  invoices: InvoiceRow[],
  payments: PaymentRow[],
): { input: CreditAggregateInput; assessment: CustomerCreditAssessment } {
  const paidAtByInvoice = new Map<string, Date>()
  for (const p of payments) {
    if (!p.invoiceId) continue
    const prev = paidAtByInvoice.get(p.invoiceId)
    if (!prev || p.createdAt > prev) paidAtByInvoice.set(p.invoiceId, p.createdAt)
  }

  const openInvoices: OpenInvoiceView[] = []
  const settledInvoices: SettledInvoiceView[] = []
  let lifetimeRevenue = new Prisma.Decimal(0)
  let firstInvoiceAt: Date | null = null

  for (const inv of invoices) {
    lifetimeRevenue = lifetimeRevenue.plus(inv.total)
    if (!firstInvoiceAt || inv.issuedAt < firstInvoiceAt) firstInvoiceAt = inv.issuedAt
    const balance = round2(inv.total.minus(inv.amountPaid))
    if (inv.status === 'PAID' || balance.lte(0)) {
      const paidAt = paidAtByInvoice.get(inv.id)
      const late = paidAt ? Math.max(0, daysOverdue(inv.dueDate, paidAt)) : 0
      settledInvoices.push({ daysLate: late })
    } else {
      openInvoices.push({ id: inv.id, number: inv.number, balance, dueDate: inv.dueDate })
    }
  }

  const input: CreditAggregateInput = {
    name: customer.name,
    type: customer.type,
    phone: customer.phone,
    creditStatus: customer.creditStatus,
    creditLimit: customer.creditLimit,
    outstanding: customer.outstanding,
    openInvoices,
    settledInvoices,
    lifetimeRevenue,
    firstInvoiceAt,
  }
  return { input, assessment: assessCredit(input) }
}

/** Full assessment for one customer (loads invoices + payments). */
export async function loadCustomerAssessment(customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({ where: { customerId }, orderBy: [{ issuedAt: 'asc' }] }),
    db.payment.findMany({ where: { customerId }, orderBy: [{ createdAt: 'asc' }] }),
  ])
  const { assessment } = buildAggregate(customer, invoices, payments)
  return { customer, invoices, payments, assessment }
}

/** Recompute and persist cached score/risk band. Safe inside a transaction via `tx`. */
export async function recomputeCustomerScore(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<number> {
  const customer = await tx.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new CreditApiError(404, 'NOT_FOUND', 'Customer not found')
  const invoices = await tx.invoice.findMany({ where: { customerId } })
  const payments = await tx.payment.findMany({ where: { customerId } })
  const { input, assessment } = buildAggregate(customer, invoices, payments)
  const score = computeCreditScore(input, assessment.worstBucket)
  const band =
    invoices.length === 0 ? 'NEW' : score >= 75 ? 'LOW' : score >= 55 ? 'MEDIUM' : 'HIGH'
  await tx.customer.update({
    where: { id: customerId },
    data: { creditScore: score, riskBand: band },
  })
  return score
}

export interface DirectoryEntry {
  id: string
  name: string
  type: string
  phone: string | null
  creditStatus: string
  creditScore: number
  riskBand: string
  assessment: {
    creditLimit: number
    outstanding: number
    availableCredit: number
    overdueAmount: number
    maxDaysOverdue: number
    utilizationPct: number
    worstBucket: string
    openCount: number
    onTimeRatePct: number
    verdict: {
      code: string
      label: string
      dot: string
      tone: string
      reasons: string[]
    }
    aging: Array<{ bucket: string; label: string; amount: number; count: number }>
  }
}

const VERDICT_SEVERITY: Record<string, number> = {
  DO_NOT_EXTEND: 0,
  CREDIT_EXHAUSTED: 1,
  RESTRICTED: 2,
  CAUTION: 3,
  STANDARD: 4,
  NEW_CUSTOMER: 5,
  GOOD_STANDING: 6,
}

/** Full branch portfolio: per-customer assessments + KPIs + aging + watchlist. */
export async function loadPortfolio(branchId: string) {
  const [customers, invoices, payments] = await Promise.all([
    db.customer.findMany({ where: { branchId }, orderBy: { name: 'asc' } }),
    db.invoice.findMany({
      where: { branchId },
      orderBy: { issuedAt: 'asc' },
      select: {
        id: true,
        customerId: true,
        number: true,
        total: true,
        amountPaid: true,
        dueDate: true,
        issuedAt: true,
        status: true,
      },
    }),
    db.payment.findMany({
      where: { branchId },
      select: { invoiceId: true, createdAt: true, customerId: true },
    }),
  ])

  const byCustomer = new Map<string, InvoiceRow[]>()
  for (const inv of invoices) {
    const list = byCustomer.get(inv.customerId) ?? []
    list.push({ ...inv, total: new Prisma.Decimal(inv.total), amountPaid: new Prisma.Decimal(inv.amountPaid) })
    byCustomer.set(inv.customerId, list)
  }
  const payByCustomer = new Map<string, PaymentRow[]>()
  for (const p of payments) {
    const list = payByCustomer.get(p.customerId) ?? []
    list.push(p)
    payByCustomer.set(p.customerId, list)
  }

  const entries: DirectoryEntry[] = []
  for (const c of customers) {
    const { assessment } = buildAggregate(c, byCustomer.get(c.id) ?? [], payByCustomer.get(c.id) ?? [])
    entries.push({
      id: c.id,
      name: c.name,
      type: c.type,
      phone: c.phone,
      creditStatus: c.creditStatus,
      creditScore: assessment.creditScore,
      riskBand: assessment.riskBand,
      assessment: {
        creditLimit: assessment.creditLimit,
        outstanding: assessment.outstanding,
        availableCredit: assessment.availableCredit,
        overdueAmount: assessment.overdueAmount,
        maxDaysOverdue: assessment.maxDaysOverdue,
        utilizationPct: assessment.utilizationPct,
        worstBucket: assessment.worstBucket,
        openCount: assessment.openCount,
        onTimeRatePct: assessment.onTimeRatePct,
        verdict: assessment.verdict,
        aging: assessment.aging,
      },
    })
  }

  // ── Portfolio KPIs ──
  const totalReceivables = entries.reduce((s, e) => s + e.assessment.outstanding, 0)
  const totalOverdue = entries.reduce((s, e) => s + e.assessment.overdueAmount, 0)
  const totalLimit = entries.reduce((s, e) => s + e.assessment.creditLimit, 0)
  const availablePortfolio = entries.reduce((s, e) => s + e.assessment.availableCredit, 0)
  const suspendedCount = entries.filter((e) => e.creditStatus !== 'ACTIVE').length
  const scored = entries.filter((e) => e.riskBand !== 'NEW')
  const avgScore =
    scored.length === 0 ? 0 : Math.round(scored.reduce((s, e) => s + e.creditScore, 0) / scored.length)

  const agingByBucket: Record<string, number> = {
    CURRENT: 0,
    D1_30: 0,
    D31_60: 0,
    D61_90: 0,
    D90_PLUS: 0,
  }
  for (const e of entries) for (const b of e.assessment.aging) agingByBucket[b.bucket] += b.amount

  const verdictCounts: Record<string, number> = {}
  for (const e of entries) {
    verdictCounts[e.assessment.verdict.code] = (verdictCounts[e.assessment.verdict.code] ?? 0) + 1
  }

  const watchlist = [...entries]
    .sort(
      (a, b) =>
        (VERDICT_SEVERITY[a.assessment.verdict.code] ?? 9) -
          (VERDICT_SEVERITY[b.assessment.verdict.code] ?? 9) ||
        b.assessment.overdueAmount - a.assessment.overdueAmount,
    )
    .slice(0, 6)

  return {
    kpis: {
      customerCount: entries.length,
      totalReceivables: Math.round(totalReceivables * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      totalCreditLimit: Math.round(totalLimit * 100) / 100,
      availablePortfolio: Math.round(availablePortfolio * 100) / 100,
      suspendedCount,
      avgScore,
    },
    agingByBucket,
    verdictCounts,
    watchlist,
    entries,
  }
}

/** Generate the next invoice number INV-YYYY-NNNN inside a transaction. */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const count = await tx.invoice.count()
  const seq = String(count + 1).padStart(4, '0')
  return `${prefix}${seq}`
}
