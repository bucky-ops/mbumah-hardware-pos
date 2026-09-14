// Path: src/components/credit/ui-bits.tsx
// Shared presentational atoms for the Credit Engine UI.

'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Verdict } from '@/lib/credit-client'

const TONE_CLASSES: Record<Verdict['tone'], string> = {
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  emerald:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
}

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1 font-semibold', TONE_CLASSES[verdict.tone], className)}>
      <span aria-hidden>{verdict.dot}</span>
      <span className="whitespace-nowrap">{verdict.label}</span>
    </Badge>
  )
}

export function StatusDot({ status }: { status: string }) {
  if (status === 'ACTIVE') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">ACTIVE</Badge>
  if (status === 'SUSPENDED') return <Badge className="bg-rose-100 text-rose-700 border-rose-200">SUSPENDED</Badge>
  return <Badge className="bg-rose-600 text-white border-rose-700">DEFAULTED</Badge>
}

export function ScoreBadge({ score, band }: { score: number; band: string }) {
  const tone =
    band === 'NEW'
      ? 'bg-slate-100 text-slate-600 border-slate-200'
      : score >= 75
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : score >= 55
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-rose-50 text-rose-700 border-rose-200'
  return (
    <Badge variant="outline" className={cn('font-mono tabular-nums', tone)}>
      {score}/100 · {band}
    </Badge>
  )
}

export function UtilizationBar({
  pct,
  className,
  showLabel = true,
}: {
  pct: number
  className?: string
  showLabel?: boolean
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  const barColor = pct >= 95 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : pct >= 50 ? 'bg-emerald-500' : 'bg-emerald-400'
  return (
    <div className={cn('w-full', className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Credit utilisation ${pct.toFixed(1)}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">{pct.toFixed(1)}% utilised</div>
      )}
    </div>
  )
}

export function OverdueChip({ days, amount }: { days: number; amount: number }) {
  if (amount <= 0 || days <= 0) return <span className="text-xs text-muted-foreground">No arrears</span>
  const tone = days > 60 ? 'text-rose-600' : days > 30 ? 'text-amber-600' : 'text-orange-500'
  return <span className={cn('text-xs font-semibold tabular-nums', tone)}>{days}d overdue</span>
}
