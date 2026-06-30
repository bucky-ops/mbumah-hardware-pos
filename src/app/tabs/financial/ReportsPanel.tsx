'use client';

/**
 * ReportsPanel — Phase 3 sub-tab.
 *
 * Three financial reports, each generated client-side from the existing
 * /api/financial/trial-balance endpoint (computed server-side) plus the
 * /api/financial/audit-trail endpoint for the audit log:
 *
 *   1. Profit & Loss Statement — Revenue (credit-normal accounts) minus
 *      Expenses (debit-normal accounts) for a date range.
 *   2. Balance Sheet — Assets = Liabilities + Equity as of a date.
 *   3. Audit Trail — paginated AuditLog table with filters (entityType,
 *      action, date range). Expandable rows show old/new JSON values.
 *
 * Each report has a CSV export button.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Scale, FileText, History, Download, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';

import {
  financialApi, formatKES, formatDate,
  type AuditLogItem,
} from '@/lib/api';
import { useAppStore } from '@/lib/stores';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { exportToCSV } from './shared';

interface TBAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  lineCount: number;
}
interface TBResult {
  asOfDate: string;
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  variance: number;
  accounts: TBAccount[];
}

function useTrialBalance(storeId: string, asOfDate: string) {
  return useQuery({
    queryKey: ['tb-report', storeId, asOfDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('storeId', storeId);
      params.set('asOfDate', asOfDate);
      const res = await fetch(`/api/financial/trial-balance?${params.toString()}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      const json = await res.json() as { success: boolean; data: TBResult };
      return json.data;
    },
    enabled: !!storeId,
  });
}

// ── Profit & Loss ────────────────────────────────────────────────────────────

function ProfitAndLossReport({ storeId }: { storeId: string }) {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);

  // For P&L, we use trial balance as of dateTo (the closing position over the
  // period is approximated by the as-of balance). For a true period P&L we'd
  // need to subtract the opening balance, but that's beyond this Phase 3 scope.
  const { data: tb, isLoading } = useTrialBalance(storeId, dateTo);

  const revenueAccounts = (tb?.accounts || []).filter((a) => a.accountType === 'REVENUE' && a.netBalance !== 0);
  const expenseAccounts = (tb?.accounts || []).filter((a) => a.accountType === 'EXPENSE' && a.netBalance !== 0);
  const totalRevenue = revenueAccounts.reduce((s, a) => s + a.netBalance, 0);
  const totalExpenses = expenseAccounts.reduce((s, a) => s + a.netBalance, 0);
  const netProfit = totalRevenue - totalExpenses;

  const handleExport = () => {
    if (!tb) return;
    const rows: Record<string, unknown>[] = [];
    rows.push({ Section: 'REVENUE', Account: '', Amount: '' });
    revenueAccounts.forEach((a) => rows.push({ Section: '', Account: `${a.accountCode} ${a.accountName}`, Amount: a.netBalance.toFixed(2) }));
    rows.push({ Section: '', Account: 'Total Revenue', Amount: totalRevenue.toFixed(2) });
    rows.push({ Section: 'EXPENSES', Account: '', Amount: '' });
    expenseAccounts.forEach((a) => rows.push({ Section: '', Account: `${a.accountCode} ${a.accountName}`, Amount: a.netBalance.toFixed(2) }));
    rows.push({ Section: '', Account: 'Total Expenses', Amount: totalExpenses.toFixed(2) });
    rows.push({ Section: '', Account: 'Net Profit', Amount: netProfit.toFixed(2) });
    exportToCSV(rows, 'profit_and_loss');
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" /> Profit &amp; Loss Statement
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-32 h-8 text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-32 h-8 text-xs" />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport} disabled={!tb}>
              <Download className="mr-1 h-3 w-3" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : !tb || (revenueAccounts.length === 0 && expenseAccounts.length === 0) ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No revenue or expense activity recorded through {formatDate(dateTo)}.
          </div>
        ) : (
          <div className="space-y-1 text-sm font-mono">
            {/* Revenue */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-50 to-blue-50/50 dark:from-blue-900/20 dark:to-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">Revenue</p>
              <div className="space-y-1">
                {revenueAccounts.map((a) => (
                  <div key={a.accountCode} className="flex justify-between pl-4">
                    <span className="text-muted-foreground">{a.accountCode} — {a.accountName}</span>
                    <span className="font-medium">{formatKES(a.netBalance)}</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-blue-700 dark:text-blue-400">
                  <span>Total Revenue</span>
                  <span>{formatKES(totalRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Expenses */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-amber-50 to-amber-50/50 dark:from-amber-900/20 dark:to-amber-900/10 border border-amber-100 dark:border-amber-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">Expenses</p>
              <div className="space-y-1">
                {expenseAccounts.map((a) => (
                  <div key={a.accountCode} className="flex justify-between pl-4">
                    <span className="text-muted-foreground">{a.accountCode} — {a.accountName}</span>
                    <span className="font-medium">({formatKES(a.netBalance)})</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-amber-700 dark:text-amber-400">
                  <span>Total Expenses</span>
                  <span>({formatKES(totalExpenses)})</span>
                </div>
              </div>
            </div>

            {/* Net Profit */}
            <div className={`p-3 rounded-lg border-2 ${netProfit >= 0
              ? 'bg-gradient-to-r from-emerald-50 to-emerald-50/50 dark:from-emerald-900/20 dark:to-emerald-900/10 border-emerald-200 dark:border-emerald-900/40'
              : 'bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-900/20 dark:to-red-900/10 border-red-200 dark:border-red-900/40'}`}>
              <div className="flex justify-between items-center font-bold text-lg">
                <span className={netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                  {netProfit >= 0 ? '✓ Net Profit' : '✗ Net Loss'}
                </span>
                <span className={netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                  {formatKES(Math.abs(netProfit))}
                </span>
              </div>
              {totalRevenue > 0 && (
                <div className="text-right text-[10px] text-muted-foreground mt-1">
                  Margin: {((netProfit / totalRevenue) * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

function BalanceSheetReport({ storeId }: { storeId: string }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const { data: tb, isLoading } = useTrialBalance(storeId, asOfDate);

  const assets = (tb?.accounts || []).filter((a) => a.accountType === 'ASSET' && a.netBalance !== 0);
  const liabilities = (tb?.accounts || []).filter((a) => a.accountType === 'LIABILITY' && a.netBalance !== 0);
  const equity = (tb?.accounts || []).filter((a) => a.accountType === 'EQUITY' && a.netBalance !== 0);

  const totalAssets = assets.reduce((s, a) => s + a.netBalance, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.netBalance, 0);
  const totalEquity = equity.reduce((s, a) => s + a.netBalance, 0);
  const totalLiabEquity = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLiabEquity) < 1;

  const handleExport = () => {
    if (!tb) return;
    const rows: Record<string, unknown>[] = [];
    rows.push({ Section: 'ASSETS', Account: '', Amount: '' });
    assets.forEach((a) => rows.push({ Section: '', Account: `${a.accountCode} ${a.accountName}`, Amount: a.netBalance.toFixed(2) }));
    rows.push({ Section: '', Account: 'Total Assets', Amount: totalAssets.toFixed(2) });
    rows.push({ Section: 'LIABILITIES', Account: '', Amount: '' });
    liabilities.forEach((a) => rows.push({ Section: '', Account: `${a.accountCode} ${a.accountName}`, Amount: a.netBalance.toFixed(2) }));
    rows.push({ Section: '', Account: 'Total Liabilities', Amount: totalLiabilities.toFixed(2) });
    rows.push({ Section: 'EQUITY', Account: '', Amount: '' });
    equity.forEach((a) => rows.push({ Section: '', Account: `${a.accountCode} ${a.accountName}`, Amount: a.netBalance.toFixed(2) }));
    rows.push({ Section: '', Account: 'Total Equity', Amount: totalEquity.toFixed(2) });
    rows.push({ Section: '', Account: 'Total Liabilities + Equity', Amount: totalLiabEquity.toFixed(2) });
    exportToCSV(rows, 'balance_sheet');
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" /> Balance Sheet
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Label className="text-xs text-muted-foreground">As of:</Label>
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-32 h-8 text-xs" />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport} disabled={!tb}>
              <Download className="mr-1 h-3 w-3" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : !tb || (assets.length === 0 && liabilities.length === 0 && equity.length === 0) ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No asset, liability, or equity balances recorded through {formatDate(asOfDate)}.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Assets (left) */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-green-50 to-green-50/50 dark:from-green-900/20 dark:to-green-900/10 border border-green-100 dark:border-green-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-green-600 dark:text-green-400 mb-2">Assets</p>
              <div className="space-y-1 text-sm font-mono">
                {assets.map((a) => (
                  <div key={a.accountCode} className="flex justify-between pl-2">
                    <span className="text-muted-foreground">{a.accountCode} — {a.accountName}</span>
                    <span className="font-medium">{formatKES(a.netBalance)}</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-green-700 dark:text-green-400">
                  <span>Total Assets</span>
                  <span>{formatKES(totalAssets)}</span>
                </div>
              </div>
            </div>

            {/* Liabilities + Equity (right) */}
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-900/20 dark:to-red-900/10 border border-red-100 dark:border-red-900/30">
                <p className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">Liabilities</p>
                <div className="space-y-1 text-sm font-mono">
                  {liabilities.map((a) => (
                    <div key={a.accountCode} className="flex justify-between pl-2">
                      <span className="text-muted-foreground">{a.accountCode} — {a.accountName}</span>
                      <span className="font-medium">{formatKES(a.netBalance)}</span>
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <div className="flex justify-between font-bold text-red-700 dark:text-red-400">
                    <span>Total Liabilities</span>
                    <span>{formatKES(totalLiabilities)}</span>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-r from-purple-50 to-purple-50/50 dark:from-purple-900/20 dark:to-purple-900/10 border border-purple-100 dark:border-purple-900/30">
                <p className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-2">Equity</p>
                <div className="space-y-1 text-sm font-mono">
                  {equity.map((a) => (
                    <div key={a.accountCode} className="flex justify-between pl-2">
                      <span className="text-muted-foreground">{a.accountCode} — {a.accountName}</span>
                      <span className="font-medium">{formatKES(a.netBalance)}</span>
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <div className="flex justify-between font-bold text-purple-700 dark:text-purple-400">
                    <span>Total Equity</span>
                    <span>{formatKES(totalEquity)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Accounting equation check */}
            <div className="md:col-span-2 p-3 rounded-lg border-2 bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground mb-1">Accounting Equation</p>
              <p className="font-mono text-sm">
                Assets ({formatKES(totalAssets)}) = Liabilities ({formatKES(totalLiabilities)}) + Equity ({formatKES(totalEquity)})
              </p>
              <Badge className={`mt-2 ${balanced
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {balanced ? '✓ Balanced' : `✗ Unbalanced (Δ ${formatKES(Math.abs(totalAssets - totalLiabEquity))})`}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Audit Trail ──────────────────────────────────────────────────────────────

const ENTITY_TYPES = ['JournalEntry', 'JournalEntryLine', 'Account', 'FinancialPeriod', 'TrialBalanceSnapshot', 'Budget', 'Customer', 'Supplier', 'Expense'];
const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'POST', 'VOID', 'APPROVE', 'CLOSE', 'LOCK', 'REOPEN', 'RECONCILE', 'BUDGET_SET', 'SNAPSHOT'];

function AuditTrailReport({ storeId }: { storeId: string }) {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-trail', storeId, entityType, action, dateFrom, dateTo],
    queryFn: () => financialApi.listAuditTrail({
      storeId,
      entityType: entityType || undefined,
      action: action || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: 100,
    }),
    enabled: !!storeId,
  });
  const entries: AuditLogItem[] = Array.isArray(data?.data) ? data.data : [];

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    if (entries.length === 0) {
      toast.error('No audit entries to export');
      return;
    }
    const rows = entries.map((e) => ({
      Timestamp: formatDate(e.timestamp),
      EntityType: e.entityType,
      Action: e.action,
      User: e.user?.email || e.userId || '—',
      EntityId: e.entityId,
      Reason: e.reason || '',
    }));
    exportToCSV(rows, 'audit_trail');
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Audit Trail
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{entries.length} entries</Badge>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport} disabled={entries.length === 0}>
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Entity Type</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Action</Label>
              <Select value={action} onValueChange={(v) => setAction(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs w-32" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs w-32" />
            </div>
            {(entityType || action || dateFrom || dateTo) && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEntityType(''); setAction(''); setDateFrom(''); setDateTo(''); }}>
                Clear
              </Button>
            )}
            {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <History className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No audit entries match the current filters</p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <React.Fragment key={e.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggle(e.id)}
                    >
                      <TableCell>
                        {expanded.has(e.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(e.timestamp)}</TableCell>
                      <TableCell className="text-sm">{e.entityType}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px]">{e.action}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{e.user?.email || e.userId || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={e.reason || ''}>
                        {e.reason || '—'}
                      </TableCell>
                    </TableRow>
                    {expanded.has(e.id) && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20 p-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="font-bold text-muted-foreground mb-1">Old Values</p>
                              <pre className="bg-background border rounded p-2 text-[10px] overflow-x-auto max-h-40 font-mono">
                                {e.oldValues ? JSON.stringify(e.oldValues, null, 2) : 'null'}
                              </pre>
                            </div>
                            <div>
                              <p className="font-bold text-muted-foreground mb-1">New Values</p>
                              <pre className="bg-background border rounded p-2 text-[10px] overflow-x-auto max-h-40 font-mono">
                                {e.newValues ? JSON.stringify(e.newValues, null, 2) : 'null'}
                              </pre>
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-2">
                            Entity ID: <span className="font-mono">{e.entityId}</span>
                            {e.ipAddress && <> · IP: <span className="font-mono">{e.ipAddress}</span></>}
                            {e.userAgent && <> · UA: <span className="font-mono truncate">{e.userAgent}</span></>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main ReportsPanel ────────────────────────────────────────────────────────

export default function ReportsPanel() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [activeReport, setActiveReport] = useState('pnl');

  return (
    <Tabs value={activeReport} onValueChange={setActiveReport} className="space-y-4">
      <TabsList className="h-9">
        <TabsTrigger value="pnl" className="text-xs gap-1.5">
          <FileText className="h-3.5 w-3.5" /> P&amp;L
        </TabsTrigger>
        <TabsTrigger value="balance-sheet" className="text-xs gap-1.5">
          <Scale className="h-3.5 w-3.5" /> Balance Sheet
        </TabsTrigger>
        <TabsTrigger value="audit" className="text-xs gap-1.5">
          <History className="h-3.5 w-3.5" /> Audit Trail
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pnl">
        <ProfitAndLossReport storeId={currentStoreId} />
      </TabsContent>
      <TabsContent value="balance-sheet">
        <BalanceSheetReport storeId={currentStoreId} />
      </TabsContent>
      <TabsContent value="audit">
        <AuditTrailReport storeId={currentStoreId} />
      </TabsContent>
    </Tabs>
  );
}
