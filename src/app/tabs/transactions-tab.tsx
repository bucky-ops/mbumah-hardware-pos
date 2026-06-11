'use client';

/**
 * MBUMAH HARDWARE POS - Transactions History Tab
 * View past transactions with summary cards, filters, search, and CSV export
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShoppingBag, Search, Download, ChevronDown, ChevronUp,
  CalendarDays, TrendingUp, Hash, CreditCard, Smartphone, Banknote, Wallet,
  Filter, FileText,
} from 'lucide-react';

import { transactionsApi, formatKES, formatDateTime, type TransactionItem, type SaleItemDetail } from '@/lib/api';
import { useAppStore } from '@/lib/stores';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// ============================================================================
// DATE HELPERS
// ============================================================================

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISOString(d: Date): string {
  return d.toISOString();
}

// ============================================================================
// DATE RANGE PRESET
// ============================================================================

type DatePreset = 'today' | 'week' | 'month' | 'custom';

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
];

function getDateRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'week':
      return { from: startOfWeek(now), to: endOfDay(now) };
    case 'month':
      return { from: startOfMonth(now), to: endOfDay(now) };
    default:
      return { from: startOfDay(now), to: endOfDay(now) };
  }
}

// ============================================================================
// PAYMENT METHOD HELPERS
// ============================================================================

function getPaymentMethodColor(method: string): string {
  switch (method) {
    case 'CASH': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'MPESA': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'DEBT': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

function getPaymentStatusLabel(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'Completed';
    case 'PENDING': return 'Pending';
    case 'FAILED': return 'Failed';
    case 'REFUNDED': return 'Refunded';
    case 'PARTIAL': return 'Partial';
    default: return status;
  }
}

function getPaymentStatusColor(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'PENDING': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'FAILED': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'REFUNDED': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ============================================================================
// CSV EXPORT
// ============================================================================

function exportTransactionsCSV(transactions: TransactionItem[]): void {
  if (transactions.length === 0) return;

  const headers = ['Receipt #', 'Date', 'Customer', 'Items', 'Subtotal', 'Tax', 'Discount', 'Total', 'Payment Method', 'Status'];
  const rows = transactions.map((t) => [
    t.receiptNumber,
    formatDateTime(t.createdAt),
    t.customer?.name || 'Walk-in',
    String(t.items?.length || 0),
    String(t.subtotal),
    String(t.taxAmount),
    String(t.discountAmount),
    String(t.totalAmount),
    t.paymentMethod,
    t.paymentStatus,
  ]);

  const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `transactions_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// TRANSACTION ROW (expandable)
// ============================================================================

function TransactionRow({ transaction, isExpanded, onToggle }: {
  transaction: TransactionItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const items = transaction.items || [];

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <TableCell className="font-mono text-xs">
          <div className="flex items-center gap-1.5">
            {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            {transaction.receiptNumber}
          </div>
        </TableCell>
        <TableCell className="text-xs">{formatDateTime(transaction.createdAt)}</TableCell>
        <TableCell className="text-xs">{transaction.customer?.name || 'Walk-in'}</TableCell>
        <TableCell className="text-xs text-center">{items.length}</TableCell>
        <TableCell className="text-xs font-semibold text-right">{formatKES(transaction.totalAmount)}</TableCell>
        <TableCell>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${getPaymentMethodColor(transaction.paymentMethod)}`}>
            {transaction.paymentMethod === 'CASH' && <Banknote className="h-3 w-3 mr-1" />}
            {transaction.paymentMethod === 'MPESA' && <Smartphone className="h-3 w-3 mr-1" />}
            {transaction.paymentMethod === 'DEBT' && <Wallet className="h-3 w-3 mr-1" />}
            {!['CASH', 'MPESA', 'DEBT'].includes(transaction.paymentMethod) && <CreditCard className="h-3 w-3 mr-1" />}
            {transaction.paymentMethod}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${getPaymentStatusColor(transaction.paymentStatus)}`}>
            {getPaymentStatusLabel(transaction.paymentStatus)}
          </Badge>
        </TableCell>
      </TableRow>
      {isExpanded && items.length > 0 && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={7} className="p-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Line Items</p>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left p-2 font-medium">Product</th>
                      <th className="text-center p-2 font-medium">Qty</th>
                      <th className="text-center p-2 font-medium">Unit</th>
                      <th className="text-right p-2 font-medium">Price</th>
                      <th className="text-right p-2 font-medium">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: SaleItemDetail) => (
                      <tr key={item.id} className="border-t border-border/50">
                        <td className="p-2">{item.productName}</td>
                        <td className="p-2 text-center">{item.quantity}</td>
                        <td className="p-2 text-center">{item.unitType}</td>
                        <td className="p-2 text-right">{formatKES(item.pricePerUnit)}</td>
                        <td className="p-2 text-right font-medium">{formatKES(item.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-6 text-xs pt-1">
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">{formatKES(transaction.subtotal)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">VAT:</span>
                  <span className="font-medium">{formatKES(transaction.taxAmount)}</span>
                </div>
                {transaction.discountAmount > 0 && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Discount:</span>
                    <span className="font-medium text-green-600">-{formatKES(transaction.discountAmount)}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground font-semibold">Total:</span>
                  <span className="font-bold">{formatKES(transaction.totalAmount)}</span>
                </div>
              </div>
              {transaction.cashier && (
                <p className="text-[10px] text-muted-foreground">Cashier: {transaction.cashier.name}</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ============================================================================
// TRANSACTIONS TAB
// ============================================================================

export default function TransactionsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<string>('all');

  // Compute date range
  const dateRange = useMemo(() => {
    if (datePreset === 'custom' && customDateFrom && customDateTo) {
      return {
        from: startOfDay(new Date(customDateFrom)),
        to: endOfDay(new Date(customDateTo)),
      };
    }
    return getDateRange(datePreset);
  }, [datePreset, customDateFrom, customDateTo]);

  // Fetch transactions
  const { data: transactionsData, isLoading } = useQuery({
    queryKey: ['transactions', currentStoreId, dateRange, paymentFilter],
    queryFn: async () => {
      const params: Record<string, string | undefined> = {
        storeId: currentStoreId,
        limit: '200',
        dateFrom: toISOString(dateRange.from),
        dateTo: toISOString(dateRange.to),
      };
      if (paymentFilter !== 'all') {
        params.paymentMethod = paymentFilter;
      }
      const res = await transactionsApi.list(params);
      return res.data || [];
    },
  });

  const transactions = transactionsData || [];

  // Filter by search query
  const filteredTransactions = useMemo(() => {
    if (!searchQuery.trim()) return transactions;
    const q = searchQuery.toLowerCase();
    return transactions.filter(
      (t) =>
        t.receiptNumber.toLowerCase().includes(q) ||
        (t.customer?.name || '').toLowerCase().includes(q)
    );
  }, [transactions, searchQuery]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalSales = filteredTransactions.reduce((sum, t) => sum + t.totalAmount, 0);
    const totalCount = filteredTransactions.length;
    const avgValue = totalCount > 0 ? totalSales / totalCount : 0;

    // Top payment method
    const methodCounts: Record<string, number> = {};
    filteredTransactions.forEach((t) => {
      methodCounts[t.paymentMethod] = (methodCounts[t.paymentMethod] || 0) + 1;
    });
    const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0];

    return { totalSales, totalCount, avgValue, topMethod: topMethod ? topMethod[0] : 'N/A' };
  }, [filteredTransactions]);

  const handleToggleRow = useCallback((id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500 py-0">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/20">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Period Sales</p>
              <p className="text-sm sm:text-base font-bold text-green-600 dark:text-green-400 whitespace-nowrap">{formatKES(summaryStats.totalSales)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500 py-0">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/20">
              <Hash className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Transactions</p>
              <p className="text-sm sm:text-base font-bold text-blue-600 dark:text-blue-400">{summaryStats.totalCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 py-0">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/20">
              <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Avg. Value</p>
              <p className="text-sm sm:text-base font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{formatKES(summaryStats.avgValue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500 py-0">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/20">
              <ShoppingBag className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Top Method</p>
              <p className="text-sm sm:text-base font-bold text-purple-600 dark:text-purple-400">{summaryStats.topMethod}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Date presets */}
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setDatePreset(preset.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  datePreset === preset.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            ))}
            {datePreset === 'custom' && (
              <div className="flex items-center gap-2 ml-2">
                <Input
                  type="date"
                  value={customDateFrom}
                  onChange={(e) => setCustomDateFrom(e.target.value)}
                  className="h-8 text-xs w-36"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={customDateTo}
                  onChange={(e) => setCustomDateTo(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>
            )}
          </div>

          {/* Payment method filter */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            {['all', 'CASH', 'MPESA', 'DEBT'].map((method) => (
              <button
                key={method}
                onClick={() => setPaymentFilter(method)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  paymentFilter === method
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
              >
                {method === 'all' ? 'All Methods' : method}
              </button>
            ))}
          </div>

          {/* Search and Export */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by receipt # or customer name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTransactionsCSV(filteredTransactions)}
              disabled={filteredTransactions.length === 0}
              className="shrink-0"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Transactions
              <Badge variant="secondary" className="text-xs">{filteredTransactions.length}</Badge>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-16">
              <div className="relative mx-auto w-20 h-20 mb-4">
                <div className="absolute inset-0 bg-muted rounded-2xl" />
                <ShoppingBag className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
              </div>
              <p className="text-base font-medium text-muted-foreground">No transactions found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your date range or filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[calc(100vh-28rem)] overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Receipt #</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs text-center">Items</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs">Payment</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      isExpanded={expandedRow === transaction.id}
                      onToggle={() => handleToggleRow(transaction.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
