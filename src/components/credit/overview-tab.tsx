// Path: src/components/credit/overview-tab.tsx
// Portfolio overview: KPI cards, aging distribution (recharts bar),
// verdict mix (donut) and the at-risk watchlist.

'use client'

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, BadgeCheck, CircleDollarSign, Gauge, Landmark, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { VerdictBadge } from '@/components/credit/ui-bits'
import { kes, type CustomerSummary, type Overview } from '@/lib/credit-client'

const VERDICT_COLORS: Record<string, string> = {
  DO_NOT_EXTEND: '#e11d48',
  CREDIT_EXHAUSTED: '#f43f5e',
  RESTRICTED: '#d97706',
  CAUTION: '#f59e0b',
  STANDARD: '#10b981',
  GOOD_STANDING: '#059669',
  NEW_CUSTOMER: '#94a3b8',
}

const VERDICT_NAMES: Record<string, string> = {
  DO_NOT_EXTEND: 'Do not extend',
  CREDIT_EXHAUSTED: 'Exhausted',
  RESTRICTED: 'Restricted',
  CAUTION: 'Caution',
  STANDARD: 'Standard',
  GOOD_STANDING: 'Good standing',
  NEW_CUSTOMER: 'New / provisional',
}

const AGING_ORDER = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']
const AGING_AXIS = ['Not due', '1–30', '31–60', '61–90', '90+']

export function OverviewTab({
  overview,
  onOpenCustomer,
}: {
  overview: Overview
  onOpenCustomer: (id: string) => void
}) {
  const kpis = overview.kpis!
  const agingData = AGING_ORDER.map((bucket, i) => ({
    name: AGING_AXIS[i],
    bucket,
    amount: overview.agingByBucket?.[bucket] ?? 0,
  }))
  const verdictData = Object.entries(overview.verdictCounts ?? {})
    .filter(([, v]) => v > 0)
    .map(([code, count]) => ({ code, count, name: VERDICT_NAMES[code] ?? code }))

  const overdueShare =
    kpis.totalReceivables > 0 ? Math.round((kpis.totalOverdue / kpis.totalReceivables) * 100) : 0

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Landmark className="h-5 w-5" aria-hidden />}
          label="Total receivables"
          value={kes(kpis.totalReceivables)}
          sub={`${kpis.customerCount} customers on credit`}
          tone="slate"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          label="Overdue balance"
          value={kes(kpis.totalOverdue)}
          sub={`${overdueShare}% of receivables`}
          tone={kpis.totalOverdue > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          icon={<CircleDollarSign className="h-5 w-5" aria-hidden />}
          label="Available credit"
          value={kes(kpis.availablePortfolio)}
          sub={`of ${kes(kpis.totalCreditLimit)} limits`}
          tone="emerald"
        />
        <KpiCard
          icon={<Gauge className="h-5 w-5" aria-hidden />}
          label="Portfolio score"
          value={`${kpis.avgScore}/100`}
          sub={kpis.suspendedCount > 0 ? `${kpis.suspendedCount} suspended/defaulted` : 'All accounts active'}
          tone={kpis.avgScore >= 70 ? 'emerald' : kpis.avgScore >= 55 ? 'amber' : 'rose'}
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Receivables aging (Africa/Nairobi day boundaries)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                />
                <Tooltip
                  formatter={(value) => [kes(Number(value)), 'Outstanding']}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={64}>
                  {agingData.map((d, i) => (
                    <Cell
                      key={d.bucket}
                      fill={
                        d.bucket === 'CURRENT'
                          ? '#059669'
                          : d.bucket === 'D1_30'
                            ? '#f59e0b'
                            : d.bucket === 'D31_60'
                              ? '#ea580c'
                              : d.bucket === 'D61_90'
                                ? '#e11d48'
                                : '#9f1239'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Verdict mix</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={verdictData}
                  dataKey="count"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {verdictData.map((d) => (
                    <Cell key={d.code} fill={VERDICT_COLORS[d.code] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} customer(s)`, String(name)]}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {verdictData.map((d) => (
                <span key={d.code} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: VERDICT_COLORS[d.code] }}
                    aria-hidden
                  />
                  {d.name} ({d.count})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Watchlist ── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-rose-500" aria-hidden />
            Credit watchlist — highest risk first
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {overview.watchlist?.map((c) => (
            <WatchCard key={c.id} customer={c} onOpen={() => onOpenCustomer(c.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  tone: 'slate' | 'rose' | 'emerald' | 'amber'
}) {
  const toneClass =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
      : tone === 'emerald'
        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
        : tone === 'amber'
          ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'
  return (
    <Card className="p-0">
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function WatchCard({ customer, onOpen }: { customer: CustomerSummary; onOpen: () => void }) {
  const a = customer.assessment
  return (
    <Card className="p-0 transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{customer.name}</p>
            <p className="text-xs text-muted-foreground">
              {customer.type === 'COMPANY' ? 'Company' : 'Individual'} · {customer.phone ?? 'no phone'}
            </p>
          </div>
          <span className="text-2xl leading-none" aria-hidden>
            {a.verdict.dot}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
            <p className="text-[10px] uppercase text-muted-foreground">Outstanding</p>
            <p className="text-sm font-bold tabular-nums">{kes(a.outstanding)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
            <p className="text-[10px] uppercase text-muted-foreground">Overdue</p>
            <p className={`text-sm font-bold tabular-nums ${a.overdueAmount > 0 ? 'text-rose-600' : ''}`}>
              {kes(a.overdueAmount)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
            <p className="text-[10px] uppercase text-muted-foreground">Score</p>
            <p className="text-sm font-bold tabular-nums">{customer.creditScore}</p>
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full rounded-full ${a.utilizationPct >= 95 ? 'bg-rose-500' : a.utilizationPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, a.utilizationPct)}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">{a.utilizationPct.toFixed(1)}% of {kes(a.creditLimit)}</span>
          <VerdictBadge verdict={a.verdict} className="text-[10px]" />
        </div>

        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onOpen}>
          <BadgeCheck className="mr-1 h-4 w-4" aria-hidden /> Review account
        </Button>
      </CardContent>
    </Card>
  )
}
