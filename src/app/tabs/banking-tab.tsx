'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wallet, Landmark, ArrowUpRight, ArrowDownRight, Search,
  Plus, Loader2, Filter, Building2, CheckCircle2, Clock,
  AlertCircle, ChevronLeft, ChevronRight, Phone,
  FileText, Banknote, RefreshCw, Eye, X, Minus,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  bankingApi,
  formatKES, formatDate, formatDateTime,
  type BankAccountItem,
  type BankTransactionItem,
  type BankReconciliationItem,
  type MpesaReconciliationItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';

// ── Helpers ──────────────────────────────────────────────────

const ACCOUNT_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  CHECKING: { label: 'Checking', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  SAVINGS: { label: 'Savings', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  MPESA: { label: 'M-Pesa', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  PETTY_CASH: { label: 'Petty Cash', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

const TX_TYPE_BADGE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  DEPOSIT: { label: 'Deposit', icon: ArrowDownRight, color: 'text-emerald-600' },
  WITHDRAWAL: { label: 'Withdrawal', icon: ArrowUpRight, color: 'text-red-600' },
  TRANSFER: { label: 'Transfer', icon: RefreshCw, color: 'text-blue-600' },
  FEE: { label: 'Fee', icon: Minus, color: 'text-orange-600' },
  INTEREST: { label: 'Interest', icon: ArrowDownRight, color: 'text-violet-600' },
};

const RECON_STATUS_BADGE: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  COMPLETED: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
};

const MPESA_STATUS_BADGE: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  MATCHED: { label: 'Matched', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  UNMATCHED: { label: 'Unmatched', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  DISPUTED: { label: 'Disputed', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

// ── Main Component ──────────────────────────────────────────

export default function BankingTab() {
  const storeId = useAppStore((s) => s.activeStoreId);
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState('accounts');

  // ── Queries ─────────────────────────────────────────────

  const accountsQuery = useQuery({
    queryKey: ['banking-accounts', storeId],
    queryFn: () => bankingApi.accounts.list({ storeId: storeId ?? undefined, limit: 100 }),
    enabled: !!storeId,
  });

  const transactionsQuery = useQuery({
    queryKey: ['banking-transactions', storeId],
    queryFn: () => bankingApi.transactions.list({ limit: 100 }),
    enabled: !!storeId,
  });

  const reconciliationsQuery = useQuery({
    queryKey: ['banking-reconciliations', storeId],
    queryFn: () => bankingApi.reconciliations.list({ limit: 100 }),
    enabled: !!storeId,
  });

  // M-Pesa reconciliations — we use transactions filtered by MPESA accounts
  // since there is no dedicated mpesa reconciliation API endpoint
  const mpesaAccounts = useMemo(() => {
    const accounts = Array.isArray(accountsQuery.data?.data) ? accountsQuery.data.data : [];
    return accounts.filter((a) => a.accountType === 'MPESA');
  }, [accountsQuery.data]);

  // ── Computed Stats ──────────────────────────────────────

  const accounts = Array.isArray(accountsQuery.data?.data) ? accountsQuery.data.data : [];
  const transactions = Array.isArray(transactionsQuery.data?.data) ? transactionsQuery.data.data : [];
  const reconciliations = Array.isArray(reconciliationsQuery.data?.data) ? reconciliationsQuery.data.data : [];

  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + a.currentBalance, 0),
    [accounts],
  );

  const pendingRecons = useMemo(
    () => reconciliations.filter((r) => r.status === 'DRAFT' || r.status === 'IN_PROGRESS').length,
    [reconciliations],
  );

  const mpesaPending = useMemo(() => {
    // Count unreconciled M-Pesa transactions
    const mpesaAccIds = new Set(mpesaAccounts.map((a) => a.id));
    return transactions.filter(
      (t) => mpesaAccIds.has(t.bankAccountId) && !t.isReconciled,
    ).length;
  }, [transactions, mpesaAccounts]);

  // ── Balance Summary by Type ─────────────────────────────

  const balanceByType = useMemo(() => {
    const map: Record<string, { count: number; balance: number }> = {};
    for (const a of accounts) {
      if (!map[a.accountType]) map[a.accountType] = { count: 0, balance: 0 };
      map[a.accountType].count += 1;
      map[a.accountType].balance += a.currentBalance;
    }
    return map;
  }, [accounts]);

  // ── Dialog States ───────────────────────────────────────

  // Create Account Dialog
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    branch: '',
    swiftCode: '',
    currency: 'KES',
    openingBalance: 0,
    accountType: 'CHECKING' as string,
  });

  // Create Transaction Dialog
  const [showCreateTx, setShowCreateTx] = useState(false);
  const [newTx, setNewTx] = useState({
    bankAccountId: '',
    transactionType: 'DEPOSIT' as string,
    amount: 0,
    reference: '',
    description: '',
    transactionDate: new Date().toISOString().split('T')[0],
  });

  // Create Reconciliation Dialog
  const [showCreateRecon, setShowCreateRecon] = useState(false);
  const [newRecon, setNewRecon] = useState({
    bankAccountId: '',
    statementDate: new Date().toISOString().split('T')[0],
    statementBalance: 0,
    bookBalance: 0,
    notes: '',
  });

  // Approve Reconciliation Dialog
  const [showApproveRecon, setShowApproveRecon] = useState(false);
  const [reconToApprove, setReconToApprove] = useState<BankReconciliationItem | null>(null);

  // View Reconciliation Dialog
  const [showViewRecon, setShowViewRecon] = useState(false);
  const [reconToView, setReconToView] = useState<BankReconciliationItem | null>(null);

  // ── Transaction Filters ─────────────────────────────────

  const [txFilterAccount, setTxFilterAccount] = useState<string>('all');
  const [txFilterType, setTxFilterType] = useState<string>('all');
  const [txFilterReconciled, setTxFilterReconciled] = useState<string>('all');
  const [txFilterDateFrom, setTxFilterDateFrom] = useState('');
  const [txFilterDateTo, setTxFilterDateTo] = useState('');
  const [txSearch, setTxSearch] = useState('');

  // M-Pesa filters
  const [mpesaFilterStatus, setMpesaFilterStatus] = useState<string>('all');

  // Pagination
  const [txPage, setTxPage] = useState(1);
  const TX_PAGE_SIZE = 15;

  // ── Filtered Transactions ───────────────────────────────

  const filteredTransactions = useMemo(() => {
    let list = [...transactions];
    if (txFilterAccount !== 'all') list = list.filter((t) => t.bankAccountId === txFilterAccount);
    if (txFilterType !== 'all') list = list.filter((t) => t.transactionType === txFilterType);
    if (txFilterReconciled !== 'all') {
      const isRecon = txFilterReconciled === 'true';
      list = list.filter((t) => t.isReconciled === isRecon);
    }
    if (txFilterDateFrom) list = list.filter((t) => t.transactionDate >= txFilterDateFrom);
    if (txFilterDateTo) list = list.filter((t) => t.transactionDate <= txFilterDateTo);
    if (txSearch) {
      const s = txSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.reference?.toLowerCase().includes(s) ||
          t.description?.toLowerCase().includes(s) ||
          t.transactionType.toLowerCase().includes(s),
      );
    }
    list.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
    return list;
  }, [transactions, txFilterAccount, txFilterType, txFilterReconciled, txFilterDateFrom, txFilterDateTo, txSearch]);

  const txTotalPages = Math.max(1, Math.ceil(filteredTransactions.length / TX_PAGE_SIZE));
  const pagedTransactions = filteredTransactions.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);

  // ── M-Pesa Data (simulated from transactions on M-Pesa accounts) ──

  const mpesaTransactions = useMemo(() => {
    const mpesaAccIds = new Set(mpesaAccounts.map((a) => a.id));
    return transactions.filter((t) => mpesaAccIds.has(t.bankAccountId));
  }, [transactions, mpesaAccounts]);

  const filteredMpesa = useMemo(() => {
    let list = [...mpesaTransactions];
    // We simulate M-Pesa reconciliation status from isReconciled
    // PENDING = not reconciled, MATCHED = reconciled, UNMATCHED/DISPUTED are not easily derived
    // but we provide the filter UI
    if (mpesaFilterStatus !== 'all') {
      if (mpesaFilterStatus === 'PENDING') list = list.filter((t) => !t.isReconciled);
      else if (mpesaFilterStatus === 'MATCHED') list = list.filter((t) => t.isReconciled);
    }
    list.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
    return list;
  }, [mpesaTransactions, mpesaFilterStatus]);

  // ── Running Balance Calculation for Transaction Dialog ──

  const selectedAccountForTx = useMemo(
    () => accounts.find((a) => a.id === newTx.bankAccountId),
    [accounts, newTx.bankAccountId],
  );

  const projectedBalance = useMemo(() => {
    if (!selectedAccountForTx) return 0;
    const amt = newTx.amount || 0;
    const isCredit = newTx.transactionType === 'DEPOSIT' || newTx.transactionType === 'INTEREST';
    return isCredit
      ? selectedAccountForTx.currentBalance + amt
      : selectedAccountForTx.currentBalance - amt;
  }, [selectedAccountForTx, newTx.amount, newTx.transactionType]);

  // ── Mutations ───────────────────────────────────────────

  const createAccountMut = useMutation({
    mutationFn: (data: Parameters<typeof bankingApi.accounts.create>[0]) =>
      bankingApi.accounts.create(data),
    onSuccess: () => {
      toast.success('Bank account created successfully');
      queryClient.invalidateQueries({ queryKey: ['banking-accounts'] });
      setShowCreateAccount(false);
      setNewAccount({
        bankName: '', accountName: '', accountNumber: '', branch: '',
        swiftCode: '', currency: 'KES', openingBalance: 0, accountType: 'CHECKING',
      });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create account'),
  });

  const createTxMut = useMutation({
    mutationFn: (data: Parameters<typeof bankingApi.transactions.create>[0]) =>
      bankingApi.transactions.create(data),
    onSuccess: () => {
      toast.success('Transaction recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['banking-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['banking-accounts'] });
      setShowCreateTx(false);
      setNewTx({
        bankAccountId: '', transactionType: 'DEPOSIT', amount: 0,
        reference: '', description: '', transactionDate: new Date().toISOString().split('T')[0],
      });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create transaction'),
  });

  const createReconMut = useMutation({
    mutationFn: (data: Parameters<typeof bankingApi.reconciliations.create>[0]) =>
      bankingApi.reconciliations.create(data),
    onSuccess: () => {
      toast.success('Reconciliation created successfully');
      queryClient.invalidateQueries({ queryKey: ['banking-reconciliations'] });
      setShowCreateRecon(false);
      setNewRecon({
        bankAccountId: '', statementDate: new Date().toISOString().split('T')[0],
        statementBalance: 0, bookBalance: 0, notes: '',
      });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create reconciliation'),
  });

  const approveReconMut = useMutation({
    mutationFn: async (recon: BankReconciliationItem) => {
      return bankingApi.reconciliations.create({
        bankAccountId: recon.bankAccountId,
        statementDate: recon.statementDate,
        statementBalance: recon.statementBalance,
        bookBalance: recon.bookBalance,
        notes: recon.notes ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success('Reconciliation approved');
      queryClient.invalidateQueries({ queryKey: ['banking-reconciliations'] });
      setShowApproveRecon(false);
      setReconToApprove(null);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve reconciliation'),
  });

  // ── Helper: get account name ────────────────────────────

  const getAccountName = (accId: string) => {
    const acc = accounts.find((a) => a.id === accId);
    return acc ? `${acc.bankName} — ${acc.accountName}` : accId;
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Banking</h2>
          <p className="text-sm text-muted-foreground">
            Bank accounts, transactions, reconciliations &amp; M-Pesa
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            title: 'Total Bank Balance',
            value: formatKES(totalBalance),
            icon: Wallet,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
          },
          {
            title: 'Total Accounts',
            value: String(accounts.length),
            icon: Landmark,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-950/30',
          },
          {
            title: 'Pending Reconciliations',
            value: String(pendingRecons),
            icon: Clock,
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-950/30',
          },
          {
            title: 'M-Pesa Pending',
            value: String(mpesaPending),
            icon: Phone,
            color: 'text-green-600',
            bg: 'bg-green-50 dark:bg-green-950/30',
          },
        ].map((stat) => (
          <Card key={stat.title} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                  <p className="text-lg font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`rounded-full p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Balance Summary by Type */}
      {Object.keys(balanceByType).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(balanceByType).map(([type, info]) => {
            const badge = ACCOUNT_TYPE_BADGE[type] ?? { label: type, color: 'bg-slate-100 text-slate-700' };
            return (
              <Card key={type}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${badge.color}`}>
                      {badge.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{info.count} account{info.count !== 1 ? 's' : ''}</span>
                  </div>
                  <p className="text-sm font-semibold">{formatKES(info.balance)}</p>
                  <Progress
                    value={totalBalance > 0 ? (info.balance / totalBalance) * 100 : 0}
                    className="mt-1.5 h-1.5"
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Inner Tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="h-9">
          <TabsTrigger value="accounts" className="text-xs px-3">
            <Landmark className="mr-1.5 h-3.5 w-3.5" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs px-3">
            <Banknote className="mr-1.5 h-3.5 w-3.5" /> Transactions
          </TabsTrigger>
          <TabsTrigger value="reconciliations" className="text-xs px-3">
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Reconciliations
          </TabsTrigger>
          <TabsTrigger value="mpesa" className="text-xs px-3">
            <Phone className="mr-1.5 h-3.5 w-3.5" /> M-Pesa
          </TabsTrigger>
        </TabsList>

        {/* ─── BANK ACCOUNTS TAB ──────────────────────────── */}
        <TabsContent value="accounts" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search accounts..." className="pl-9 h-9" readOnly />
              </div>
            </div>
            <Button size="sm" className="h-8" onClick={() => setShowCreateAccount(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New Account
            </Button>
          </div>

          {accountsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Landmark className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No bank accounts yet</p>
                <Button size="sm" variant="outline" className="mt-3 h-8" onClick={() => setShowCreateAccount(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create Account
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank / Account</TableHead>
                    <TableHead>Account #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => {
                    const badge = ACCOUNT_TYPE_BADGE[acc.accountType] ?? { label: acc.accountType, color: 'bg-slate-100 text-slate-700' };
                    return (
                      <TableRow key={acc.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="rounded-full p-1.5 bg-muted">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{acc.bankName}</p>
                              <p className="text-xs text-muted-foreground">{acc.accountName}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">{acc.accountNumber}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${badge.color}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{acc.currency}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatKES(acc.currentBalance)}
                        </TableCell>
                        <TableCell>
                          {acc.isActive ? (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ─── TRANSACTIONS TAB ───────────────────────────── */}
        <TabsContent value="transactions" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search reference, description..."
                className="pl-9 h-9"
                value={txSearch}
                onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }}
              />
            </div>
            <Select value={txFilterAccount} onValueChange={(v) => { setTxFilterAccount(v); setTxPage(1); }}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.bankName} — {a.accountName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={txFilterType} onValueChange={(v) => { setTxFilterType(v); setTxPage(1); }}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="FEE">Fee</SelectItem>
                <SelectItem value="INTEREST">Interest</SelectItem>
              </SelectContent>
            </Select>
            <Select value={txFilterReconciled} onValueChange={(v) => { setTxFilterReconciled(v); setTxPage(1); }}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue placeholder="Reconciled" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">Reconciled</SelectItem>
                <SelectItem value="false">Unreconciled</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="h-9 w-[130px] text-xs"
              value={txFilterDateFrom}
              onChange={(e) => { setTxFilterDateFrom(e.target.value); setTxPage(1); }}
              placeholder="From"
            />
            <Input
              type="date"
              className="h-9 w-[130px] text-xs"
              value={txFilterDateTo}
              onChange={(e) => { setTxFilterDateTo(e.target.value); setTxPage(1); }}
              placeholder="To"
            />
            <Button size="sm" className="h-8" onClick={() => setShowCreateTx(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New Transaction
            </Button>
          </div>

          {/* Results count */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {pagedTransactions.length} of {filteredTransactions.length} transactions
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                disabled={txPage <= 1}
                onClick={() => setTxPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-1">
                {txPage}/{txTotalPages}
              </span>
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                disabled={txPage >= txTotalPages}
                onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {transactionsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pagedTransactions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Banknote className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No transactions found</p>
                <Button size="sm" variant="outline" className="mt-3 h-8" onClick={() => setShowCreateTx(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Record Transaction
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Reconciled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedTransactions.map((tx) => {
                    const info = TX_TYPE_BADGE[tx.transactionType] ?? {
                      label: tx.transactionType, icon: Banknote, color: 'text-slate-600',
                    };
                    const IconComp = info.icon;
                    const isCredit = tx.transactionType === 'DEPOSIT' || tx.transactionType === 'INTEREST';
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm">{formatDate(tx.transactionDate)}</TableCell>
                        <TableCell className="text-sm">{getAccountName(tx.bankAccountId)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <IconComp className={`h-3.5 w-3.5 ${info.color}`} />
                            <span className="text-xs">{info.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isCredit ? '+' : '-'}{formatKES(tx.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {tx.reference || '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatKES(tx.balanceAfter)}
                        </TableCell>
                        <TableCell>
                          {tx.isReconciled ? (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Yes
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              <Clock className="mr-1 h-3 w-3" /> No
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ─── RECONCILIATIONS TAB ────────────────────────── */}
        <TabsContent value="reconciliations" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {reconciliations.length} reconciliation{reconciliations.length !== 1 ? 's' : ''}
            </p>
            <Button size="sm" className="h-8" onClick={() => setShowCreateRecon(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New Reconciliation
            </Button>
          </div>

          {reconciliationsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : reconciliations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No reconciliations yet</p>
                <Button size="sm" variant="outline" className="mt-3 h-8" onClick={() => setShowCreateRecon(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create Reconciliation
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {reconciliations.map((recon) => {
                const statusBadge = RECON_STATUS_BADGE[recon.status] ?? {
                  label: recon.status, color: 'bg-slate-100 text-slate-700',
                };
                const diff = recon.difference;
                const isZeroDiff = Math.abs(diff) < 0.01;
                return (
                  <Card key={recon.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{getAccountName(recon.bankAccountId)}</p>
                            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusBadge.color}`}>
                              {statusBadge.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Statement Date: {formatDate(recon.statementDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => { setReconToView(recon); setShowViewRecon(true); }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(recon.status === 'DRAFT' || recon.status === 'IN_PROGRESS' || recon.status === 'COMPLETED') && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-emerald-600"
                              onClick={() => { setReconToApprove(recon); setShowApproveRecon(true); }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <Separator className="my-3" />
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Statement</p>
                          <p className="text-sm font-semibold">{formatKES(recon.statementBalance)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Book</p>
                          <p className="text-sm font-semibold">{formatKES(recon.bookBalance)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Difference</p>
                          <p className={`text-sm font-semibold ${isZeroDiff ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isZeroDiff ? '✓ Balanced' : formatKES(diff)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── M-PESA TAB ─────────────────────────────────── */}
        <TabsContent value="mpesa" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <Select value={mpesaFilterStatus} onValueChange={setMpesaFilterStatus}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="MATCHED">Matched</SelectItem>
                <SelectItem value="UNMATCHED">Unmatched</SelectItem>
                <SelectItem value="DISPUTED">Disputed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {filteredMpesa.length} M-Pesa transaction{filteredMpesa.length !== 1 ? 's' : ''}
            </p>
          </div>

          {mpesaAccounts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Phone className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No M-Pesa accounts configured</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a bank account with type &ldquo;M-Pesa&rdquo; to start tracking
                </p>
                <Button size="sm" variant="outline" className="mt-3 h-8" onClick={() => { setActiveSubTab('accounts'); setShowCreateAccount(true); }}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create M-Pesa Account
                </Button>
              </CardContent>
            </Card>
          ) : filteredMpesa.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Phone className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No M-Pesa transactions found</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMpesa.map((tx) => {
                    // Map transaction reconciled status to mpesa-like status
                    const status = tx.isReconciled ? 'MATCHED' : 'PENDING';
                    const badge = MPESA_STATUS_BADGE[status] ?? {
                      label: status, color: 'bg-slate-100 text-slate-700',
                    };
                    const isCredit = tx.transactionType === 'DEPOSIT' || tx.transactionType === 'INTEREST';
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm">{formatDate(tx.transactionDate)}</TableCell>
                        <TableCell className="text-sm">{getAccountName(tx.bankAccountId)}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {tx.reference || '—'}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isCredit ? '+' : '-'}{formatKES(tx.amount)}
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatKES(tx.balanceAfter)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${badge.color}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── CREATE ACCOUNT DIALOG ─────────────────────────── */}
      <Dialog open={showCreateAccount} onOpenChange={setShowCreateAccount}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>New Bank Account</DialogTitle>
            <DialogDescription>Add a new bank or M-Pesa account</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Bank Name *</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. KCB Bank"
                  value={newAccount.bankName}
                  onChange={(e) => setNewAccount((p) => ({ ...p, bankName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Account Name *</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. Main Operating"
                  value={newAccount.accountName}
                  onChange={(e) => setNewAccount((p) => ({ ...p, accountName: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Account Number *</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. 1234567890"
                  value={newAccount.accountNumber}
                  onChange={(e) => setNewAccount((p) => ({ ...p, accountNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Account Type *</Label>
                <Select
                  value={newAccount.accountType}
                  onValueChange={(v) => setNewAccount((p) => ({ ...p, accountType: v }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECKING">Checking</SelectItem>
                    <SelectItem value="SAVINGS">Savings</SelectItem>
                    <SelectItem value="MPESA">M-Pesa</SelectItem>
                    <SelectItem value="PETTY_CASH">Petty Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Branch</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. Nairobi CBD"
                  value={newAccount.branch}
                  onChange={(e) => setNewAccount((p) => ({ ...p, branch: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">SWIFT Code</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. KCABOROB"
                  value={newAccount.swiftCode}
                  onChange={(e) => setNewAccount((p) => ({ ...p, swiftCode: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Currency</Label>
                <Select
                  value={newAccount.currency}
                  onValueChange={(v) => setNewAccount((p) => ({ ...p, currency: v }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KES">KES</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Opening Balance</Label>
              <Input
                type="number"
                className="h-9"
                value={newAccount.openingBalance || ''}
                onChange={(e) => setNewAccount((p) => ({ ...p, openingBalance: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setShowCreateAccount(false)}>Cancel</Button>
            <Button
              className="h-9"
              disabled={createAccountMut.isPending || !newAccount.bankName || !newAccount.accountName || !newAccount.accountNumber}
              onClick={() => {
                if (!storeId) return;
                createAccountMut.mutate({
                  storeId,
                  bankName: newAccount.bankName,
                  accountName: newAccount.accountName,
                  accountNumber: newAccount.accountNumber,
                  branch: newAccount.branch || undefined,
                  swiftCode: newAccount.swiftCode || undefined,
                  currency: newAccount.currency,
                  openingBalance: newAccount.openingBalance,
                  accountType: newAccount.accountType,
                });
              }}
            >
              {createAccountMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── CREATE TRANSACTION DIALOG ─────────────────────── */}
      <Dialog open={showCreateTx} onOpenChange={setShowCreateTx}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Transaction</DialogTitle>
            <DialogDescription>Add a deposit, withdrawal, transfer, fee, or interest entry</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Account *</Label>
                <Select
                  value={newTx.bankAccountId}
                  onValueChange={(v) => setNewTx((p) => ({ ...p, bankAccountId: v }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.isActive).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.bankName} — {a.accountName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Type *</Label>
                <Select
                  value={newTx.transactionType}
                  onValueChange={(v) => setNewTx((p) => ({ ...p, transactionType: v }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEPOSIT">Deposit</SelectItem>
                    <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                    <SelectItem value="TRANSFER">Transfer</SelectItem>
                    <SelectItem value="FEE">Fee</SelectItem>
                    <SelectItem value="INTEREST">Interest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Amount *</Label>
                <Input
                  type="number"
                  className="h-9"
                  value={newTx.amount || ''}
                  onChange={(e) => setNewTx((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Date *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={newTx.transactionDate}
                  onChange={(e) => setNewTx((p) => ({ ...p, transactionDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Reference</Label>
              <Input
                className="h-9"
                placeholder="e.g. CHQ-001, MPESA-ABC123"
                value={newTx.reference}
                onChange={(e) => setNewTx((p) => ({ ...p, reference: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Description</Label>
              <Textarea
                className="min-h-[60px] text-sm"
                placeholder="Transaction details..."
                value={newTx.description}
                onChange={(e) => setNewTx((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            {/* Running Balance Preview */}
            {selectedAccountForTx && newTx.amount > 0 && (
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Running Balance Preview</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {formatKES(selectedAccountForTx.currentBalance)}
                  </span>
                  <span className="text-sm">
                    {(newTx.transactionType === 'DEPOSIT' || newTx.transactionType === 'INTEREST') ? (
                      <span className="text-emerald-600">+{formatKES(newTx.amount)}</span>
                    ) : (
                      <span className="text-red-600">-{formatKES(newTx.amount)}</span>
                    )}
                  </span>
                  <span className="text-sm font-semibold">= {formatKES(projectedBalance)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setShowCreateTx(false)}>Cancel</Button>
            <Button
              className="h-9"
              disabled={createTxMut.isPending || !newTx.bankAccountId || !newTx.amount}
              onClick={() => {
                createTxMut.mutate({
                  bankAccountId: newTx.bankAccountId,
                  transactionType: newTx.transactionType,
                  amount: newTx.amount,
                  reference: newTx.reference || undefined,
                  description: newTx.description || undefined,
                  transactionDate: newTx.transactionDate,
                });
              }}
            >
              {createTxMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Record Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── CREATE RECONCILIATION DIALOG ──────────────────── */}
      <Dialog open={showCreateRecon} onOpenChange={setShowCreateRecon}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>New Reconciliation</DialogTitle>
            <DialogDescription>Start a new bank reconciliation</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs">Account *</Label>
              <Select
                value={newRecon.bankAccountId}
                onValueChange={(v) => {
                  const acc = accounts.find((a) => a.id === v);
                  setNewRecon((p) => ({
                    ...p,
                    bankAccountId: v,
                    bookBalance: acc?.currentBalance ?? 0,
                  }));
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => a.isActive).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.bankName} — {a.accountName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Statement Date *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={newRecon.statementDate}
                  onChange={(e) => setNewRecon((p) => ({ ...p, statementDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Statement Balance *</Label>
                <Input
                  type="number"
                  className="h-9"
                  value={newRecon.statementBalance || ''}
                  onChange={(e) => setNewRecon((p) => ({ ...p, statementBalance: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Book Balance</Label>
              <Input
                type="number"
                className="h-9"
                value={newRecon.bookBalance || ''}
                onChange={(e) => setNewRecon((p) => ({ ...p, bookBalance: Number(e.target.value) || 0 }))}
              />
            </div>
            {/* Difference Preview */}
            {newRecon.statementBalance > 0 && (
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Difference</span>
                  <span className={`text-sm font-semibold ${Math.abs(newRecon.statementBalance - newRecon.bookBalance) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatKES(newRecon.statementBalance - newRecon.bookBalance)}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs">Notes</Label>
              <Textarea
                className="min-h-[60px] text-sm"
                placeholder="Reconciliation notes..."
                value={newRecon.notes}
                onChange={(e) => setNewRecon((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setShowCreateRecon(false)}>Cancel</Button>
            <Button
              className="h-9"
              disabled={createReconMut.isPending || !newRecon.bankAccountId || !newRecon.statementDate}
              onClick={() => {
                createReconMut.mutate({
                  bankAccountId: newRecon.bankAccountId,
                  statementDate: newRecon.statementDate,
                  statementBalance: newRecon.statementBalance,
                  bookBalance: newRecon.bookBalance,
                  notes: newRecon.notes || undefined,
                });
              }}
            >
              {createReconMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Reconciliation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── APPROVE RECONCILIATION DIALOG ─────────────────── */}
      <Dialog open={showApproveRecon} onOpenChange={setShowApproveRecon}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Approve Reconciliation</DialogTitle>
            <DialogDescription>Confirm approval of this reconciliation</DialogDescription>
          </DialogHeader>
          {reconToApprove && (
            <div className="space-y-3 py-4">
              <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-medium">{getAccountName(reconToApprove.bankAccountId)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Statement Date</span>
                  <span>{formatDate(reconToApprove.statementDate)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Statement Balance</span>
                  <span className="font-semibold">{formatKES(reconToApprove.statementBalance)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Book Balance</span>
                  <span className="font-semibold">{formatKES(reconToApprove.bookBalance)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Difference</span>
                  <span className={`font-semibold ${Math.abs(reconToApprove.difference) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatKES(reconToApprove.difference)}
                  </span>
                </div>
              </div>
              {Math.abs(reconToApprove.difference) >= 0.01 && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    This reconciliation has a difference of {formatKES(reconToApprove.difference)}. Approving may indicate unresolved items.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setShowApproveRecon(false)}>Cancel</Button>
            <Button
              className="h-9 bg-emerald-600 hover:bg-emerald-700"
              disabled={approveReconMut.isPending}
              onClick={() => {
                if (reconToApprove) approveReconMut.mutate(reconToApprove);
              }}
            >
              {approveReconMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── VIEW RECONCILIATION DIALOG ────────────────────── */}
      <Dialog open={showViewRecon} onOpenChange={setShowViewRecon}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Reconciliation Details</DialogTitle>
            <DialogDescription>View reconciliation information</DialogDescription>
          </DialogHeader>
          {reconToView && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Account</p>
                  <p className="text-sm font-medium mt-0.5">{getAccountName(reconToView.bankAccountId)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Statement Date</p>
                  <p className="text-sm font-medium mt-0.5">{formatDate(reconToView.statementDate)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</p>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 mt-0.5 ${RECON_STATUS_BADGE[reconToView.status]?.color ?? ''}`}
                  >
                    {RECON_STATUS_BADGE[reconToView.status]?.label ?? reconToView.status}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Created</p>
                  <p className="text-sm mt-0.5">{formatDateTime(reconToView.createdAt)}</p>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Statement</p>
                  <p className="text-sm font-semibold mt-1">{formatKES(reconToView.statementBalance)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Book</p>
                  <p className="text-sm font-semibold mt-1">{formatKES(reconToView.bookBalance)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Difference</p>
                  <p className={`text-sm font-semibold mt-1 ${Math.abs(reconToView.difference) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {Math.abs(reconToView.difference) < 0.01 ? '✓ Balanced' : formatKES(reconToView.difference)}
                  </p>
                </div>
              </div>
              {reconToView.notes && (
                <>
                  <Separator />
                  <div className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                    <p className="text-sm">{reconToView.notes}</p>
                  </div>
                </>
              )}
              {reconToView.approvedBy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Approved by {reconToView.approvedBy}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setShowViewRecon(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
