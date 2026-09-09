// Path: src/app/page.tsx
// Mbumah Hardware — Customer Credit Engine (single-page app shell).
// Tabs: Portfolio overview | Customer directory. Customer 360° opens as a
// large dialog from either tab. Operator selector drives RBAC on mutations.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Building2, Database, HeartPulse, RefreshCw, ShieldCheck, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OverviewTab } from '@/components/credit/overview-tab'
import { CustomersTab } from '@/components/credit/customers-tab'
import { Customer360Dialog } from '@/components/credit/customer-360-dialog'
import { NewCustomerDialog } from '@/components/credit/governance-dialogs'
import { creditApi, type OperatorInfo, type Overview } from '@/lib/credit-client'
import { cn } from '@/lib/utils'

type Tab = 'portfolio' | 'customers'

export default function CreditEnginePage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [tab, setTab] = useState<Tab>('portfolio')
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [operator, setOperator] = useState<OperatorInfo | null>(null)
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await creditApi.overview()
      setOverview(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load portfolio')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOperators = useCallback(async () => {
    // Operators come embedded in the overview? No — a tiny endpoint would be
    // overkill; derive from a HEAD-less trick: fetch customers API is not
    // auth-shaped. Instead the seed route returns users; simplest robust way
    // is a dedicated endpoint. We reuse /api/customers response metadata? None.
    // → We fetch the seed status which returns counts only, so we pull users
    //   from the branch via the overview… To keep one source, operators are
    //   fetched from /api/seed GET (seeded) + a lightweight users list added
    //   to the overview payload below (see overview-tab). Fallback: seed users.
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const json = (await res.json()) as { ok: boolean; data?: OperatorInfo[] }
        if (json.ok && json.data) {
          setOperators(json.data)
          setOperator((prev) => prev ?? json.data!.find((u) => u.role === 'OWNER') ?? json.data![0])
        }
      }
    } catch {
      /* operators optional */
    }
  }, [])

  useEffect(() => {
    void load()
    void loadOperators()
  }, [load, loadOperators])

  const seed = async (force: boolean) => {
    setSeeding(true)
    try {
      const r = await creditApi.seed(force)
      toast.success(force ? 'Demo portfolio reset' : 'Demo portfolio loaded', {
        description: r.message,
      })
      await load()
      await loadOperators()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  const isEmpty = overview?.empty || (overview?.kpis === null)

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur dark:bg-slate-900/90">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <HeartPulse className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold leading-tight sm:text-lg">
                  Customer Credit Engine
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  {overview?.branch ? (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3 w-3" aria-hidden />
                      {overview.branch.name} · {overview.branch.code}
                    </span>
                  ) : (
                    'Mbumah Hardware'
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={operator?.id ?? ''}
                onValueChange={(id) => setOperator(operators.find((o) => o.id === id) ?? null)}
              >
                <SelectTrigger className="h-9 w-[220px]" aria-label="Acting operator">
                  <SelectValue placeholder="Acting as…" />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="inline-flex items-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                        {o.name} · {o.role}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!isEmpty && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setNewCustomerOpen(true)}
                >
                  <Users2 className="mr-1 h-4 w-4" aria-hidden /> New customer
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => void load()}
                aria-label="Refresh data"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant={isEmpty ? 'default' : 'ghost'}
                className="h-9"
                disabled={seeding}
                onClick={() => void seed(true)}
              >
                <Database className="mr-1 h-4 w-4" aria-hidden />
                {isEmpty ? 'Load demo data' : 'Reset demo'}
              </Button>
            </div>
          </div>

          {/* Tab bar */}
          <nav className="mx-auto flex max-w-7xl gap-1 px-4" aria-label="Sections">
            {(
              [
                { id: 'portfolio', label: 'Portfolio', icon: HeartPulse },
                { id: 'customers', label: 'Customers', icon: Users2 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === id
                    ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </nav>
        </header>

        {/* ── Main ───────────────────────────────────────────────────── */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm dark:bg-slate-900">
              <Database className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
              <h2 className="mt-4 text-lg font-bold">No portfolio data</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Load the demo portfolio to explore the credit engine: 9 customers covering every
                verdict class, 34 invoices, payments, approvals and reminders.
              </p>
              <Button className="mt-4" disabled={seeding} onClick={() => void seed(true)}>
                {seeding ? 'Loading…' : 'Load demo data'}
              </Button>
            </div>
          ) : tab === 'portfolio' ? (
            <OverviewTab overview={overview!} onOpenCustomer={setOpenCustomerId} />
          ) : (
            <CustomersTab
              overview={overview!}
              operator={operator}
              onOpenCustomer={setOpenCustomerId}
            />
          )}
        </main>

        {/* ── Sticky footer ──────────────────────────────────────────── */}
        <footer className="mt-auto border-t bg-white dark:bg-slate-900">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Mbumah Hardware POS · Customer Credit Engine — verdicts, scoring, waterfall
              repayment &amp; approval trails
            </span>
            <span className="tabular-nums">
              Discount before 16% VAT · Decimal-exact · Africa/Nairobi day boundaries
            </span>
          </div>
        </footer>

        {/* ── Dialogs ────────────────────────────────────────────────── */}
        {openCustomerId && operator && (
          <Customer360Dialog
            customerId={openCustomerId}
            operator={operator}
            operators={operators}
            onClose={() => setOpenCustomerId(null)}
            onChanged={() => void refresh()}
          />
        )}
        {newCustomerOpen && operator && (
          <NewCustomerDialog
            operator={operator}
            onClose={() => setNewCustomerOpen(false)}
            onDone={() => {
              setNewCustomerOpen(false)
              void refresh()
            }}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
