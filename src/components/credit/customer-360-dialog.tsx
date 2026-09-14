// Path: src/components/credit/customer-360-dialog.tsx
// Customer 360° credit profile — the flagship view.
// Top: the status card in the exact requested output format
// (dot · name / Outstanding / Credit limit / Overdue / Status: …).
// Then metrics, actions and inner tabs: Invoices · Payments · Ledger ·
// Approvals · Reminders.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  BellRing,
  CircleCheck,
  ClipboardList,
  Coins,
  FileSpreadsheet,
  History,
  ReceiptText,
  Scale,
  ShoppingCart,
  UserRound,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { RecordPaymentDialog, NewSaleDialog } from '@/components/credit/action-dialogs'
import { LimitDialog, StatusDialog, RemindDialog } from '@/components/credit/governance-dialogs'
import { ScoreBadge, StatusDot, VerdictBadge } from '@/components/credit/ui-bits'
import {
  creditApi,
  fmtDate,
  fmtDateTime,
  kes,
  type Customer360,
  type OperatorInfo,
} from '@/lib/credit-client'
import { cn } from '@/lib/utils'

const TONE_RING: Record<string, string> = {
  rose: 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30',
  amber: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  emerald: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30',
  slate: 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900',
}

export function Customer360Dialog({
  customerId,
  operator,
  operators,
  onClose,
  onChanged,
}: {
  customerId: string
  operator: OperatorInfo
  operators: OperatorInfo[]
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<Customer360 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<
    'pay' | 'sale' | 'limit' | 'status' | 'remind' | null
  >(null)

  const load = useCallback(async () => {
    try {
      const d = await creditApi.customer360(customerId)
      setData(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    void load()
  }, [load])

  const changed = () => {
    void load()
    onChanged()
  }

  const a = data?.assessment

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] w-[96vw]! max-w-[960px]! overflow-y-auto p-0">
        {error && (
          <div className="p-8 text-center">
            <p className="text-sm text-rose-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {!data || !a || loading ? (
          <div className="space-y-4 p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Loading customer profile</DialogTitle>
            </DialogHeader>
            <Skeleton className="h-36 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Customer 360° — {data.customer.name}</DialogTitle>
            </DialogHeader>

            {/* ── The requested status card ── */}
            <div className={cn('rounded-xl border-2 p-4', TONE_RING[a.verdict.tone])}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                    <span aria-hidden className="text-2xl leading-none">{a.verdict.dot}</span>
                    <span className="uppercase">{data.customer.name}</span>
                    <StatusDot status={data.customer.creditStatus} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.customer.type === 'COMPANY' ? 'Company' : 'Individual'} ·{' '}
                    {data.customer.phone ?? 'no phone'}
                    {data.customer.kraPin ? ` · PIN ${data.customer.kraPin}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Status
                  </p>
                  <p
                    className={cn(
                      'text-sm font-extrabold',
                      a.verdict.tone === 'rose'
                        ? 'text-rose-700 dark:text-rose-400'
                        : a.verdict.tone === 'amber'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    {a.verdict.label}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatusMetric label="Outstanding" value={kes(a.outstanding)} strong />
                <StatusMetric label="Credit limit" value={kes(a.creditLimit)} />
                <StatusMetric
                  label="Overdue"
                  value={kes(a.overdueAmount)}
                  sub={a.overdueAmount > 0 ? `${a.maxDaysOverdue} days` : 'clear'}
                  tone={a.overdueAmount > 0 ? 'rose' : 'emerald'}
                />
                <StatusMetric
                  label="Available"
                  value={kes(a.availableCredit)}
                  tone={a.availableCredit <= 0 ? 'rose' : 'emerald'}
                />
              </div>

              <ul className="mt-3 space-y-1">
                {a.verdict.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Scale className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Score + approval meta ── */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ScoreBadge score={a.creditScore} band={a.riskBand} />
              <Badge variant="outline">On-time settlements {a.onTimeRatePct}%</Badge>
              <Badge variant="outline">Open invoices {a.openCount}</Badge>
              {data.customer.approvedByName && (
                <Badge variant="outline" className="gap-1">
                  <UserRound className="h-3 w-3" aria-hidden />
                  Limit approved by {data.customer.approvedByName}
                  {data.customer.approvedAt ? ` · ${fmtDate(data.customer.approvedAt)}` : ''}
                </Badge>
              )}
            </div>

            {/* ── Actions ── */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={a.outstanding <= 0}
                onClick={() => setAction('pay')}
              >
                <Coins className="mr-1 h-4 w-4" aria-hidden /> Record payment
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAction('sale')}>
                <ShoppingCart className="mr-1 h-4 w-4" aria-hidden /> New credit sale
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={a.outstanding <= 0}
                onClick={() => setAction('remind')}
              >
                <BellRing className="mr-1 h-4 w-4" aria-hidden /> Send reminder
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAction('limit')}>
                <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden /> Adjust limit
              </Button>
              <Button
                size="sm"
                variant={data.customer.creditStatus === 'ACTIVE' ? 'destructive' : 'outline'}
                onClick={() => setAction('status')}
              >
                {data.customer.creditStatus === 'ACTIVE' ? (
                  <>
                    <Ban className="mr-1 h-4 w-4" aria-hidden /> Suspend credit
                  </>
                ) : (
                  <>
                    <CircleCheck className="mr-1 h-4 w-4" aria-hidden /> Reinstate credit
                  </>
                )}
              </Button>
            </div>

            {/* ── History tabs ── */}
            <Tabs defaultValue="invoices" className="mt-4">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="invoices">
                  <ReceiptText className="mr-1 h-3.5 w-3.5" aria-hidden /> Invoices ({data.invoices.length})
                </TabsTrigger>
                <TabsTrigger value="payments">
                  <Coins className="mr-1 h-3.5 w-3.5" aria-hidden /> Payments ({data.payments.length})
                </TabsTrigger>
                <TabsTrigger value="ledger">
                  <ClipboardList className="mr-1 h-3.5 w-3.5" aria-hidden /> Ledger ({data.ledger.length})
                </TabsTrigger>
                <TabsTrigger value="approvals">
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" aria-hidden /> Approvals ({data.limitChanges.length})
                </TabsTrigger>
                <TabsTrigger value="reminders">
                  <History className="mr-1 h-3.5 w-3.5" aria-hidden /> Reminders ({data.reminders.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-2">
                <div className="max-h-80 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-muted-foreground dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2">Issued</th>
                        <th className="px-3 py-2">Due</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                        <th className="px-3 py-2">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{inv.number}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(inv.issuedAt)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(inv.dueDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kes(inv.total)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {kes(inv.balance)}
                          </td>
                          <td className="px-3 py-2">
                            {inv.status === 'PAID' ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">PAID</Badge>
                            ) : inv.overdue ? (
                              <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                                OVERDUE {inv.daysOverdue}d
                              </Badge>
                            ) : inv.status === 'PARTIAL' ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200">PARTIAL</Badge>
                            ) : (
                              <Badge variant="outline">Open</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                      {data.invoices.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                            No invoices yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="mt-2">
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {data.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tabular-nums">{kes(p.amount)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.method}
                          {p.reference ? ` · ref ${p.reference}` : ''} · {p.receivedByName} ·{' '}
                          {fmtDateTime(p.createdAt)}
                        </p>
                      </div>
                      <Badge variant="outline">{p.method}</Badge>
                    </div>
                  ))}
                  {data.payments.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ledger" className="mt-2">
                <div className="max-h-80 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-muted-foreground dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                        <th className="px-3 py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(l.createdAt)}</td>
                          <td className="px-3 py-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                l.type === 'PAYMENT' && 'border-emerald-200 text-emerald-700',
                                l.type === 'CHARGE' && 'border-slate-300',
                                l.type === 'PENALTY' && 'border-rose-200 text-rose-700',
                              )}
                            >
                              {l.type}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 text-right font-semibold tabular-nums',
                              Number(l.amount) < 0 ? 'text-emerald-600' : '',
                            )}
                          >
                            {Number(l.amount) < 0 ? '−' : '+'}
                            {kes(Math.abs(Number(l.amount)))}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{kes(l.balanceAfter)}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground">
                            {l.note}
                          </td>
                        </tr>
                      ))}
                      {data.ledger.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                            Ledger is empty.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="approvals" className="mt-2">
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {data.limitChanges.map((c) => (
                    <div key={c.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold tabular-nums">
                          {kes(c.oldLimit)} <span aria-hidden>→</span> {kes(c.newLimit)}
                        </p>
                        <Badge variant="outline">{fmtDate(c.approvedAt)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.reason} — approved by <strong>{c.approvedByName}</strong>
                      </p>
                    </div>
                  ))}
                  {data.limitChanges.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No limit changes recorded.
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="reminders" className="mt-2">
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {data.reminders.map((r) => (
                    <div key={r.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">
                          {r.channel} · {r.status}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {r.sentAt ? fmtDateTime(r.sentAt) : 'queued'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.message}</p>
                    </div>
                  ))}
                  {data.reminders.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No reminders sent yet.
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {/* ── Notes / audit ── */}
            {data.customer.notes && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-950">
                <p className="mb-1 font-semibold uppercase tracking-wide">Audit notes</p>
                <p className="whitespace-pre-line">{data.customer.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Action dialogs ── */}
        {data && a && action === 'pay' && (
          <RecordPaymentDialog
            data={data}
            operator={operator}
            onClose={() => setAction(null)}
            onDone={() => {
              setAction(null)
              changed()
              toast.success('Payment recorded — waterfall applied')
            }}
          />
        )}
        {data && a && action === 'sale' && (
          <NewSaleDialog
            data={data}
            operator={operator}
            onClose={() => setAction(null)}
            onDone={() => {
              setAction(null)
              changed()
            }}
          />
        )}
        {data && a && action === 'limit' && (
          <LimitDialog
            data={data}
            operator={operator}
            onClose={() => setAction(null)}
            onDone={() => {
              setAction(null)
              changed()
            }}
          />
        )}
        {data && a && action === 'status' && (
          <StatusDialog
            data={data}
            operator={operator}
            onClose={() => setAction(null)}
            onDone={() => {
              setAction(null)
              changed()
            }}
          />
        )}
        {data && a && action === 'remind' && (
          <RemindDialog
            data={data}
            operator={operator}
            onClose={() => setAction(null)}
            onDone={() => {
              setAction(null)
              changed()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusMetric({
  label,
  value,
  sub,
  tone,
  strong,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'rose' | 'emerald'
  strong?: boolean
}) {
  return (
    <div className="rounded-lg border bg-white/80 p-2.5 dark:bg-slate-950/60">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular-nums',
          strong ? 'text-base font-extrabold' : 'text-sm font-bold',
          tone === 'rose' && 'text-rose-600 dark:text-rose-400',
          tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
