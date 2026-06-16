'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, Search, Download, ChevronDown, ChevronUp,
  CalendarDays, TrendingUp, Hash, CreditCard, Smartphone, Banknote, Wallet,
  Filter, FileText, RotateCcw, Ban, Eye, Printer, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, Receipt, X, MessageCircle,
} from 'lucide-react';

import { transactionsApi, whatsappApi, formatKES, formatDateTime, type TransactionItem, type SaleItemDetail } from '@/lib/api';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

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

type TransactionType = 'sale' | 'refund' | 'void';

function getTransactionType(transaction: TransactionItem): TransactionType {
  if (transaction.paymentStatus === 'REFUNDED') return 'refund';
  if (transaction.paymentStatus === 'VOIDED' || transaction.paymentStatus === 'CANCELLED') return 'void';
  return 'sale';
}

function getTransactionTypeIcon(type: TransactionType) {
  switch (type) {
    case 'sale': return <ShoppingBag className="h-3.5 w-3.5" />;
    case 'refund': return <RotateCcw className="h-3.5 w-3.5" />;
    case 'void': return <Ban className="h-3.5 w-3.5" />;
  }
}

function getTransactionTypeColor(type: TransactionType): string {
  switch (type) {
    case 'sale': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'refund': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'void': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  }
}

function getTransactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'sale': return 'Sale';
    case 'refund': return 'Refund';
    case 'void': return 'Void';
  }
}

