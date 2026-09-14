// Path: src/lib/credit-engine.ts
// Mbumah Hardware POS — Customer Credit Engine (pure, testable domain logic)
//
// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL MATH DISCIPLINE
// ═══════════════════════════════════════════════════════════════════════════
// All money math uses Prisma.Decimal (decimal.js shipped with @prisma/client)
// — NEVER floating point. Rounding is HALF_UP at 2dp. Invoice totals follow
// Kenyan VAT law ordering: discount is applied BEFORE 16% VAT:
//     Taxable Subtotal = (Unit Price × Qty) − Discount
//     VAT              = Taxable Subtotal × 0.16
//     Grand Total      = Taxable Subtotal + VAT
// ═══════════════════════════════════════════════════════════════════════════
// VERDICT ENGINE — precedence (first match wins):
//   1. creditStatus SUSPENDED / DEFAULTED            → DO NOT EXTEND CREDIT
//   2. available credit ≤ 0                          → DO NOT EXTEND CREDIT (limit exhausted)
//   3. utilisation ≥ 95%                             → DO NOT EXTEND CREDIT (limit reached)
//   4. overdue balance > 0 aged 61+ days             → DO NOT EXTEND CREDIT
//   5. overdue balance > 0 (≤ 60 days)               → RESTRICTED — SETTLE OVERDUE
//   6. utilisation ≥ 80%                             → CAUTION — NEAR LIMIT
//   7. score ≥ 75, no overdue                        → GOOD STANDING
//   8. no invoices on file                           → NEW — PROVISIONAL
//   9. otherwise                                     → STANDARD
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from '@prisma/client'

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ZERO = new Prisma.Decimal(0)
export const VAT_RATE = new Prisma.Decimal('0.16')

// ── Decimal helpers ─────────────────────────────────────────────────────────

export function toDecimal(value: unknown): Prisma.Decimal {
  return new Prisma.Decimal(String(value ?? 0))
}

