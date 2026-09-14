// Path: src/lib/credit-client.ts
// Typed client for the Customer Credit Engine API (browser side).

export interface Verdict {
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

export interface AgingCell {
  bucket: string
  label: string
  amount: number
  count: number
}

export interface CustomerSummary {
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
    verdict: Verdict
    aging: AgingCell[]
  }
}

export interface PortfolioKpis {
  customerCount: number
  totalReceivables: number
  totalOverdue: number
  totalCreditLimit: number
  availablePortfolio: number
  suspendedCount: number
  avgScore: number
}

export interface Overview {
  empty?: boolean
  branch?: { id: string; name: string; code: string }
  kpis: PortfolioKpis | null
  agingByBucket?: Record<string, number>
  verdictCounts?: Record<string, number>
  watchlist?: CustomerSummary[]
  entries?: CustomerSummary[]
}

export interface InvoiceView {
  id: string
  number: string
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  amountPaid: number
  balance: number
  status: string
  issuedAt: string
  dueDate: string
  daysOverdue: number
  overdue: boolean
  notes: string | null
}

export interface Customer360 {
  customer: {
    id: string
    name: string
    type: string
    phone: string | null
    email: string | null
    kraPin: string | null
    address: string | null
    creditStatus: string
    notes: string | null
    approvedByName: string | null
    approvedAt: string | null
    createdAt: string
  }
  assessment: CustomerSummary['assessment'] & { creditScore: number; riskBand: string; onTimeRatePct: number }
  invoices: InvoiceView[]
  payments: Array<{
    id: string
    invoiceId: string | null
    amount: number
    method: string
    reference: string | null
    note: string | null
    receivedByName: string
    createdAt: string
  }>
  ledger: Array<{
    id: string
    type: string
    amount: number
    balanceAfter: number
    refType: string | null
    refId: string | null
    note: string | null
    createdByName: string
    createdAt: string
  }>
  limitChanges: Array<{
    id: string
    oldLimit: number
    newLimit: number
    reason: string
    approvedByName: string
    approvedAt: string
  }>
  reminders: Array<{
    id: string
    channel: string
    message: string
    status: string
    invoiceId: string | null
    sentAt: string | null
    createdAt: string
  }>
}

export interface OperatorInfo {
  id: string
  name: string
  role: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message: string; code: string } }
  if (!res.ok || !json.ok) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`)
  }
  return json.data as T
}

export const creditApi = {
  overview: () => request<Overview>('/api/credit/overview'),
  seed: (force: boolean) =>
    request<{ seeded: boolean; message?: string }>('/api/seed', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  seedStatus: () => request<{ seeded: boolean }>('/api/seed'),
  customer360: (id: string) => request<Customer360>(`/api/customers/${id}`),
  repay: (id: string, body: Record<string, unknown>) =>
    request<{ message: string; applied: number; slices: Array<{ invoiceNumber: string; applied: number; balanceAfter: number }> }>(
      `/api/customers/${id}/repay`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  createInvoice: (body: Record<string, unknown>) =>
    request<{ message: string; invoice: { number: string; total: number } }>('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  changeLimit: (id: string, body: Record<string, unknown>) =>
    request<{ message: string }>(`/api/customers/${id}/credit-limit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  changeStatus: (id: string, body: Record<string, unknown>) =>
    request<{ message: string }>(`/api/customers/${id}/credit-status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remind: (id: string, body: Record<string, unknown>) =>
    request<{ message: string; preview?: Record<string, string> }>(`/api/customers/${id}/remind`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createCustomer: (body: Record<string, unknown>) =>
    request<{ customer: { id: string; name: string } }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

/** KES money formatting (client mirror of the engine's formatKES). */
export function kes(amount: number): string {
  const n = Math.round((amount ?? 0) * 100) / 100
  return (
    'KES ' +
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  )
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Client-side waterfall preview (mirrors engine order: oldest due first). */
export interface WaterfallPreviewSlice {
  number: string
  applied: number
  balanceAfter: number
  dueDate: string
}

export function previewWaterfall(
  openInvoices: InvoiceView[],
  amount: number,
): { slices: WaterfallPreviewSlice[]; applied: number; exceeds: number } {
  let remaining = Math.round(amount * 100) / 100
  const slices: WaterfallPreviewSlice[] = []
  const open = openInvoices
    .filter((i) => i.balance > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  for (const inv of open) {
    if (remaining <= 0) break
    const pay = Math.min(inv.balance, remaining)
    slices.push({
      number: inv.number,
      applied: pay,
      balanceAfter: Math.round((inv.balance - pay) * 100) / 100,
      dueDate: inv.dueDate,
    })
    remaining = Math.round((remaining - pay) * 100) / 100
  }
  const applied = slices.reduce((s, x) => s + x.applied, 0)
  return { slices, applied, exceeds: Math.max(0, Math.round((amount - applied) * 100) / 100) }
}
