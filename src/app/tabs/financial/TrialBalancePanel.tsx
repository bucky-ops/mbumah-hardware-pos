'use client';

/**
 * TrialBalancePanel — Phase 3 sub-tab.
 *
 * Provides:
 *   • Generate Trial Balance button → GET /api/financial/trial-balance with
 *     an as-of date picker. Renders the standard 4-column trial balance table
 *     (account code, name, type, debit, credit, net balance) and a totals row
 *     with the balanced/unbalanced indicator.
 *   • Capture Snapshot button → POST /api/financial/trial-balance/snapshot to
 *     freeze the current trial balance as an immutable Json blob.
 *   • Snapshots history list (below) → fetched from
 *     GET /api/financial/trial-balance/snapshot. Clicking a snapshot opens a
 *     dialog showing the captured per-account balances.
 *   • Export to CSV + Print buttons (using the shared helpers).
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Scale, Download, Printer, Camera, Loader2, Calendar as CalendarIcon, History,
} from 'lucide-react';

import { financialApi, formatKES, formatDate } from '@/lib/api';
import { useAppStore, useAuthStore } from '@/lib/stores';

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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

import {
  exportToCSV, printReport, accountTypeColors,
} from './shared';

interface TrialBalanceAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  lineCount: number;
}

interface TrialBalanceResult {
  asOfDate: string;
  storeId: string | null;
  totalDebits: number;
  totalCredits: number;
  totalDebitsFormatted: string;
  totalCreditsFormatted: string;
  isBalanced: boolean;
  variance: number;
  varianceFormatted: string;
  accounts: TrialBalanceAccount[];
}

interface SnapshotBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  netBalance: number;
}

function isSnapshotBalancesArray(value: unknown): value is SnapshotBalanceRow[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) => item && typeof item === 'object' && 'accountCode' in item,
  );
}

export default function TrialBalancePanel() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [asOfDate, setAsOfDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  );
  const [viewSnapshotId, setViewSnapshotId] = useState<string | null>(null);

  const { data: tbResponse, isLoading: tbLoading, refetch: refetchTB } = useQuery({
    queryKey: ['trial-balance', currentStoreId, asOfDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('storeId', currentStoreId);
      params.set('asOfDate', asOfDate);
      const res = await fetch(`/api/financial/trial-balance?${params.toString()}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean; data: TrialBalanceResult }>;
    },
    enabled: !!currentStoreId,
  });
  const tb = tbResponse?.data;

  const { data: snapshotsResponse, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['trial-balance-snapshots', currentStoreId],
    queryFn: () => financialApi.listSnapshots(currentStoreId),
    enabled: !!currentStoreId,
  });
  const snapshots = Array.isArray(snapshotsResponse?.data) ? snapshotsResponse.data : [];

  const captureMutation = useMutation({
    mutationFn: () =>
      financialApi.captureSnapshot({
        storeId: currentStoreId,
        generatedByUserId: authUser!.id,
        snapshotDate: asOfDate,
      }),
    onSuccess: () => {
      toast.success('Trial balance snapshot captured');
      queryClient.invalidateQueries({ queryKey: ['trial-balance-snapshots', currentStoreId] });
    },
    onError: (error: Error) => toast.error(`Failed to capture snapshot: ${error.message}`),
  });

  const handleExport = () => {
    if (!tb) return;
    const rows = tb.accounts.map((a) => ({
      Code: a.accountCode,
      Name: a.accountName,
      Type: a.accountType,
      Debit: a.totalDebit.toFixed(2),
      Credit: a.totalCredit.toFixed(2),
      NetBalance: a.netBalance.toFixed(2),
      LineCount: a.lineCount,
    }));
    rows.push({
      Code: 'TOTAL',
      Name: '',
      Type: '',
      Debit: tb.totalDebits.toFixed(2),
      Credit: tb.totalCredits.toFixed(2),
      NetBalance: '',
      LineCount: 0,
    });
    exportToCSV(rows, 'trial_balance');
  };

  const handleGenerate = () => {
    refetchTB();
    toast.success('Trial balance refreshed');
  };

  const selectedSnapshot = snapshots.find((s) => s.id === viewSnapshotId) || null;
  const selectedBalances: SnapshotBalanceRow[] = selectedSnapshot && isSnapshotBalancesArray(selectedSnapshot.balances)
    ? selectedSnapshot.balances
    : [];

  return (
    <div className="space-y-4">
      {/* Controls + Generate */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4" /> Trial Balance
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs text-muted-foreground">As of:</Label>
                <Input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="w-32 h-8 text-xs"
                />
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={handleGenerate} disabled={tbLoading}>
                {tbLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Scale className="mr-1 h-3 w-3" />}
                Generate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => captureMutation.mutate()}
                disabled={captureMutation.isPending || !authUser}
              >
                {captureMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Camera className="mr-1 h-3 w-3" />}
                Capture Snapshot
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport} disabled={!tb}>
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={printReport}>
                <Printer className="mr-1 h-3 w-3" /> Print
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tbLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : !tb ? (
            <div className="py-12 text-center">
              <Scale className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No trial balance generated yet</p>
              <p className="text-xs text-muted-foreground mt-1">Click &ldquo;Generate&rdquo; to compute balances as of the selected date.</p>
            </div>
          ) : tb.accounts.length === 0 ? (
            <div className="py-12 text-center">
              <Scale className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No posted journal-entry lines as of this date</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tb.accounts.map((a) => {
                    const colors = accountTypeColors[a.accountType] || accountTypeColors.ASSET;
                    return (
                      <TableRow key={a.accountCode}>
                        <TableCell className="font-mono text-xs">{a.accountCode}</TableCell>
                        <TableCell className="text-sm">{a.accountName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${colors.text}`}>
                            {a.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono text-blue-600 dark:text-blue-400">
                          {a.totalDebit > 0 ? formatKES(a.totalDebit) : ''}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono text-green-600 dark:text-green-400">
                          {a.totalCredit > 0 ? formatKES(a.totalCredit) : ''}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {formatKES(Math.abs(a.netBalance))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 bg-muted/30">
                    <TableCell colSpan={3} className="font-bold text-sm">TOTAL</TableCell>
                    <TableCell className="text-right text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                      {formatKES(tb.totalDebits)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono font-bold text-green-600 dark:text-green-400">
                      {formatKES(tb.totalCredits)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono font-bold">
                      {tb.isBalanced ? '✓' : `Δ ${formatKES(Math.abs(tb.variance))}`}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          {tb && (
            <div className="p-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                As of <strong>{formatDate(tb.asOfDate)}</strong> · {tb.accounts.length} accounts
              </span>
              <Badge className={tb.isBalanced
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
                {tb.isBalanced ? '✓ Balanced' : `✗ Unbalanced (${tb.varianceFormatted})`}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snapshots History */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Snapshot History
            </CardTitle>
            <Badge variant="outline" className="text-xs">{snapshots.length} snapshots</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {snapshotsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : snapshots.length === 0 ? (
            <div className="py-10 text-center">
              <History className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No snapshots captured yet</p>
              <p className="text-xs text-muted-foreground mt-1">Use &ldquo;Capture Snapshot&rdquo; to freeze the trial balance for archival.</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Snapshot Date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Debits</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead>Balanced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setViewSnapshotId(s.id)}
                    >
                      <TableCell className="text-sm">{formatDate(s.snapshotDate)}</TableCell>
                      <TableCell className="text-sm">{s.period?.periodName || '—'}</TableCell>
                      <TableCell className="text-right text-sm font-mono text-blue-600 dark:text-blue-400">
                        {formatKES(s.totalDebits)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono text-green-600 dark:text-green-400">
                        {formatKES(s.totalCredits)}
                      </TableCell>
                      <TableCell>
                        <Badge className={s.isBalanced
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
                          {s.isBalanced ? '✓' : '✗'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Viewer Dialog */}
      <Dialog open={!!viewSnapshotId} onOpenChange={(open) => { if (!open) setViewSnapshotId(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" /> Snapshot Detail
            </DialogTitle>
            <DialogDescription>
              {selectedSnapshot ? `Captured ${formatDate(selectedSnapshot.snapshotDate)} · Period: ${selectedSnapshot.period?.periodName || '—'}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            {selectedBalances.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">No balance rows recorded in this snapshot.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedBalances.map((b, i) => (
                    <TableRow key={`${b.accountCode}-${i}`}>
                      <TableCell className="font-mono text-xs">{b.accountCode}</TableCell>
                      <TableCell className="text-sm">{b.accountName}</TableCell>
                      <TableCell className="text-xs">{b.accountType}</TableCell>
                      <TableCell className="text-right text-sm font-mono text-blue-600 dark:text-blue-400">
                        {b.debit > 0 ? formatKES(b.debit) : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono text-green-600 dark:text-green-400">
                        {b.credit > 0 ? formatKES(b.credit) : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">{formatKES(Math.abs(b.netBalance))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between text-xs px-1">
            <span>Total Debits: <strong className="font-mono text-blue-600 dark:text-blue-400">{selectedSnapshot ? formatKES(selectedSnapshot.totalDebits) : '—'}</strong></span>
            <span>Total Credits: <strong className="font-mono text-green-600 dark:text-green-400">{selectedSnapshot ? formatKES(selectedSnapshot.totalCredits) : '—'}</strong></span>
            <Badge className={selectedSnapshot?.isBalanced
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
              {selectedSnapshot?.isBalanced ? 'Balanced' : 'Unbalanced'}
            </Badge>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
