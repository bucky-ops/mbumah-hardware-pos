// Path: src/components/credit/customers-tab.tsx
// Customer directory: search + verdict filters + full credit table.
// Every row opens the Customer 360° dialog.

'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { OverdueChip, ScoreBadge, StatusDot, VerdictBadge } from '@/components/credit/ui-bits'
import { kes, type CustomerSummary, type OperatorInfo, type Overview } from '@/lib/credit-client'
import { cn } from '@/lib/utils'

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'DO_NOT_EXTEND', label: '🔴 Do not extend' },
  { id: 'RESTRICTED', label: '🟠 Restricted' },
  { id: 'CAUTION', label: '🟡 Caution' },
  { id: 'GOOD_STANDING', label: '🟢 Good standing' },
  { id: 'NEW_CUSTOMER', label: '⚪ New' },
]

export function CustomersTab({
  overview,
  operator,
  onOpenCustomer,
}: {
  overview: Overview
  operator: OperatorInfo | null
  onOpenCustomer: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')

  const entries = useMemo(() => {
    let list = overview.entries ?? []
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || (e.phone ?? '').includes(q),
      )
    }
    if (filter !== 'ALL') list = list.filter((e) => e.assessment.verdict.code === filter)
    return list
  }, [overview.entries, search, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="pl-8"
            aria-label="Search customers"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by verdict">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? 'default' : 'outline'}
              className={cn('h-8', filter === f.id && 'bg-emerald-600 hover:bg-emerald-700')}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-900">
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
              <TableRow>
                <TableHead className="min-w-[220px]">Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Credit limit</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="min-w-[130px]">Utilisation</TableHead>
                <TableHead>Arrears</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((c) => {
                const a = c.assessment
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20"
                    onClick={() => onOpenCustomer(c.id)}
                  >
                    <TableCell>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.type === 'COMPANY' ? 'Company' : 'Individual'} · {c.phone ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusDot status={c.creditStatus} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {kes(a.outstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {kes(a.creditLimit)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        a.availableCredit <= 0 ? 'text-rose-600' : 'text-emerald-600',
                      )}
                    >
                      {kes(a.availableCredit)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-full min-w-[64px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full ${a.utilizationPct >= 95 ? 'bg-rose-500' : a.utilizationPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, a.utilizationPct)}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {a.utilizationPct.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <OverdueChip days={a.maxDaysOverdue} amount={a.overdueAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreBadge score={c.creditScore} band={c.riskBand} />
                    </TableCell>
                    <TableCell>
                      <VerdictBadge verdict={a.verdict} className="text-[10px]" />
                    </TableCell>
                  </TableRow>
                )
              })}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    No customers match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {entries.length} of {overview.entries?.length ?? 0} customers · acting operator:{' '}
        <strong>{operator ? `${operator.name} (${operator.role})` : '—'}</strong>. Click a row for the
        full 360° credit profile.
      </p>
    </div>
  )
}