function getPaymentMethodColor(method: string): string {
  switch (method) {
    case 'CASH': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'MPESA': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'DEBT': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

function getPaymentMethodIcon(method: string) {
  switch (method) {
    case 'CASH': return <Banknote className="h-3 w-3" />;
    case 'MPESA': return <Smartphone className="h-3 w-3" />;
    case 'DEBT': return <CreditCard className="h-3 w-3" />;
    default: return <Wallet className="h-3 w-3" />;
  }
}

function getPaymentStatusLabel(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'Completed';
    case 'PENDING': return 'Pending';
    case 'FAILED': return 'Failed';
    case 'REFUNDED': return 'Refunded';
    case 'PARTIAL': return 'Partial';
    case 'VOIDED': return 'Voided';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

function getPaymentStatusColor(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'PENDING': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'FAILED': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'REFUNDED': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'VOIDED': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

function exportTransactionsCSV(transactions: TransactionItem[]): void {
  if (transactions.length === 0) return;

  const headers = ['Receipt #', 'Date', 'Customer', 'Type', 'Items', 'Subtotal', 'Tax', 'Discount', 'Total', 'Payment Method', 'Status'];
  const rows = transactions.map((t) => [
    t.receiptNumber,
    formatDateTime(t.createdAt),
    t.customer?.name || 'Walk-in',
    getTransactionTypeLabel(getTransactionType(t)),
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

// MINI TREND CHART (SVG-based)

function MiniTrendChart({ data, height = 40 }: { data: { label: string; value: number }[]; height?: number }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const w = 160;

  return (
    <svg width={w} height={height} className="w-full">
      <defs>
        <linearGradient id="trendGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <path
        d={data.map((d, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = height - (d.value / max) * (height - 6) - 3;
          return `${i === 0 ? 'M' : 'L'}${x},${y}`;
        }).join(' ') + ` L${w},${height} L0,${height} Z`}
        fill="url(#trendGrad)"
        className="text-primary"
      />
      {/* Line */}
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={data.map((d, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = height - (d.value / max) * (height - 6) - 3;
          return `${x},${y}`;
        }).join(' ')}
        className="text-primary"
      />
    </svg>
  );
}

function ReceiptModal({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionItem | null;
}) {
  if (!transaction) return null;

  const items = transaction.items || [];

  const handlePrint = () => {
    const printContent = document.getElementById('receipt-print-area');
    if (!printContent) return;
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head><title>Receipt ${transaction.receiptNumber}</title>
        <style>
          body { font-family: monospace; padding: 20px; font-size: 12px; max-width: 300px; margin: 0 auto; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; }
          td { padding: 2px 0; }
          .right { text-align: right; }
        </style></head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> View Receipt
          </DialogTitle>
          <DialogDescription>Receipt #{transaction.receiptNumber}</DialogDescription>
        </DialogHeader>
        <div id="receipt-print-area" className="space-y-4">
          {/* Store Header */}
          <div className="text-center space-y-1">
            <h3 className="font-bold text-lg">MBUMAH HARDWARE</h3>
            <p className="text-xs text-muted-foreground">Receipt #{transaction.receiptNumber}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(transaction.createdAt)}</p>
          </div>
          <Separator />
          {/* Customer Info */}
          <div className="text-xs">
            <span className="text-muted-foreground">Customer: </span>
            <span className="font-medium">{transaction.customer?.name || 'Walk-in'}</span>
          </div>
          {/* Line Items */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2">Item</th>
                  <th className="text-center p-2">Qty</th>
                  <th className="text-right p-2">Price</th>
                  <th className="text-right p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: SaleItemDetail) => (
                  <tr key={item.id} className="border-t border-border/50">
                    <td className="p-2">{item.productName}</td>
                    <td className="p-2 text-center">{item.quantity}</td>
                    <td className="p-2 text-right">{formatKES(item.pricePerUnit)}</td>
                    <td className="p-2 text-right font-medium">{formatKES(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Totals */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{formatKES(transaction.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT:</span><span>{formatKES(transaction.taxAmount)}</span></div>
            {transaction.discountAmount > 0 && (
              <div className="flex justify-between text-green-600"><span>Discount:</span><span>-{formatKES(transaction.discountAmount)}</span></div>
            )}
            <Separator />
            <div className="flex justify-between font-bold text-sm"><span>TOTAL:</span><span>{formatKES(transaction.totalAmount)}</span></div>
          </div>
          {/* Payment Info */}
          <div className="text-xs text-center text-muted-foreground space-y-0.5">
            <p>Paid via {transaction.paymentMethod}</p>
            <p>Status: {getPaymentStatusLabel(transaction.paymentStatus)}</p>
            {transaction.cashier && <p>Cashier: {transaction.cashier.name}</p>}
          </div>
          <div className="text-center text-[10px] text-muted-foreground pt-2">Thank you for your business!</div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  isPending,
  variant = 'destructive',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  isPending: boolean;
  variant?: 'destructive' | 'default';
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${variant === 'destructive' ? 'text-red-600' : 'text-amber-600'}`} />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={variant} onClick={onConfirm} disabled={isPending}>
            {isPending && <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// TRANSACTION ROW (expandable with actions)

function TransactionRow({
  transaction,
  isExpanded,
  onToggle,
  onViewReceipt,
  onRefund,
  onVoid,
  onSendWhatsApp,
}: {
  transaction: TransactionItem;
  isExpanded: boolean;
  onToggle: () => void;
  onViewReceipt: () => void;
  onRefund: () => void;
  onVoid: () => void;
  onSendWhatsApp: () => void;
}) {
  const items = transaction.items || [];
  const txType = getTransactionType(transaction);

  return (
    <>
      <TableRow
        className={`cursor-pointer transition-colors ${
          txType === 'void' ? 'opacity-50 bg-red-50/50 dark:bg-red-950/10' :
          txType === 'refund' ? 'bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-50 dark:hover:bg-amber-950/20' :
          'hover:bg-muted/50'
        }`}
        onClick={onToggle}
      >
        <TableCell className="font-mono text-xs">
          <div className="flex items-center gap-1.5">
            {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            {transaction.receiptNumber}
          </div>
        </TableCell>
        <TableCell className="text-xs">
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 gap-0.5 ${getTransactionTypeColor(txType)}`}>
            {getTransactionTypeIcon(txType)}
            {getTransactionTypeLabel(txType)}
          </Badge>
        </TableCell>
        <TableCell className="text-xs">{formatDateTime(transaction.createdAt)}</TableCell>
        <TableCell className="text-xs">{transaction.customer?.name || 'Walk-in'}</TableCell>
        <TableCell className="text-xs text-center">{items.length}</TableCell>
        <TableCell className="text-xs font-bold text-right">
          <span className={txType === 'refund' ? 'text-amber-600' : txType === 'void' ? 'text-red-600 line-through' : 'text-foreground'}>
            {txType === 'refund' ? '-' : ''}{formatKES(transaction.totalAmount)}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 gap-0.5 ${getPaymentMethodColor(transaction.paymentMethod)}`}>
            {getPaymentMethodIcon(transaction.paymentMethod)}
            {transaction.paymentMethod}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${getPaymentStatusColor(transaction.paymentStatus)}`}>
            {getPaymentStatusLabel(transaction.paymentStatus)}
          </Badge>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className={`bg-muted/20 ${txType === 'void' ? 'opacity-50' : ''}`}>
          <TableCell colSpan={8} className="p-3">
            <div className="space-y-3">
              {/* Line Items */}
              {items.length > 0 && (
                <>
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
                </>
              )}
              {/* Totals Row */}
              <div className="flex flex-wrap justify-end gap-4 text-xs">
                <div className="flex gap-2"><span className="text-muted-foreground">Subtotal:</span><span className="font-medium">{formatKES(transaction.subtotal)}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground">VAT:</span><span className="font-medium">{formatKES(transaction.taxAmount)}</span></div>
                {transaction.discountAmount > 0 && (
                  <div className="flex gap-2"><span className="text-muted-foreground">Discount:</span><span className="font-medium text-green-600">-{formatKES(transaction.discountAmount)}</span></div>
                )}
                <div className="flex gap-2"><span className="text-muted-foreground font-semibold">Total:</span><span className="font-bold">{formatKES(transaction.totalAmount)}</span></div>
              </div>
              {transaction.cashier && (
                <p className="text-[10px] text-muted-foreground">Cashier: {transaction.cashier.name}</p>
              )}
              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1 border-t">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onViewReceipt(); }}>
                  <Eye className="h-3 w-3 mr-1" /> View Receipt
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onViewReceipt(); }}>
                  <Printer className="h-3 w-3 mr-1" /> Reprint
                </Button>
                {txType === 'sale' && transaction.paymentStatus === 'COMPLETED' && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30" onClick={(e) => { e.stopPropagation(); onRefund(); }}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Refund
                  </Button>
                )}
                {txType === 'sale' && transaction.paymentStatus === 'COMPLETED' && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={(e) => { e.stopPropagation(); onVoid(); }}>
                    <Ban className="h-3 w-3 mr-1" /> Void
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30" onClick={(e) => { e.stopPropagation(); onSendWhatsApp(); }}>
                  <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function TransactionsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [amountFilterMin, setAmountFilterMin] = useState('');
  const [amountFilterMax, setAmountFilterMax] = useState('');
  const [showAmountFilter, setShowAmountFilter] = useState(false);

  // Receipt modal state
  const [receiptTransaction, setReceiptTransaction] = useState<TransactionItem | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Refund/Void dialog state
  const [refundTransaction, setRefundTransaction] = useState<TransactionItem | null>(null);
  const [voidTransaction, setVoidTransaction] = useState<TransactionItem | null>(null);

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
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const transactions = transactionsData || [];

  // Filter by search query, type, and amount
  const filteredTransactions = useMemo(() => {
    let result = transactions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.receiptNumber.toLowerCase().includes(q) ||
          (t.customer?.name || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter !== 'all') {
      result = result.filter((t) => getTransactionType(t) === typeFilter);
    }
    if (amountFilterMin) {
      result = result.filter((t) => t.totalAmount >= Number(amountFilterMin));
    }
    if (amountFilterMax) {
      result = result.filter((t) => t.totalAmount <= Number(amountFilterMax));
    }
    return result;
  }, [transactions, searchQuery, typeFilter, amountFilterMin, amountFilterMax]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalSales = filteredTransactions
      .filter(t => getTransactionType(t) === 'sale')
      .reduce((sum, t) => sum + t.totalAmount, 0);
    const totalRefunds = filteredTransactions
      .filter(t => getTransactionType(t) === 'refund')
      .reduce((sum, t) => sum + t.totalAmount, 0);
    const netRevenue = totalSales - totalRefunds;
    const totalCount = filteredTransactions.length;
    const avgValue = totalCount > 0 ? totalSales / filteredTransactions.filter(t => getTransactionType(t) === 'sale').length || 0 : 0;

    return { totalSales, totalRefunds, netRevenue, totalCount, avgValue };
  }, [filteredTransactions]);

  // Mini trend chart data - daily totals
  const trendData = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    transactions.forEach(t => {
      const day = new Date(t.createdAt).toISOString().split('T')[0];
      dailyMap[day] = (dailyMap[day] || 0) + t.totalAmount;
    });
    return Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ label: date.slice(5), value }));
  }, [transactions]);

  const handleToggleRow = useCallback((id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  }, []);

  const handleViewReceipt = useCallback((transaction: TransactionItem) => {
    setReceiptTransaction(transaction);
    setReceiptOpen(true);
  }, []);

  const handleRefund = useCallback((transaction: TransactionItem) => {
    setRefundTransaction(transaction);
  }, []);

  const handleVoid = useCallback((transaction: TransactionItem) => {
    setVoidTransaction(transaction);
  }, []);

  const handleSendReceiptWhatsApp = useCallback(async (transaction: TransactionItem) => {
    try {
      const phone = prompt('Enter WhatsApp phone number:', transaction.customer?.phone || '') || '';
      if (!phone) return;
      const res = await whatsappApi.sendDocument({
        type: 'receipt',
        documentId: transaction.id,
        storeId: currentStoreId,
        phone,
      });
      if (res.waLink) {
        window.open(res.waLink, '_blank');
        toast.success(`${res.documentTitle} sent via WhatsApp`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send via WhatsApp');
    }
  }, [currentStoreId]);

  return (
    <div className="space-y-6">
      {/* Summary Cards - Glass-morphism */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/20">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Total Sales</p>
              <p className="text-sm sm:text-base font-bold text-green-600 dark:text-green-400 whitespace-nowrap">{formatKES(summaryStats.totalSales)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/20">
              <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Total Refunds</p>
              <p className="text-sm sm:text-base font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{formatKES(summaryStats.totalRefunds)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/20">
              <Hash className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Net Revenue</p>
              <p className="text-sm sm:text-base font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{formatKES(summaryStats.netRevenue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="shrink-0 p-2 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/20">
                <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs text-muted-foreground">Transactions</p>
                <p className="text-sm sm:text-base font-bold text-blue-600 dark:text-blue-400">{summaryStats.totalCount}</p>
              </div>
            </div>
            {/* Mini Trend Chart */}
            {trendData.length > 1 && (
              <div className="mt-2 pt-2 border-t border-border/30">
                <MiniTrendChart data={trendData} height={28} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search - Glass Card */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1 ${
                  paymentFilter === method
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
              >
                {method !== 'all' && getPaymentMethodIcon(method)}
                {method === 'all' ? 'All Methods' : method}
              </button>
            ))}
          </div>

          {/* Transaction type filter */}
          <div className="flex flex-wrap items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
            {['all', 'sale', 'refund', 'void'].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1 ${
                  typeFilter === type
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
              >
                {type !== 'all' && getTransactionTypeIcon(type as TransactionType)}
                {type === 'all' ? 'All Types' : getTransactionTypeLabel(type as TransactionType)}
              </button>
            ))}
            <button
              onClick={() => setShowAmountFilter(!showAmountFilter)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                showAmountFilter || amountFilterMin || amountFilterMax
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              }`}
            >
              Amount Range
            </button>
          </div>

          {/* Amount range filter */}
          {showAmountFilter && (
            <div className="flex items-center gap-2 pl-6">
              <span className="text-xs text-muted-foreground">KES</span>
              <Input
                type="number"
                placeholder="Min"
                value={amountFilterMin}
                onChange={(e) => setAmountFilterMin(e.target.value)}
                className="h-8 text-xs w-28"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                placeholder="Max"
                value={amountFilterMax}
                onChange={(e) => setAmountFilterMax(e.target.value)}
                className="h-8 text-xs w-28"
              />
              {(amountFilterMin || amountFilterMax) && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAmountFilterMin(''); setAmountFilterMax(''); }}>
                  <X className="h-3 w-3 mr-1" /> Clear
                </Button>
              )}
            </div>
          )}

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
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
                <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm rounded-2xl border border-border/30" />
                <ShoppingBag className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
              </div>
              <p className="text-base font-medium text-muted-foreground">No transactions found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your date range or filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[calc(100vh-32rem)] overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Receipt #</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
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
                      onViewReceipt={() => handleViewReceipt(transaction)}
                      onRefund={() => handleRefund(transaction)}
                      onVoid={() => handleVoid(transaction)}
                      onSendWhatsApp={() => handleSendReceiptWhatsApp(transaction)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Modal */}
      <ReceiptModal
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        transaction={receiptTransaction}
      />

      {/* Refund Confirmation */}
      <ConfirmActionDialog
        open={!!refundTransaction}
        onOpenChange={(open) => { if (!open) setRefundTransaction(null); }}
        title="Confirm Refund"
        description={`Are you sure you want to refund transaction ${refundTransaction?.receiptNumber}? This will reverse the payment of ${refundTransaction ? formatKES(refundTransaction.totalAmount) : ''}.`}
        onConfirm={() => {
          // Refund placeholder - would call API
          setRefundTransaction(null);
        }}
        isPending={false}
        variant="destructive"
      />

      {/* Void Confirmation */}
      <ConfirmActionDialog
        open={!!voidTransaction}
        onOpenChange={(open) => { if (!open) setVoidTransaction(null); }}
        title="Confirm Void"
        description={`Are you sure you want to void transaction ${voidTransaction?.receiptNumber}? This action cannot be undone.`}
        onConfirm={() => {
          // Void placeholder - would call API
          setVoidTransaction(null);
        }}
        isPending={false}
        variant="destructive"
      />
    </div>
  );
}
