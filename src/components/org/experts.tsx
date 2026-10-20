'use client';

// Domain Expert Modules (v2.18.3 port) - 9 tabs, every figure from the
// main-lineage APIs:
//   Inventory / Debt / Rentals / Suppliers / M-Pesa / eTIMS -> /api/org/kpi-summary
//   Financials -> /api/financial/trial-balance   (lazy; role-gated server-side)
//   Audit      -> /api/audit-logs                (lazy; role-gated server-side)
//   System     -> /api/health + kpi-summary      (health is public; logs lazy)
// Sections whose endpoint denies the caller degrade to an explicit
// "unavailable" state - never a fake number.

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Boxes, Landmark, LifeBuoy, ReceiptText, Scale, Smartphone, Truck } from 'lucide-react';
import { authorizedFetchJson } from '@/lib/api';
import { kes, num, timeAgo, type HealthBreakdownItem, type KpiSummaryData } from './primitives';

const PCT = (v: number) => `${v}%`;
const pctColor = (v: number) => (v >= 90 ? 'text-emerald-700' : v >= 70 ? 'text-amber-700' : 'text-red-600');

interface LazyState<T> { data: T | null; error: string | null; loading: boolean }

/** Fetch an endpoint the first time a tab becomes active. */
function useLazyEndpoint<T>(url: string, active: boolean): LazyState<T> {
  const [state, setState] = useState<LazyState<T>>({ data: null, error: null, loading: false });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const res = await authorizedFetchJson(url);
    if (res.ok && res.json?.success) {
      setState({ data: res.json.data as T, error: null, loading: false });
    } else {
      const reason = res.status === 403
        ? 'Your role is not permitted to view this expert module.'
        : res.status === 401
          ? 'Sign in to load this module.'
          : res.json?.error || 'The endpoint could not be reached.';
      setState({ data: null, error: reason, loading: false });
    }
  }, [url]);

  useEffect(() => {
    // Defer to a macrotask so setState never runs synchronously inside the
    // effect body (react-hooks/set-state-in-effect) while preserving the
    // fetch-once-per-activation semantics.
    if (active && !state.data && !state.error && !state.loading) {
      const t = setTimeout(() => void load(), 0);
      return () => clearTimeout(t);
    }
  }, [active, state.data, state.error, state.loading, load]);

  return state;
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
      <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-amber-500" />
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Unavailable in this release for your account</p>
      <p className="mt-1 text-[11px] text-slate-500">{reason}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-2 p-2">
      {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );
}

// ── Financials (trial balance) ───────────────────────────────────────────────
interface TrialBalanceResponse {
  accounts?: Array<{ account?: { code?: string; name?: string }; accountName?: string; debitTotal?: number; creditTotal?: number; netBalance?: number; lineCount?: number }>;
  totals?: { debits?: number; credits?: number; balanced?: boolean };
  asOfDate?: string;
}