/** Round to 2dp HALF_UP — the single rounding rule for money. */
export function round2(value: Prisma.Decimal.Value): Prisma.Decimal {
  return D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Human money: "KES 384,500" (no trailing .00), exact via Decimal. */
export function formatKES(value: Prisma.Decimal.Value): string {
  const n = round2(value).toNumber()
  return (
    'KES ' +
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  )
}

/** Numeric KES for charts/client props (values are exact 2dp → safe as number). */
export function toNumber(value: Prisma.Decimal.Value): number {
  return round2(value).toNumber()
}

// ── Nairobi calendar-day math ───────────────────────────────────────────────
// Business day boundaries are Africa/Nairobi (+03:00, no DST). We compare
// calendar DATES, not 24h ticks, so a debt due "today 23:00" is not overdue.

const NAIROBI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function nairobiDayKey(date: Date): string {
  return NAIROBI_DATE_FMT.format(date) // YYYY-MM-DD
}

/** Midnight-UTC Date of the Nairobi calendar day for a given instant. */
export function nairobiDay(date: Date = new Date()): Date {
  const [y, m, d] = nairobiDayKey(date).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Whole calendar days (Nairobi) from `dueDate` to `now`. Positive = overdue. */
export function daysOverdue(dueDate: Date, now: Date = new Date()): number {
  const diffMs = nairobiDay(now).getTime() - nairobiDay(dueDate).getTime()
  return Math.round(diffMs / 86_400_000)
}

// ── Aging buckets ───────────────────────────────────────────────────────────

export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export const AGING_LABEL: Record<AgingBucket, string> = {
  CURRENT: 'Not yet due',
  D1_30: '1–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: '90+ days',
}

export function agingBucket(daysLate: number): AgingBucket {
  if (daysLate <= 0) return 'CURRENT'
  if (daysLate <= 30) return 'D1_30'
  if (daysLate <= 60) return 'D31_60'
  if (daysLate <= 90) return 'D61_90'
  return 'D90_PLUS'
}

const BUCKET_SEVERITY: Record<AgingBucket, number> = {
  CURRENT: 0,
  D1_30: 6,
  D31_60: 12,
  D61_90: 18,
  D90_PLUS: 25,
}

// ── Core aggregate shape (what the API assembles for one customer) ──────────

export interface OpenInvoiceView {
  id: string
  number: string
  balance: Prisma.Decimal
  dueDate: Date
}

export interface SettledInvoiceView {
  daysLate: number // 0 = paid on/before due date
}

export interface CreditAggregateInput {
  name: string
  type: string
  phone: string | null
  creditStatus: string // ACTIVE | SUSPENDED | DEFAULTED
  creditLimit: Prisma.Decimal.Value
  outstanding: Prisma.Decimal.Value
  openInvoices: OpenInvoiceView[]
  settledInvoices: SettledInvoiceView[]
  lifetimeRevenue: Prisma.Decimal.Value
  firstInvoiceAt: Date | null
}

export interface CustomerCreditAssessment {
  creditLimit: number
  outstanding: number
  availableCredit: number
  overdueAmount: number
  maxDaysOverdue: number
  utilizationPct: number
  aging: Array<{ bucket: AgingBucket; label: string; amount: number; count: number }>
  worstBucket: AgingBucket
  creditScore: number
  riskBand: 'LOW' | 'MEDIUM' | 'HIGH' | 'NEW'
  verdict: CreditVerdict
  openCount: number
  onTimeRatePct: number
}

export interface CreditVerdict {
  code:
    | 'DO_NOT_EXTEND'
    | 'CREDIT_EXHAUSTED'
    | 'RESTRICTED'
    | 'CAUTION'
    | 'GOOD_STANDING'
    | 'NEW_CUSTOMER'
    | 'STANDARD'
  label: string
  dot: string
  tone: 'rose' | 'amber' | 'emerald' | 'slate'
  reasons: string[]
}

// ── Overdue + aging assembly ────────────────────────────────────────────────

export function assessCredit(input: CreditAggregateInput, now: Date = new Date()): CustomerCreditAssessment {
  const limit = round2(input.creditLimit)
  const outstanding = round2(input.outstanding)
  const available = round2(limit.minus(outstanding).lt(0) ? 0 : limit.minus(outstanding))

  // Per-invoice aging for OPEN invoices (balance > 0 and due date passed).
  let overdue = ZERO
  let maxDays = 0
  const agingTotals = new Map<AgingBucket, { amount: Prisma.Decimal; count: number }>()
  for (const b of AGING_BUCKETS) agingTotals.set(b, { amount: ZERO, count: 0 })
  let currentOpen = ZERO
  let openCount = 0

  for (const inv of input.openInvoices) {
    const bal = round2(inv.balance)
    if (bal.lte(0)) continue
    openCount += 1
    const late = daysOverdue(inv.dueDate, now)
    if (late > 0) {
      overdue = overdue.plus(bal)
      if (late > maxDays) maxDays = late
      const b = agingBucket(late)
      const cell = agingTotals.get(b)!
      cell.amount = cell.amount.plus(bal)
      cell.count += 1
    } else {
      currentOpen = currentOpen.plus(bal)
    }
  }
  if (currentOpen.gt(0)) {
    const cell = agingTotals.get('CURRENT')!
    cell.amount = cell.amount.plus(currentOpen)
    cell.count += 1
  }

  const aging = AGING_BUCKETS.map((b) => ({
    bucket: b,
    label: AGING_LABEL[b],
    amount: toNumber(agingTotals.get(b)!.amount),
    count: agingTotals.get(b)!.count,
  }))

  const worstBucket: AgingBucket =
    maxDays > 0 ? agingBucket(maxDays) : currentOpen.gt(0) ? 'CURRENT' : 'CURRENT'

  const utilization =
    limit.gt(0) ? round2(outstanding.dividedBy(limit).times(100)) : new Prisma.Decimal(0)

  const score = computeCreditScore(input, overdue.gt(0) ? worstBucket : 'CURRENT', now)

  const verdict = deriveVerdict({
    creditStatus: input.creditStatus,
    limit,
    outstanding,
    available,
    overdue,
    maxDays,
    utilizationPct: utilization,
    score,
    hasHistory: input.settledInvoices.length > 0 || input.openInvoices.length > 0,
  })

  const settled = input.settledInvoices.length
  const onTime = settled === 0 ? 0 : input.settledInvoices.filter((s) => s.daysLate <= 0).length

  return {
    creditLimit: toNumber(limit),
    outstanding: toNumber(outstanding),
    availableCredit: toNumber(available),
    overdueAmount: toNumber(overdue),
    maxDaysOverdue: maxDays,
    utilizationPct: toNumber(utilization),
    aging,
    worstBucket,
    creditScore: score,
    riskBand: scoreBand(score, input.settledInvoices.length, input.openInvoices.length),
    verdict,
    openCount,
    onTimeRatePct: settled === 0 ? 0 : Math.round((onTime / settled) * 100),
  }
}

// ── Credit score (0–100, higher = safer to lend) ────────────────────────────
// Weights: payment record 35 · aging severity 25 · utilisation 20 · tenure/volume 20

export function computeCreditScore(
  input: CreditAggregateInput,
  worstOverdueBucket: AgingBucket,
  now: Date = new Date(),
): number {
  const hasAnyHistory = input.settledInvoices.length > 0 || input.openInvoices.length > 0
  if (!hasAnyHistory) return 55 // NEW customer — neutral provisional score

  // 1) Payment record (0–35)
  let onTimePoints: number
  const settled = input.settledInvoices
  if (settled.length === 0) {
    onTimePoints = 17.5 // no settled invoices yet — neutral
  } else {
    const onTimeRatio = settled.filter((s) => s.daysLate <= 0).length / settled.length
    const lateSettled = settled.filter((s) => s.daysLate > 0)
    const avgLate =
      lateSettled.length === 0
        ? 0
        : lateSettled.reduce((a, s) => a + s.daysLate, 0) / lateSettled.length
    onTimePoints = onTimeRatio * 35
    if (avgLate > 45) onTimePoints *= 0.4
    else if (avgLate > 15) onTimePoints *= 0.7
  }

  // 2) Aging severity (0–25) — penalised in proportion to how much of the
  //    outstanding balance is already overdue, scaled by the worst bucket.
  const outstanding = round2(input.outstanding)
  let agingPoints = 25
  if (worstOverdueBucket !== 'CURRENT' && outstanding.gt(0)) {
    let overdueTotal = ZERO
    for (const inv of input.openInvoices) {
      const late = daysOverdue(inv.dueDate, now)
      if (late > 0 && round2(inv.balance).gt(0)) overdueTotal = overdueTotal.plus(round2(inv.balance))
    }
    const share = Math.min(1, toNumber(overdueTotal.dividedBy(outstanding)))
    agingPoints = Math.max(0, 25 - BUCKET_SEVERITY[worstOverdueBucket] * share)
  }

  // 3) Utilisation (0–20)
  const limit = round2(input.creditLimit)
  const utilPoints =
    limit.lte(0)
      ? 10
      : toNumber(outstanding.dividedBy(limit)) < 0.3
        ? 20
        : toNumber(outstanding.dividedBy(limit)) < 0.6
          ? 15
          : toNumber(outstanding.dividedBy(limit)) < 0.8
            ? 10
            : toNumber(outstanding.dividedBy(limit)) < 0.95
              ? 4
              : 0

  // 4) Tenure + lifetime volume (0–20)
  const monthsActive = input.firstInvoiceAt
    ? Math.min(24, Math.max(0, (now.getTime() - input.firstInvoiceAt.getTime()) / (30.44 * 86_400_000)))
    : 0
  const tenurePoints = (monthsActive / 24) * 8
  const lifetime = toNumber(round2(input.lifetimeRevenue))
  const volumePoints = Math.min(1, lifetime / 1_000_000) * 12

  const score = Math.round(onTimePoints + agingPoints + utilPoints + tenurePoints + volumePoints)
  return Math.min(100, Math.max(1, score))
}

export function scoreBand(score: number, settledCount: number, openCount: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'NEW' {
  if (settledCount === 0 && openCount === 0) return 'NEW'
  if (score >= 75) return 'LOW'
  if (score >= 55) return 'MEDIUM'
  return 'HIGH'
}

// ── Verdict engine ──────────────────────────────────────────────────────────

interface VerdictInput {
  creditStatus: string
  limit: Prisma.Decimal
  outstanding: Prisma.Decimal
  available: Prisma.Decimal
  overdue: Prisma.Decimal
  maxDays: number
  utilizationPct: Prisma.Decimal
  score: number
  hasHistory: boolean
}

export function deriveVerdict(v: VerdictInput): CreditVerdict {
  if (v.creditStatus === 'SUSPENDED') {
    return {
      code: 'DO_NOT_EXTEND',
      label: 'DO NOT EXTEND CREDIT',
      dot: '🔴',
      tone: 'rose',
      reasons: ['Credit facility SUSPENDED — all credit sales blocked until reinstated'],
    }
  }
  if (v.creditStatus === 'DEFAULTED') {
    return {
      code: 'DO_NOT_EXTEND',
      label: 'DO NOT EXTEND CREDIT',
      dot: '🔴',
      tone: 'rose',
      reasons: ['Account flagged DEFAULTED — refer to management for recovery action'],
    }
  }
  if (v.available.lte(0) && v.limit.gt(0)) {
    return {
      code: 'CREDIT_EXHAUSTED',
      label: 'DO NOT EXTEND CREDIT',
      dot: '🔴',
      tone: 'rose',
      reasons: ['Credit limit exhausted — 100% utilisation, zero available credit'],
    }
  }
  if (v.limit.gt(0) && toNumber(v.utilizationPct) >= 95) {
    return {
      code: 'DO_NOT_EXTEND',
      label: 'DO NOT EXTEND CREDIT',
      dot: '🔴',
      tone: 'rose',
      reasons: [
        `Credit limit reached (${round2(v.utilizationPct).toNumber().toFixed(1)}% utilisation) — only ${formatKES(v.available)} headroom remains`,
      ],
    }
  }
  if (v.overdue.gt(0) && v.maxDays > 60) {
    return {
      code: 'DO_NOT_EXTEND',
      label: 'DO NOT EXTEND CREDIT',
      dot: '🔴',
      tone: 'rose',
      reasons: [
        `${formatKES(v.overdue)} is ${v.maxDays} days overdue (61+ day bucket) — collections escalation required`,
      ],
    }
  }
  if (v.overdue.gt(0)) {
    return {
      code: 'RESTRICTED',
      label: 'RESTRICTED — SETTLE OVERDUE',
      dot: '🟠',
      tone: 'amber',
      reasons: [
        `${formatKES(v.overdue)} overdue by up to ${v.maxDays} day(s) — settle arrears before further credit`,
      ],
    }
  }
  if (toNumber(v.utilizationPct) >= 80) {
    return {
      code: 'CAUTION',
      label: 'CAUTION — NEAR LIMIT',
      dot: '🟡',
      tone: 'amber',
      reasons: [
        `Utilisation at ${round2(v.utilizationPct).toNumber().toFixed(1)}% — monitor closely, no new large charges`,
      ],
    }
  }
  if (v.score >= 75) {
    return {
      code: 'GOOD_STANDING',
      label: 'GOOD STANDING',
      dot: '🟢',
      tone: 'emerald',
      reasons: [`Strong payment record (score ${v.score}/100), no overdue balance`],
    }
  }
  if (!v.hasHistory) {
    return {
      code: 'NEW_CUSTOMER',
      label: 'NEW — PROVISIONAL',
      dot: '⚪',
      tone: 'slate',
      reasons: ['No credit history on file — provisional limit, review after first cycle'],
    }
  }
  return {
    code: 'STANDARD',
    label: 'STANDARD',
    dot: '🟢',
    tone: 'emerald',
    reasons: ['Account in order — routine monitoring applies'],
  }
}

// ── The requested status-card output ────────────────────────────────────────
// Matches the requested shape exactly:
//   🔴 JOHN CONTRACTORS LTD
//   Outstanding: KES 384,500
//   Credit limit: KES 400,000
//   Overdue: KES 92,000
//   Status: DO NOT EXTEND CREDIT

export function formatCreditStatusCard(a: CustomerCreditAssessment, name: string): string {
  const v = a.verdict
  return [
    `${v.dot} ${name.toUpperCase()}`,
    `Outstanding: ${formatKES(a.outstanding)}`,
    `Credit limit: ${formatKES(a.creditLimit)}`,
    `Overdue: ${formatKES(a.overdueAmount)}`,
    `Status: ${v.label}`,
  ].join('\n')
}

// ── Waterfall payment allocation (oldest due date first) ────────────────────

export interface WaterfallTarget {
  id: string
  number: string
  balance: Prisma.Decimal.Value
  dueDate: Date
}

export interface WaterfallSlice {
  invoiceId: string
  invoiceNumber: string
  applied: number
  balanceBefore: number
  balanceAfter: number
  dueDate: string
}

/**
 * Allocate `amount` across open invoices, oldest due first (FIFO waterfall).
 * Pure function — the API applies the returned slices inside a $transaction.
 * Remainder (amount exceeds total debt) is surfaced as `creditBalance`.
 */
export function allocateWaterfall(
  targets: WaterfallTarget[],
  amount: Prisma.Decimal.Value,
  now: Date = new Date(),
): { slices: WaterfallSlice[]; applied: Prisma.Decimal; creditBalance: Prisma.Decimal } {
  let remaining = round2(amount)
  const ordered = [...targets]
    .filter((t) => round2(t.balance).gt(0))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  const slices: WaterfallSlice[] = []
  let applied = ZERO

  for (const t of ordered) {
    if (remaining.lte(0)) break
    const balBefore = round2(t.balance)
    const pay = balBefore.lt(remaining) ? balBefore : remaining
    if (pay.lte(0)) continue
    slices.push({
      invoiceId: t.id,
      invoiceNumber: t.number,
      applied: toNumber(pay),
      balanceBefore: toNumber(balBefore),
      balanceAfter: toNumber(balBefore.minus(pay)),
      dueDate: t.dueDate.toISOString(),
    })
    applied = applied.plus(pay)
    remaining = remaining.minus(pay)
  }

  return { slices, applied: round2(applied), creditBalance: round2(remaining) }
}

// ── Invoice math (discount BEFORE VAT — Kenyan 16% VAT) ─────────────────────

export interface InvoiceLineInput {
  qty: Prisma.Decimal.Value
  unitPrice: Prisma.Decimal.Value
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal
  discount: Prisma.Decimal
  taxableSubtotal: Prisma.Decimal
  vatAmount: Prisma.Decimal
  total: Prisma.Decimal
}

/**
 * Order of operations (Kenyan 16% VAT): discount first, VAT on the net amount.
 *   Taxable = (Σ qty×price) − discount ; VAT = Taxable × 0.16 ; Total = Taxable + VAT
 */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  discount: Prisma.Decimal.Value = 0,
): InvoiceTotals {
  let gross = ZERO
  for (const l of lines) gross = gross.plus(D(l.qty).times(D(l.unitPrice)))
  const subtotal = round2(gross)
  const discountAmount = round2(D(discount).lt(0) ? 0 : D(discount).gt(subtotal) ? subtotal : D(discount))
  const taxableSubtotal = round2(subtotal.minus(discountAmount))
  const vatAmount = round2(taxableSubtotal.times(VAT_RATE))
  const total = round2(taxableSubtotal.plus(vatAmount))
  return { subtotal, discount: discountAmount, taxableSubtotal, vatAmount, total }
}
