'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, ShoppingBag, CircleDollarSign, KeyRound
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  dashboardApi, financialApi, debtApi,
  formatKES, formatDate,
  type JournalEntryItem,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Simple chart placeholder component
function ChartPlaceholder({ name, className }: { name: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-muted/30 border border-dashed border-muted-foreground/20 rounded-md ${className || 'h-64'}`}>
      <p className="text-sm text-muted-foreground">Chart: {name}</p>
    </div>
  );
}

export default function FinancialTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [dateRange, setDateRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], to: new Date().toISOString().split('T')[0] });

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  const { data: journalData, isLoading: journalLoading } = useQuery({
    queryKey: ['journal-entries', currentStoreId, dateRange],
    queryFn: () => financialApi.listJournalEntries({ storeId: currentStoreId, dateFrom: dateRange.from, dateTo: dateRange.to, limit: 50 }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financialApi.listAccounts(),
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt', currentStoreId],
    queryFn: () => debtApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  const stats = dashboardData?.data;
  const journals = journalData?.data || [];
  const debts = debtData?.data || [];

  // Debt aging summary
  const agingSummary = useMemo(() => {
    const summary = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
    debts.forEach(d => {
      if (d.agingBucket === 'CURRENT') summary.current += d.balance;
      else if (d.agingBucket === 'DAYS_30') summary.days30 += d.balance;
      else if (d.agingBucket === 'DAYS_60') summary.days60 += d.balance;
      else summary.days90Plus += d.balance;
    });
    return summary;
  }, [debts]);

  const paymentBreakdown = stats?.paymentMethodBreakdown || [];

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30"><TrendingUp className="h-5 w-5 text-green-600" /></div><div><p className="text-sm text-muted-foreground">Today Revenue</p><p className="text-xl font-bold">{formatKES(stats?.todayRevenue || 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/10"><ShoppingBag className="h-5 w-5 text-primary" /></div><div><p className="text-sm text-muted-foreground">Today Sales</p><p className="text-xl font-bold">{stats?.todayTransactions || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><CircleDollarSign className="h-5 w-5 text-red-600" /></div><div><p className="text-sm text-muted-foreground">Outstanding Debt</p><p className="text-xl font-bold">{formatKES(stats?.outstandingDebt || 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><KeyRound className="h-5 w-5 text-blue-600" /></div><div><p className="text-sm text-muted-foreground">Active Rentals</p><p className="text-xl font-bold">{stats?.activeRentals || 0}</p></div></div></CardContent></Card>
      </div>

      {/* Charts Row - Replaced with placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Revenue by Hour</CardTitle></CardHeader>
          <CardContent>
            <ChartPlaceholder name="Revenue by Hour" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Debt Aging Analysis</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Current</span>
                <span className="font-medium">{formatKES(agingSummary.current)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>1-30 Days</span>
                <span className="font-medium">{formatKES(agingSummary.days30)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>31-60 Days</span>
                <span className="font-medium">{formatKES(agingSummary.days60)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>90+ Days</span>
                <span className="font-medium">{formatKES(agingSummary.days90Plus)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Method Breakdown - Replaced with placeholder */}
      {paymentBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Payment Method Breakdown</CardTitle></CardHeader>
          <CardContent>
            <ChartPlaceholder name="Payment Method Breakdown" className="h-48" />
          </CardContent>
        </Card>
      )}

      {/* Journal Entries */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Journal Entries</CardTitle>
            <div className="flex gap-2">
              <Input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="w-36 text-sm" />
              <Input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="w-36 text-sm" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {journalLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entry #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journals.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No journal entries</TableCell></TableRow>
                  ) : journals.map((je) => (
                    <TableRow key={je.id}>
                      <TableCell className="font-mono text-sm">{je.entryNumber}</TableCell>
                      <TableCell className="text-sm">{formatDate(je.entryDate)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{je.description}</TableCell>
                      <TableCell className="text-sm">{je.referenceType || '—'}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatKES(je.totalDebit)}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatKES(je.totalCredit)}</TableCell>
                      <TableCell><Badge variant={je.isPosted ? 'secondary' : 'outline'} className="text-[10px]">{je.isPosted ? 'Posted' : 'Draft'}</Badge></TableCell>
                    </TableRow>
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