function FinancialsExpert() {
  const state = useLazyEndpoint<TrialBalanceResponse>('/api/financial/trial-balance', true);
  if (state.loading) return <Loading />;
  if (state.error || !state.data) return <Unavailable reason={state.error ?? 'No data.'} />;
  const rows = state.data.accounts ?? [];
  const totalDebit = state.data.totals?.debits ?? 0;
  const totalCredit = state.data.totals?.credits ?? 0;
  const balanced = state.data.totals?.balanced ?? Math.abs(totalDebit - totalCredit) < 0.01;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2">
        <Tile label="Net profit basis" value={rows.length ? `${rows.length} accounts` : 'No journal rows'} sub={`as of ${state.data.asOfDate ? new Date(state.data.asOfDate).toLocaleDateString('en-KE') : 'today'}`} />
        <Tile label="Trial balance" value={balanced ? 'Balanced' : 'Off'} tone={balanced ? 'text-emerald-700' : 'text-red-500'} sub={`${kes(totalDebit)} = ${kes(totalCredit)}`} />
      </div>
      <div className="lg:col-span-2">
        <SubTitle>Chart of accounts - trial balance (double-entry)</SubTitle>
        <div className="max-h-64 overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.slice(0, 50).map((t, i) => (
                <TableRow key={`${t.account?.code ?? t.accountName ?? i}`}>
                  <TableCell className="text-xs">{t.account?.code ? `${t.account.code} ` : ''}{t.account?.name ?? t.accountName ?? 'Account'}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{t.debitTotal ? kes(t.debitTotal) : '-'}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{t.creditTotal ? kes(t.creditTotal) : '-'}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-xs text-slate-500">No journal lines posted yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ── Audit (SystemLog feed with user attribution) ─────────────────────────────
interface AuditLogRow {
  id: string; action: string; component: string; severity: string; message: string;
  createdAt: string; user?: { name?: string; role?: string } | null;
}

function AuditExpert() {
  const state = useLazyEndpoint<{ data?: AuditLogRow[]; summary?: unknown }>('/api/audit-logs?limit=15', true);
  if (state.loading) return <Loading />;
  if (state.error || !state.data) return <Unavailable reason={state.error ?? 'No data.'} />;
  const items = Array.isArray(state.data.data) ? state.data.data : [];
  return (
    <div>
      <SubTitle>Audit trail - latest SystemLog events with user attribution</SubTitle>
      <div className="max-h-64 overflow-y-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Level</TableHead><TableHead>Action</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs text-slate-500">{timeAgo(a.createdAt)}</TableCell>
                <TableCell className="text-xs">{a.user?.name ?? 'System'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${a.severity === 'ERROR' ? 'border-red-200 text-red-600' : a.severity === 'WARN' ? 'border-amber-200 text-amber-700' : 'text-slate-500'}`}>{a.severity}</Badge>
                </TableCell>
                <TableCell className="text-xs font-medium text-slate-700">{a.action}</TableCell>
                <TableCell className="max-w-[280px] truncate text-xs text-slate-500">{a.message}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-slate-500">No audit events yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── System (health endpoint + kpi-summary system counters) ───────────────────
interface HealthResponse {
  status?: string; version?: string; environment?: string;
  checks?: Record<string, { status?: string; detail?: string }>;
  uptimeSeconds?: number;
}

function SystemExpert({ kpi }: { kpi: KpiSummaryData }) {
  const state = useLazyEndpoint<HealthResponse>('/api/health', true);
  const checks = state.data?.checks ?? {};
  const envChecks = Object.entries(checks).filter(([k]) => k.startsWith('env_'));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2">
        <Tile label="API status" value={state.loading ? 'checking' : state.data?.status ?? 'unknown'} tone={state.data?.status === 'healthy' ? 'text-emerald-700' : 'text-amber-700'} sub={state.data ? `version ${state.data.version ?? '?'}` : 'health endpoint unreachable'} />
        <Tile label="Stores / users" value={`${kpi.system.stores} / ${kpi.system.activeUsers}`} sub="active rows in this organization" />
        <Tile label="Chat messages" value={num(kpi.system.chatMessages)} sub={`${kpi.system.notificationsUnread} unread notifications`} />
      </div>
      <div className="lg:col-span-2">
        <SubTitle>Health checks (/api/health)</SubTitle>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['database', 'database_stats'].map((key) => (
            <div key={key} className="rounded-xl border border-slate-100 p-2 text-center">
              <p className={`text-sm font-bold ${checks[key]?.status === 'ok' ? 'text-emerald-700' : checks[key]?.status === 'warning' ? 'text-amber-700' : 'text-red-500'}`}>{checks[key]?.status ?? 'n/a'}</p>
              <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{key.replace('_', ' ')}</p>
              <p className="truncate text-[9px] text-slate-500" title={checks[key]?.detail ?? ''}>{checks[key]?.detail ?? ''}</p>
            </div>
          ))}
          {state.error && (
            <div className="rounded-xl border border-dashed border-slate-200 p-2 text-center text-[10px] text-slate-500 sm:col-span-4">{state.error}</div>
          )}
        </div>
        <SubTitle>Environment variables</SubTitle>
        <div className="flex flex-wrap gap-1.5">
          {envChecks.map(([key, value]) => (
            <Badge key={key} variant="outline" className={`font-mono text-[10px] ${value.status === 'ok' ? 'text-emerald-700' : 'text-red-500'}`}>
              {key.replace('env_', '')}: {value.status}
            </Badge>
          ))}
          {envChecks.length === 0 && <span className="text-xs text-slate-500">{state.loading ? 'Loading...' : 'No env checks reported.'}</span>}
        </div>
      </div>
    </div>
  );
}

export function ExpertModules({ data }: { data: KpiSummaryData }) {
  const e = data;
  return (
    <section aria-label="Domain Expert Modules" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Domain Expert Modules</h2>
        <p className="text-[11px] text-slate-500">Specialist consoles over shared, store-scoped data - each endpoint re-verifies the session and role server-side.</p>
      </header>
      <Tabs defaultValue="inventory" className="px-4 pb-4 pt-3">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-slate-50 p-1">
          <TabsTrigger value="inventory" className="text-[11px]"><Boxes className="mr-1 h-3 w-3" /> Inventory</TabsTrigger>
          <TabsTrigger value="debt" className="text-[11px]"><AlertTriangle className="mr-1 h-3 w-3" /> Debt (Mkopo)</TabsTrigger>
          <TabsTrigger value="rentals" className="text-[11px]"><LifeBuoy className="mr-1 h-3 w-3" /> Rentals</TabsTrigger>
          <TabsTrigger value="financials" className="text-[11px]"><Landmark className="mr-1 h-3 w-3" /> Financials</TabsTrigger>
          <TabsTrigger value="suppliers" className="text-[11px]"><Truck className="mr-1 h-3 w-3" /> Suppliers</TabsTrigger>
          <TabsTrigger value="mpesa" className="text-[11px]"><Smartphone className="mr-1 h-3 w-3" /> M-Pesa</TabsTrigger>
          <TabsTrigger value="etims" className="text-[11px]"><ReceiptText className="mr-1 h-3 w-3" /> eTIMS</TabsTrigger>
          <TabsTrigger value="audit" className="text-[11px]"><Scale className="mr-1 h-3 w-3" /> Audit</TabsTrigger>
          <TabsTrigger value="system" className="text-[11px]"><Boxes className="mr-1 h-3 w-3" /> System</TabsTrigger>
        </TabsList>

        {/* Inventory */}
        <TabsContent value="inventory" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <Tile label="Stock health" value={e.inventory.totalSkus ? PCT(Math.round(100 - (100 * e.inventory.lowStock) / e.inventory.totalSkus)) : '100%'} tone={pctColor(e.inventory.totalSkus ? 100 - (100 * e.inventory.lowStock) / e.inventory.totalSkus : 100)} sub={`${num(e.inventory.totalSkus)} SKUs`} />
            <Tile label="Stock value (cost)" value={kes(e.inventory.stockValue)} sub={`retail ${kes(e.inventory.retailValue)}`} />
            <Tile label="Low stock" value={num(e.inventory.lowStock)} tone={e.inventory.lowStock ? 'text-orange-500' : ''} sub="at/below reorder level" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Low stock / reorder watchlist (org-wide)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead>Store</TableHead><TableHead className="text-right">Qty / reorder</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.inventory.lowStockItems.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs"><span className="font-medium text-slate-700">{p.name}</span> <span className="text-slate-500">{p.sku}</span></TableCell>
                      <TableCell className="text-xs text-slate-500">{p.category}</TableCell>
                      <TableCell className="text-xs text-slate-500">{p.store ?? '-'}</TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums text-orange-600">{num(p.stockQty)} / {num(p.reorderLevel)}</TableCell>
                    </TableRow>
                  ))}
                  {e.inventory.lowStockItems.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-500">Everything is above its reorder level.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Debt */}
        <TabsContent value="debt" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Outstanding" value={kes(e.debtExpert.total)} tone={e.debtExpert.total > 400_000 ? 'text-red-500' : 'text-slate-800'} sub="org-wide" />
            <Tile label="90+ days" value={kes(e.debtExpert.aging.d90plus)} tone="text-red-500" sub={`30d ${kes(e.debtExpert.aging.d30)} · 60d ${kes(e.debtExpert.aging.d60)}`} />
            <Tile label="Active plans" value={num(e.debtExpert.activePlans)} sub={`${e.debtExpert.remindersSent} reminders sent`} />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Top debtors</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Store</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Bucket</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.debtExpert.topDebtors.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">{c.customer}</TableCell>
                      <TableCell className="text-xs text-slate-500">{c.store ?? '-'}</TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">{kes(c.outstanding)}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-[10px] ${c.bucket === 'DAYS_90_PLUS' ? 'border-red-200 text-red-600' : 'text-slate-500'}`}>{c.bucket}</Badge></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${c.status === 'OVERDUE' ? 'border-red-200 text-red-600' : 'border-emerald-200 text-emerald-700'}`}>{c.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {e.debtExpert.topDebtors.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-slate-500">No outstanding balances.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Rentals */}
        <TabsContent value="rentals" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Active" value={num(e.rentals.active)} sub="on the yard" />
            <Tile label="Overdue" value={num(e.rentals.overdue)} tone={e.rentals.overdue ? 'text-red-500' : ''} sub="damage fees may apply" />
            <Tile label="On-rent ledger rows" value={num(e.rentals.items.length)} sub="latest 8 across stores" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Rental ledger (authorized roles only)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Store</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Rate/day</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.rentals.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.item}</TableCell>
                      <TableCell className="text-xs text-slate-500">{r.store ?? '-'}</TableCell>
                      <TableCell className="text-xs text-slate-500">{r.customer}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{kes(r.ratePerDay)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${r.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700' : r.status === 'OVERDUE' ? 'border-red-200 bg-red-50 text-red-600' : 'text-slate-500'}`}>{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {e.rentals.items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-slate-500">No active or overdue rentals.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Financials (lazy endpoint) */}
        <TabsContent value="financials" className="mt-3">
          <FinancialsExpert />
        </TabsContent>

        {/* Suppliers */}
        <TabsContent value="suppliers" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Suppliers" value={num(e.suppliers.count)} sub="active across stores" />
            <Tile label="Open POs" value={num(e.suppliers.openPOs)} sub="awaiting delivery" />
            <Tile label="Delivery overdue" value={num(e.suppliers.overduePOs)} tone={e.suppliers.overduePOs ? 'text-amber-700' : 'text-emerald-700'} sub="past expected date" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Purchase orders in flight (latest 8)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Store</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.suppliers.purchaseOrders.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{p.supplier}</TableCell>
                      <TableCell className="text-xs text-slate-500">{p.store ?? '-'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{kes(p.total)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] text-slate-500">{p.status}</Badge></TableCell>
                      <TableCell className="text-right text-xs text-slate-500">{p.expectedDate ? new Date(p.expectedDate).toLocaleDateString('en-KE') : '-'}</TableCell>
                    </TableRow>
                  ))}
                  {e.suppliers.purchaseOrders.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-slate-500">No open purchase orders.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* M-Pesa */}
        <TabsContent value="mpesa" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Completed" value={num(e.mpesa.today.completed)} tone="text-emerald-700" sub="recent STK pushes" />
            <Tile label="Mismatch" value={num(e.mpesa.today.stale)} tone={e.mpesa.today.stale ? 'text-red-500' : ''} sub="pending > 10 min" />
            <Tile label="Pending" value={num(e.mpesa.today.pending)} sub="awaiting callback" />
            <Tile label="Failed" value={num(e.mpesa.today.failed)} tone={e.mpesa.today.failed ? 'text-amber-700' : ''} sub="cancelled or failed" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Daraja STK push ledger (phones masked, no secrets)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Checkout</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Receipt</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.mpesa.txns.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-[10px]">{m.checkoutRequestId ?? '-'}</TableCell>
                      <TableCell className="text-xs">{m.phoneMasked ?? '-'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{kes(m.amount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${m.status === 'COMPLETED' ? 'border-emerald-200 text-emerald-700' : m.status === 'PENDING' || m.status === 'PROCESSING' ? 'border-amber-200 text-amber-700' : 'border-red-200 text-red-600'}`}>{m.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">{m.mpesaReceipt ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                  {e.mpesa.txns.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-slate-500">No M-Pesa transactions recorded yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* eTIMS */}
        <TabsContent value="etims" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Pending" value={num(e.etims.pending)} tone={e.etims.pending ? 'text-amber-700' : 'text-emerald-700'} sub="awaiting KRA" />
            <Tile label="Issued" value={num(e.etims.issued)} tone="text-emerald-700" sub="transmitted invoices" />
            <Tile label="Per-store queue" value="Workspace" sub="eTIMS dashboard lives in each store workspace" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>KRA eTIMS transmission state (org-wide)</SubTitle>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
              <p>Transactions carrying an eTIMS status: <strong className="text-slate-700">{num(e.etims.pending + e.etims.issued)}</strong> ({num(e.etims.pending)} pending, {num(e.etims.issued)} issued).</p>
              <p className="mt-2">Open a branch workspace and use its eTIMS tab (registered products, issue-invoice, invoice history) to manage KRA submissions per store.</p>
            </div>
          </div>
        </TabsContent>

        {/* Audit (lazy endpoint) */}
        <TabsContent value="audit" className="mt-3">
          <AuditExpert />
        </TabsContent>

        {/* System */}
        <TabsContent value="system" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Overall health" value={`${e.health.score}/100`} tone={e.health.score >= 80 ? 'text-emerald-700' : 'text-amber-700'} sub={e.health.label} />
            <Tile label="Low stock" value={num(e.inventory.lowStock)} sub="stock score driver" />
            <Tile label="Chat messages" value={num(e.system.chatMessages)} sub="engagement score driver" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Health breakdown</SubTitle>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {e.health.breakdown.map((b: HealthBreakdownItem) => (
                <div key={b.key} className="rounded-xl border border-slate-100 p-2 text-center">
                  <p className={`text-lg font-bold ${b.score >= 80 ? 'text-emerald-700' : b.score >= 40 ? 'text-amber-700' : 'text-red-500'}`}>{b.score}</p>
                  <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{b.label}</p>
                  <p className="text-[9px] text-slate-500">{b.detail}</p>
                </div>
              ))}
            </div>
            <SystemExpert kpi={e} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${tone ?? 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}
function SubTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}>{children}</h3>;
}
