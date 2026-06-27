'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  TrendingUp, ShoppingBag, CircleDollarSign, KeyRound,
  ChevronDown, ChevronRight, CalendarDays, Wallet,
  ArrowUpRight, ArrowDownRight, Minus, Landmark,
  FileText, FileCheck, Clock, Download, Printer, CreditCard, Receipt, Plus,
  Send, Banknote, Scale, PiggyBank, CheckCircle2, Loader2, Trash2, Edit2,
  MoreHorizontal, Ban, PowerOff,
} from 'lucide-react';

import { useAppStore, useAuthStore } from '@/lib/stores';
import {
  dashboardApi, financialApi, debtApi, expensesApi,
  formatKES, formatDate,
  type JournalEntryItem, type AccountItem, type ExpenseItem,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Line, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area, ComposedChart,
} from 'recharts';

import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';

// Shared helpers + constants (extracted sub-components in ./financial/ are
// available for future refactor but not yet wired into the orchestrator).
import {
  AnimatedCounter,
  accountTypeColors,
  accountTypeLabels,
  getDatePreset,
  formatRangeLabel,
  exportToCSV,
  printReport,
} from './financial/shared';

// Phase 3 — new sub-tab panels.
import FinancialPeriodsPanel from './financial/FinancialPeriodsPanel';
import TrialBalancePanel from './financial/TrialBalancePanel';
import BudgetsPanel from './financial/BudgetsPanel';
import ReportsPanel from './financial/ReportsPanel';

// Helpers `getDatePreset`, `formatRangeLabel`, `AnimatedCounter`,
// `accountTypeColors`, `accountTypeLabels`, `exportToCSV`, and `printReport`
// were moved into ./financial/shared.tsx and imported above.

// Chart Configs

const revenueChartConfig: ChartConfig = {
  revenue: { label: 'Revenue', color: '#10b981' },
  expenses: { label: 'Expenses', color: '#f97316' },
  movingAvg: { label: '7-Day Avg', color: '#8b5cf6' },
};

const paymentChartConfig: ChartConfig = {
  CASH: { label: 'Cash', color: '#10b981' },
  MPESA: { label: 'M-Pesa', color: '#3b82f6' },
  DEBT: { label: 'Debt', color: '#f59e0b' },
};

const expenseChartConfig: ChartConfig = {
  amount: { label: 'Amount', color: '#f97316' },
};

const profitChartConfig: ChartConfig = {
  margin: { label: 'Profit Margin %', color: '#8b5cf6' },
  revenue: { label: 'Revenue', color: '#10b981' },
  expenses: { label: 'Expenses', color: '#f97316' },
};

const debtAgingChartConfig: ChartConfig = {
  current: { label: 'Current', color: '#22c55e' },
  days30: { label: '1-30 Days', color: '#eab308' },
  days60: { label: '31-60 Days', color: '#f97316' },
  days90Plus: { label: '90+ Days', color: '#ef4444' },
};

// CSS Bar Chart (kept for backward compat)

function CssBarChart({ data, maxVal, labelFormatter, gradientFrom, gradientTo }: {
  data: { label: string; value: number }[];
  maxVal: number;
  labelFormatter?: (v: number) => string;
  gradientFrom?: string;
  gradientTo?: string;
}) {
  const max = maxVal || 1;
  const fromColor = gradientFrom || '#3b82f6';
  const toColor = gradientTo || '#60a5fa';
  return (
    <div className="space-y-1">
      <div className="relative h-40">
        {[0, 25, 50, 75, 100].map((pct) => (
          <div
            key={pct}
            className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/10"
            style={{ bottom: `${pct}%` }}
          >
            <span className="absolute -left-0 -top-3 text-[8px] text-muted-foreground/50">
              {labelFormatter ? labelFormatter(max * pct / 100) : ''}
            </span>
          </div>
        ))}
        <div className="flex items-end gap-1 h-full relative z-10">
          {data.map((d, i) => {
            const pct = Math.max((d.value / max) * 100, 1);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end">
                <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                  {labelFormatter ? labelFormatter(d.value) : d.value > 0 ? d.value.toLocaleString() : ''}
                </span>
                <div
                  className="w-full rounded-t-md transition-all duration-300 hover:opacity-80"
                  style={{
                    height: `${pct}%`,
                    minHeight: d.value > 0 ? '4px' : '0',
                    background: `linear-gradient(to top, ${fromColor}, ${toColor})`,
                  }}
                  title={`${d.label}: ${d.value.toLocaleString()}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 min-w-0">
            <span className="text-[9px] text-muted-foreground truncate w-full text-center block">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionGrid({ data }: { data: { date: string; amount: number }[] }) {
  const maxAmount = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div className="flex flex-wrap gap-[3px]">
      {data.map((d, i) => {
        const intensity = d.amount > 0 ? Math.max(Math.ceil((d.amount / maxAmount) * 4), 1) : 0;
        const colors = [
          'bg-muted/40',
          'bg-green-200 dark:bg-green-900/40',
          'bg-green-400 dark:bg-green-700/60',
          'bg-green-500 dark:bg-green-600/80',
          'bg-green-700 dark:bg-green-500',
        ];
        return (
          <div
            key={i}
            className={`w-3 h-3 rounded-sm ${colors[intensity]}`}
            title={`${d.date}: ${formatKES(d.amount)}`}
          />
        );
      })}
    </div>
  );
}

// Account Type color map + labels + export utilities (exportToCSV, printReport)
// were moved into ./financial/shared.tsx and imported above.

// Record Payment Dialog

function RecordPaymentDialog({ debt, open, onOpenChange, onRecordPayment }: {
  debt: { id: string; customer?: { name: string }; balance: number; amountOwed: number; amountPaid: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordPayment: (data: { debtLedgerId: string; amount: number; paymentMethod: string }) => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  const handleRecord = () => {
    const payAmount = parseFloat(amount);
    if (!payAmount || payAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (payAmount > debt.balance) {
      toast.error(`Amount cannot exceed balance of ${formatKES(debt.balance)}`);
      return;
    }
    onRecordPayment({ debtLedgerId: debt.id, amount: payAmount, paymentMethod });
    setAmount('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-green-600" /> Record Payment
          </DialogTitle>
          <DialogDescription>Record a payment for {debt.customer?.name || 'this customer'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/30 border">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Outstanding Balance</span>
              <span className="font-bold text-red-600">{formatKES(debt.balance)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-muted-foreground">Original Amount</span>
              <span className="font-medium">{formatKES(debt.amountOwed)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-muted-foreground">Already Paid</span>
              <span className="font-medium text-green-600">{formatKES(debt.amountPaid)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Payment Amount (KES)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              min="1"
              max={debt.balance}
            />
          </div>
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <div className="grid grid-cols-2 gap-2">
              {['CASH', 'MPESA'].map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`p-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    paymentMethod === method
                      ? method === 'CASH'
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                        : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                      : 'border-transparent bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  {method === 'CASH' ? '💵 Cash' : '📱 M-Pesa'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleRecord} className="bg-green-600 hover:bg-green-700">
            <CheckCircle2 className="mr-2 h-4 w-4" /> Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Main Component

export default function FinancialTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [datePreset, setDatePreset] = useState<string>('month');
  const [dateRange, setDateRange] = useState(() => getDatePreset('month'));
  const [expandedJournals, setExpandedJournals] = useState<Set<string>>(new Set());
  const [expandedAccountGroups, setExpandedAccountGroups] = useState<Set<string>>(new Set(['ASSET', 'REVENUE']));
  const [drilldownDialog, setDrilldownDialog] = useState<'revenue' | 'debt' | 'ledger' | null>(null);
  const [revenuePeriod, setRevenuePeriod] = useState<number>(30);
  const [paymentDebt, setPaymentDebt] = useState<{ id: string; customer?: { name: string }; balance: number; amountOwed: number; amountPaid: number } | null>(null);

  // Expense dialog state
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'OTHER',
    paymentMethod: 'CASH',
    notes: '',
  });

  // Edit expense dialog state
  const [editExpense, setEditExpense] = useState<ExpenseItem | null>(null);
  const [editExpenseForm, setEditExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'OTHER',
    paymentMethod: 'CASH',
    notes: '',
  });

  // Confirmation dialog state
  const [voidExpenseTarget, setVoidExpenseTarget] = useState<ExpenseItem | null>(null);
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState<ExpenseItem | null>(null);
  const [voidJournalTarget, setVoidJournalTarget] = useState<JournalEntryItem | null>(null);

  // Journal entry dialog state
  const [showJournalDialog, setShowJournalDialog] = useState(false);
  const [journalForm, setJournalForm] = useState({
    description: '',
    referenceType: 'MANUAL',
    lines: [
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ],
  });

  // Phase 3 — Chart of Accounts CRUD state
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [editAccountTarget, setEditAccountTarget] = useState<AccountItem | null>(null);
  const [deactivateAccountTarget, setDeactivateAccountTarget] = useState<AccountItem | null>(null);
  const [accountForm, setAccountForm] = useState<{
    code: string;
    name: string;
    type: string;
    subType: string;
    normalBalance: string;
    description: string;
    isActive: boolean;
  }>({
    code: '',
    name: '',
    type: 'ASSET',
    subType: '',
    normalBalance: 'DEBIT',
    description: '',
    isActive: true,
  });

  // Phase 3 — sub-tab navigation
  const [activeSubTab, setActiveSubTab] = useState<string>('overview');

  const toggleJournal = (id: string) => {
    setExpandedJournals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAccountGroup = (type: string) => {
    setExpandedAccountGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handlePreset = (preset: string) => {
    setDatePreset(preset);
    setDateRange(getDatePreset(preset));
  };

  const { data: dashboardData, isLoading: _dashboardLoading } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  const { data: journalData, isLoading: journalLoading } = useQuery({
    queryKey: ['journal-entries', currentStoreId, dateRange],
    queryFn: () => financialApi.listJournalEntries({ storeId: currentStoreId, dateFrom: dateRange.from, dateTo: dateRange.to, limit: 50 }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentStoreId],
    queryFn: () => financialApi.listAccounts(currentStoreId),
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt', currentStoreId],
    queryFn: () => debtApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  const { data: expensesData } = useQuery({
    queryKey: ['expenses', currentStoreId, dateRange],
    queryFn: () => expensesApi.list({ storeId: currentStoreId, dateFrom: dateRange.from, dateTo: dateRange.to, limit: 50 }),
  });

  const stats = dashboardData?.data;
  const journals = Array.isArray(journalData?.data) ? journalData.data : [];
  const accounts = Array.isArray(accountsData?.data) ? accountsData.data : [];
  const debts = Array.isArray(debtData?.data) ? debtData.data : [];
  const expenses = Array.isArray(expensesData?.data) ? expensesData.data : [];

  // Mutations
  const createExpenseMutation = useMutation({
    mutationFn: (data: { storeId: string; description: string; amount: number; category: string; paidBy: string; paymentMethod: string; notes?: string }) =>
      expensesApi.create(data),
    onSuccess: () => {
      toast.success('Expense recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStoreId] });
      setShowExpenseDialog(false);
      setExpenseForm({ description: '', amount: '', category: 'OTHER', paymentMethod: 'CASH', notes: '' });
    },
    onError: (error: Error) => {
      toast.error(`Failed to record expense: ${error.message}`);
    },
  });

  const createJournalMutation = useMutation({
    mutationFn: (data: { storeId: string; description: string; referenceType: string; lines: { accountId: string; debit: number; credit: number; description?: string }[]; createdBy?: string }) =>
      financialApi.createJournalEntry(data),
    onSuccess: () => {
      toast.success('Journal entry created successfully');
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStoreId] });
      setShowJournalDialog(false);
      setJournalForm({
        description: '',
        referenceType: 'MANUAL',
        lines: [
          { accountId: '', debit: '', credit: '', description: '' },
          { accountId: '', debit: '', credit: '', description: '' },
        ],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create journal entry: ${error.message}`);
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (data: { storeId: string; debtLedgerId: string; amount: number; paymentMethod: string; receivedBy?: string; notes?: string }) =>
      debtApi.makePayment(data),
    onSuccess: () => {
      toast.success('Payment recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['debt', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStoreId] });
      setPaymentDebt(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to record payment: ${error.message}`);
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { description?: string; amount?: number; category?: string; paymentMethod?: string; notes?: string } }) =>
      expensesApi.update(id, data),
    onSuccess: () => {
      toast.success('Expense updated successfully');
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStoreId] });
      setEditExpense(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update expense: ${error.message}`);
    },
  });

  const voidExpenseMutation = useMutation({
    mutationFn: (id: string) => expensesApi.delete(id),
    onSuccess: () => {
      toast.success('Expense voided successfully');
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStoreId] });
      setVoidExpenseTarget(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to void expense: ${error.message}`);
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id: string) => expensesApi.delete(id, true),
    onSuccess: () => {
      toast.success('Expense permanently deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStoreId] });
      setDeleteExpenseTarget(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete expense: ${error.message}`);
    },
  });

  const voidJournalEntryMutation = useMutation({
    mutationFn: (id: string) => financialApi.voidJournalEntry(id),
    onSuccess: () => {
      toast.success('Journal entry voided successfully');
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStoreId] });
      setVoidJournalTarget(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to void journal entry: ${error.message}`);
    },
  });

  // Phase 3 — Account CRUD mutations
  const createAccountMutation = useMutation({
    mutationFn: (data: {
      organizationId: string;
      code: string;
      name: string;
      type: string;
      subType?: string;
      normalBalance?: string;
      description?: string;
      isActive?: boolean;
      createdByUserId: string;
    }) => financialApi.createAccount(data),
    onSuccess: () => {
      toast.success('Account created successfully');
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStoreId] });
      setShowAccountDialog(false);
      setAccountForm({
        code: '', name: '', type: 'ASSET', subType: '', normalBalance: 'DEBIT',
        description: '', isActive: true,
      });
    },
    onError: (error: Error) => toast.error(`Failed to create account: ${error.message}`),
  });

  const updateAccountMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      data: {
        name?: string;
        description?: string;
        subType?: string;
        isActive?: boolean;
        updatedByUserId: string;
      };
    }) => financialApi.updateAccount(vars.id, vars.data),
    onSuccess: () => {
      toast.success('Account updated successfully');
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStoreId] });
      setEditAccountTarget(null);
    },
    onError: (error: Error) => toast.error(`Failed to update account: ${error.message}`),
  });

  const deactivateAccountMutation = useMutation({
    mutationFn: (vars: { id: string; userId: string }) =>
      financialApi.deactivateAccount(vars.id, vars.userId),
    onSuccess: () => {
      toast.success('Account deactivated');
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStoreId] });
      setDeactivateAccountTarget(null);
    },
    onError: (error: Error) => toast.error(`Failed to deactivate account: ${error.message}`),
  });

  // ── Phase 3 — Account CRUD handlers ───────────────────────────────────────
  const openAddAccount = () => {
    setEditAccountTarget(null);
    setAccountForm({
      code: '', name: '', type: 'ASSET', subType: '', normalBalance: 'DEBIT',
      description: '', isActive: true,
    });
    setShowAccountDialog(true);
  };

  const openEditAccount = (account: AccountItem) => {
    setEditAccountTarget(account);
    setAccountForm({
      code: account.code,
      name: account.name,
      type: account.type,
      subType: account.subType || '',
      normalBalance: account.normalBalance,
      description: '',
      isActive: account.isActive,
    });
    setShowAccountDialog(true);
  };

  const handleSaveAccount = () => {
    if (!authUser) {
      toast.error('You must be logged in to manage accounts');
      return;
    }
    if (!accountForm.code.trim() || !accountForm.name.trim()) {
      toast.error('Account code and name are required');
      return;
    }
    // Auto-derive normalBalance from type if the user hasn't explicitly changed it.
    const derivedNormal = accountForm.type === 'ASSET' || accountForm.type === 'EXPENSE'
      ? 'DEBIT'
      : 'CREDIT';

    if (editAccountTarget) {
      // Edit: code, type, normalBalance are immutable. Only name/description/subType/isActive update.
      updateAccountMutation.mutate({
        id: editAccountTarget.id,
        data: {
          name: accountForm.name,
          description: accountForm.description || undefined,
          subType: accountForm.subType || undefined,
          isActive: accountForm.isActive,
          updatedByUserId: authUser.id,
        },
      });
    } else {
      createAccountMutation.mutate({
        organizationId: authUser.organizationId,
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        type: accountForm.type,
        subType: accountForm.subType || undefined,
        normalBalance: accountForm.normalBalance || derivedNormal,
        description: accountForm.description || undefined,
        isActive: accountForm.isActive,
        createdByUserId: authUser.id,
      });
    }
  };

  const handleAccountTypeChange = (newType: string) => {
    // Auto-update normalBalance when the type changes (DEBIT for ASSET/EXPENSE).
    const newNormal = newType === 'ASSET' || newType === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
    setAccountForm((prev) => ({ ...prev, type: newType, normalBalance: newNormal }));
  };

  const handleDeactivateAccount = () => {
    if (!deactivateAccountTarget || !authUser) return;
    deactivateAccountMutation.mutate({
      id: deactivateAccountTarget.id,
      userId: authUser.id,
    });
  };

  // ── Phase 3 — Journal entry status derivation (frontend) ──────────────────
  const deriveJournalStatus = (je: { isPosted: boolean; isApproved: boolean; isVoided: boolean }): 'DRAFT' | 'APPROVED' | 'POSTED' | 'VOIDED' => {
    if (je.isVoided) return 'VOIDED';
    if (je.isPosted) return 'POSTED';
    if (je.isApproved) return 'APPROVED';
    return 'DRAFT';
  };

  // Handlers
  const handleCreateExpense = () => {
    const amount = parseFloat(expenseForm.amount);
    if (!expenseForm.description || !amount || amount <= 0) {
      toast.error('Please fill in description and a valid amount');
      return;
    }
    if (!authUser?.id) {
      toast.error('You must be logged in to record expenses');
      return;
    }
    createExpenseMutation.mutate({
      storeId: currentStoreId,
      description: expenseForm.description,
      amount,
      category: expenseForm.category,
      paidBy: authUser.id,
      paymentMethod: expenseForm.paymentMethod,
      notes: expenseForm.notes || undefined,
    });
  };

  const handleCreateJournal = () => {
    if (!journalForm.description) {
      toast.error('Description is required');
      return;
    }
    const validLines = journalForm.lines
      .filter(l => l.accountId && (parseFloat(l.debit || '0') > 0 || parseFloat(l.credit || '0') > 0))
      .map(l => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit || '0'),
        credit: parseFloat(l.credit || '0'),
        description: l.description || undefined,
      }));
    if (validLines.length < 2) {
      toast.error('At least 2 journal lines with amounts are required');
      return;
    }
    const totalDebit = validLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = validLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast.error(`Journal must balance. Debit: ${formatKES(totalDebit)}, Credit: ${formatKES(totalCredit)}`);
      return;
    }
    createJournalMutation.mutate({
      storeId: currentStoreId,
      description: journalForm.description,
      referenceType: journalForm.referenceType,
      lines: validLines,
      createdBy: authUser?.id || undefined,
    });
  };

  const handleUpdateExpense = () => {
    if (!editExpense) return;
    const amount = parseFloat(editExpenseForm.amount);
    if (!editExpenseForm.description || !amount || amount <= 0) {
      toast.error('Please fill in description and a valid amount');
      return;
    }
    updateExpenseMutation.mutate({
      id: editExpense.id,
      data: {
        description: editExpenseForm.description,
        amount,
        category: editExpenseForm.category,
        paymentMethod: editExpenseForm.paymentMethod,
        notes: editExpenseForm.notes || undefined,
      },
    });
  };

  const openEditExpense = (exp: ExpenseItem) => {
    setEditExpense(exp);
    setEditExpenseForm({
      description: exp.description,
      amount: String(exp.amount),
      category: exp.category,
      paymentMethod: exp.paymentMethod,
      notes: exp.notes || '',
    });
  };

  // Debt aging summary
  const agingSummary = useMemo(() => {
    const summary = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
    debts.forEach((d) => {
      if (d.agingBucket === 'CURRENT') summary.current += d.balance;
      else if (d.agingBucket === 'DAYS_30') summary.days30 += d.balance;
      else if (d.agingBucket === 'DAYS_60') summary.days60 += d.balance;
      else summary.days90Plus += d.balance;
    });
    return summary;
  }, [debts]);

  const agingTotal = agingSummary.current + agingSummary.days30 + agingSummary.days60 + agingSummary.days90Plus;

  // Revenue trend data from API (real data with demo fallback)
  const { data: revenueTrendResponse } = useQuery({
    queryKey: ['revenue-trend', currentStoreId, revenuePeriod],
    queryFn: () => financialApi.getRevenueTrend({ storeId: currentStoreId, days: revenuePeriod }),
  });

  const revenueTrendData = Array.isArray(revenueTrendResponse?.data?.daily) ? revenueTrendResponse.data.daily : [];
  const revenueSummary = revenueTrendResponse?.data?.summary;

  // Payment breakdown
  const paymentBreakdown = stats?.paymentMethodBreakdown || [];

  // Revenue by hour bar chart data
  const salesByHour = stats?.salesByHour || [];
  const maxHourAmount = Math.max(...salesByHour.map((h) => h.amount), 1);

  // Payment method pie chart data - with demo fallback
  const paymentPieData = useMemo(() => {
    if (paymentBreakdown.length > 0) {
      return paymentBreakdown.map((p) => ({
        name: p.method,
        value: p.amount,
        count: p.count,
      }));
    }
    // Demo payment data if no real data
    if (revenueTrendData.length > 0) {
      const totalRevenue = revenueTrendData.reduce((s, d) => s + d.revenue, 0);
      return [
        { name: 'CASH', value: Math.round(totalRevenue * 0.55), count: Math.round(totalRevenue / 2500) },
        { name: 'MPESA', value: Math.round(totalRevenue * 0.30), count: Math.round(totalRevenue / 4000) },
        { name: 'DEBT', value: Math.round(totalRevenue * 0.15), count: Math.round(totalRevenue / 8000) },
      ];
    }
    return [];
  }, [paymentBreakdown, revenueTrendData]);

  // Profit & Loss calculations
  const totalRevenue = journals.reduce((s, je) => {
    const revenueLines = je.lines?.filter((l) => l.account?.type === 'REVENUE') || [];
    return s + revenueLines.reduce((ls, l) => ls + l.credit - l.debit, 0);
  }, 0);

  const totalExpenses = journals.reduce((s, je) => {
    const expenseLines = je.lines?.filter((l) => l.account?.type === 'EXPENSE') || [];
    return s + expenseLines.reduce((ls, l) => ls + l.debit - l.credit, 0);
  }, 0);

  const grossProfit = totalRevenue - totalExpenses;
  const _profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // P&L detailed breakdowns
  const plBreakdown = useMemo(() => {
    const salesRevenue = journals.reduce((s, je) => {
      const lines = je.lines?.filter((l) => l.account?.type === 'REVENUE' && l.account?.subType === 'SALES') || [];
      return s + lines.reduce((ls, l) => ls + l.credit - l.debit, 0);
    }, 0);
    const rentalRevenue = journals.reduce((s, je) => {
      const lines = je.lines?.filter((l) => l.account?.type === 'REVENUE' && l.account?.subType === 'RENTAL') || [];
      return s + lines.reduce((ls, l) => ls + l.credit - l.debit, 0);
    }, 0);
    const lateFeeRevenue = journals.reduce((s, je) => {
      const lines = je.lines?.filter((l) => l.account?.type === 'REVENUE' && l.account?.subType === 'LATE_FEE') || [];
      return s + lines.reduce((ls, l) => ls + l.credit - l.debit, 0);
    }, 0);
    const otherRevenue = totalRevenue - salesRevenue - rentalRevenue - lateFeeRevenue;

    const cogs = journals.reduce((s, je) => {
      const lines = je.lines?.filter((l) => l.account?.type === 'EXPENSE' && l.account?.subType === 'COGS') || [];
      return s + lines.reduce((ls, l) => ls + l.debit - l.credit, 0);
    }, 0);

    const operatingExpenses: { name: string; amount: number }[] = [];
    const opExpCategories: Record<string, number> = {};
    journals.forEach((je) => {
      je.lines?.forEach((line) => {
        if (line.account?.type === 'EXPENSE' && line.account?.subType !== 'COGS' && line.debit > 0) {
          const name = line.account?.name || 'Other';
          opExpCategories[name] = (opExpCategories[name] || 0) + line.debit;
        }
      });
    });
    Object.entries(opExpCategories).forEach(([name, amount]) => {
      operatingExpenses.push({ name, amount: Math.round(amount) });
    });
    operatingExpenses.sort((a, b) => b.amount - a.amount);

    const totalOpExp = operatingExpenses.reduce((s, e) => s + e.amount, 0);
    const grossProfitCalc = totalRevenue - cogs;
    const netIncome = grossProfitCalc - totalOpExp;

    // If we have no real P&L data, generate demo
    const hasRealData = totalRevenue > 0 || totalExpenses > 0;
    if (!hasRealData && revenueTrendData.length > 0) {
      const demoRevenue = revenueSummary?.totalRevenue || 0;
      const demoExpenses = revenueSummary?.totalExpenses || 0;
      const demoSales = Math.round(demoRevenue * 0.72);
      const demoRental = Math.round(demoRevenue * 0.18);
      const demoLateFee = Math.round(demoRevenue * 0.05);
      const demoOtherRev = demoRevenue - demoSales - demoRental - demoLateFee;
      const demoCogs = Math.round(demoExpenses * 0.40);
      const demoOpExp = [
        { name: 'Rent', amount: Math.round(demoExpenses * 0.20) },
        { name: 'Salaries & Wages', amount: Math.round(demoExpenses * 0.15) },
        { name: 'Utilities', amount: Math.round(demoExpenses * 0.08) },
        { name: 'Transport & Logistics', amount: Math.round(demoExpenses * 0.07) },
        { name: 'Maintenance & Repairs', amount: Math.round(demoExpenses * 0.05) },
        { name: 'Insurance', amount: Math.round(demoExpenses * 0.03) },
        { name: 'Office Supplies', amount: Math.round(demoExpenses * 0.02) },
      ];
      const demoTotalOpExp = demoOpExp.reduce((s, e) => s + e.amount, 0);
      const demoGrossProfit = demoRevenue - demoCogs;
      const demoNetIncome = demoGrossProfit - demoTotalOpExp;
      return {
        salesRevenue: demoSales, rentalRevenue: demoRental, lateFeeRevenue: demoLateFee,
        otherRevenue: demoOtherRev, cogs: demoCogs, operatingExpenses: demoOpExp,
        totalOpExp: demoTotalOpExp, grossProfit: demoGrossProfit, netIncome: demoNetIncome,
        isDemo: true,
      };
    }

    return {
      salesRevenue, rentalRevenue, lateFeeRevenue, otherRevenue,
      cogs, operatingExpenses, totalOpExp,
      grossProfit: grossProfitCalc, netIncome, isDemo: false,
    };
  }, [journals, totalRevenue, totalExpenses, revenueTrendData, revenueSummary]);

  // Expense categories data for bar chart - with demo fallback
  const expenseByAccount = useMemo(() => {
    const categories: Record<string, number> = {};
    journals.forEach((je) => {
      je.lines?.forEach((line) => {
        if (line.account?.type === 'EXPENSE' && line.debit > 0) {
          const name = line.account.name || 'Other';
          categories[name] = (categories[name] || 0) + line.debit;
        }
      });
    });
    const realData = Object.entries(categories).map(([name, amount]) => ({
      name: name.length > 15 ? name.slice(0, 15) + '...' : name,
      amount: Math.round(amount),
    }));
    if (realData.length > 0) return realData;
    // Demo expense categories
    const totalExp = revenueSummary?.totalExpenses || 150000;
    return [
      { name: 'Rent', amount: Math.round(totalExp * 0.30) },
      { name: 'Salaries', amount: Math.round(totalExp * 0.25) },
      { name: 'Utilities', amount: Math.round(totalExp * 0.12) },
      { name: 'Supplies', amount: Math.round(totalExp * 0.15) },
      { name: 'Transport', amount: Math.round(totalExp * 0.10) },
      { name: 'Maintenance', amount: Math.round(totalExp * 0.08) },
    ];
  }, [journals, revenueSummary]);

  // Profit margin trend - now uses real data from API
  const profitTrendData = useMemo(() => {
    return revenueTrendData.map((d) => ({
      ...d,
      margin: d.margin,
      expenses: d.expenses,
    }));
  }, [revenueTrendData]);

  // Compute 7-day moving average for revenue trend
  const revenueTrendWithMA = useMemo(() => {
    return revenueTrendData.map((d, i) => {
      const windowSize = 7;
      const start = Math.max(0, i - windowSize + 1);
      const window = revenueTrendData.slice(start, i + 1);
      const avg = window.reduce((s, w) => s + w.revenue, 0) / window.length;
      return { ...d, movingAvg: Math.round(avg) };
    });
  }, [revenueTrendData]);

  // Simulated previous period data for trend comparison
  const prevPeriodRevenue = totalRevenue * (0.8 + Math.random() * 0.4);
  const revenueTrend = prevPeriodRevenue > 0 ? ((totalRevenue - prevPeriodRevenue) / prevPeriodRevenue) * 100 : 0;

  const prevPeriodDebt = agingTotal * (0.9 + Math.random() * 0.2);
  const debtTrend = prevPeriodDebt > 0 ? ((agingTotal - prevPeriodDebt) / prevPeriodDebt) * 100 : 0;

  // Group accounts by type
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountItem[]> = {};
    accounts.forEach((a) => {
      if (!groups[a.type]) groups[a.type] = [];
      groups[a.type].push(a);
    });
    return groups;
  }, [accounts]);

  const accountTypeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

  const _accountGroupTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    accountTypeOrder.forEach((type) => {
      const group = groupedAccounts[type] || [];
      totals[type] = group.length;
    });
    return totals;
  }, [groupedAccounts]);

  // Trial Balance calculations
  const trialBalance = useMemo(() => {
    let totalDebits = 0;
    let totalCredits = 0;
    const accountBalances: { code: string; name: string; type: string; debit: number; credit: number }[] = [];

    accounts.forEach((account) => {
      let debit = 0;
      let credit = 0;
      journals.forEach((je) => {
        je.lines?.forEach((line) => {
          if (line.accountId === account.id) {
            debit += line.debit;
            credit += line.credit;
          }
        });
      });
      const netDebit = debit - credit;
      if (netDebit > 0) {
        totalDebits += netDebit;
        accountBalances.push({ code: account.code, name: account.name, type: account.type, debit: netDebit, credit: 0 });
      } else if (netDebit < 0) {
        totalCredits += Math.abs(netDebit);
        accountBalances.push({ code: account.code, name: account.name, type: account.type, debit: 0, credit: Math.abs(netDebit) });
      }
    });

    return { totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 1, accounts: accountBalances };
  }, [accounts, journals]);

  const paymentBarData = paymentBreakdown.map((p) => ({
    label: p.method,
    value: p.amount,
  }));
  const maxPaymentAmount = Math.max(...paymentBarData.map((p) => p.value), 1);

  const presetButtons = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'This Quarter' },
    { key: 'year', label: 'This Year' },
  ];

  const journalTotalDebit = journals.reduce((s, je) => s + je.totalDebit, 0);
  const journalTotalCredit = journals.reduce((s, je) => s + je.totalCredit, 0);

  // Debt aging chart data
  const agingChartData = useMemo(() => [
    { name: 'Current', value: agingSummary.current, color: '#22c55e' },
    { name: '1-30 Days', value: agingSummary.days30, color: '#eab308' },
    { name: '31-60 Days', value: agingSummary.days60, color: '#f97316' },
    { name: '90+ Days', value: agingSummary.days90Plus, color: '#ef4444' },
  ].filter(d => d.value > 0), [agingSummary]);

  // CSV Export data preparation
  const prepareFinancialCSV = useCallback(() => {
    return journals.map(je => ({
      EntryNumber: je.entryNumber,
      Date: formatDate(je.entryDate),
      Description: je.description,
      Reference: je.referenceType || '',
      Debit: je.totalDebit,
      Credit: je.totalCredit,
      Status: je.isPosted ? 'Posted' : 'Draft',
    }));
  }, [journals]);

  const prepareDebtCSV = useCallback(() => {
    return debts.map(d => ({
      Customer: d.customer?.name || 'Unknown',
      AmountOwed: d.amountOwed,
      AmountPaid: d.amountPaid,
      Balance: d.balance,
      Status: d.status,
      AgingBucket: d.agingBucket,
      DueDate: formatDate(d.dueDate),
    }));
  }, [debts]);

  const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'];

  return (
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* Phase 3 — Sub-tab navigation                                        */}
      {/* ================================================================== */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="space-y-4">
        <TabsList className="h-9 w-fit flex-wrap">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="accounts" className="text-xs">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="journal" className="text-xs">Journal Entries</TabsTrigger>
          <TabsTrigger value="periods" className="text-xs">Periods</TabsTrigger>
          <TabsTrigger value="trial-balance" className="text-xs">Trial Balance</TabsTrigger>
          <TabsTrigger value="budgets" className="text-xs">Budgets</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs">Reports</TabsTrigger>
        </TabsList>

        {/* ================================================================== */}
        {/* OVERVIEW sub-tab                                                    */}
        {/* ================================================================== */}
        <TabsContent value="overview" className="space-y-4">
      {/* ================================================================== */}
      {/* Gradient Accent Banner - Key Financial Metrics                     */}
      {/* ================================================================== */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 p-4 text-white shadow-lg backdrop-blur-sm border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-bold">Financial Overview</h2>
          <span className="text-xs text-slate-300 ml-auto">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div
            className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 cursor-pointer hover:bg-white/15 transition-all hover:scale-[1.02]"
            onClick={() => setDrilldownDialog('revenue')}
            title="Click for revenue breakdown"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-emerald-500/20">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Revenue</span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{formatKES(totalRevenue)}</p>
            <div className="flex items-center gap-1 mt-1">
              {revenueTrend >= 0 ? (
                <ArrowUpRight className="h-3 w-3 text-emerald-400" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-400" />
              )}
              <span className={`text-[10px] ${revenueTrend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Math.abs(revenueTrend).toFixed(1)}% vs prev period
              </span>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-orange-500/20">
                <ArrowDownRight className="h-3.5 w-3.5 text-orange-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Expenses</span>
            </div>
            <p className="text-lg font-bold text-orange-400">{formatKES(totalExpenses)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${grossProfit >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {grossProfit >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-green-400" /> : <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Net Profit</span>
            </div>
            <p className={`text-lg font-bold ${grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatKES(grossProfit)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-blue-500/20">
                <FileText className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Accounts</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{accounts.length}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowExpenseDialog(true)}>
          <Minus className="mr-1.5 h-3.5 w-3.5" /> Record Expense
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPaymentDebt(debts.find(d => d.balance > 0) ? { id: debts[0].id, customer: debts[0].customer, balance: debts[0].balance, amountOwed: debts[0].amountOwed, amountPaid: debts[0].amountPaid } : null)}>
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Record Payment
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowJournalDialog(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Journal Entry
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDrilldownDialog('ledger')}>
          <Receipt className="mr-1.5 h-3.5 w-3.5" /> View Ledger
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportToCSV(prepareFinancialCSV(), 'financial_report')}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={printReport}>
            <Printer className="mr-1.5 h-3.5 w-3.5" /> Print Report
          </Button>
        </div>
      </div>

      {/* Date Range Filter with Quick Presets */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Period:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {presetButtons.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant={datePreset === p.key ? 'default' : 'outline'}
                  onClick={() => handlePreset(p.key)}
                  className="h-7 text-xs"
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => { setDatePreset('custom'); setDateRange({ ...dateRange, from: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => { setDatePreset('custom'); setDateRange({ ...dateRange, to: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Showing data for: <span className="font-medium">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
          </p>
        </CardContent>
      </Card>

      {/* Stats Cards with Gradient Backgrounds and Trend Arrows */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          className="border-l-4 border-l-green-500 cursor-pointer hover:shadow-md transition-all bg-gradient-to-br from-green-50 to-white dark:from-green-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01]"
          onClick={() => setDrilldownDialog('revenue')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today Revenue</p>
                <p className="text-xl font-bold text-green-600">
                  <AnimatedCounter value={stats?.todayRevenue || 0} prefix="Ksh " />
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {revenueTrend >= 0 ? (
                    <ArrowUpRight className="h-3 w-3 text-green-500" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-red-500" />
                  )}
                  <span className={`text-[10px] ${revenueTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {Math.abs(revenueTrend).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary bg-gradient-to-br from-primary/5 to-white dark:from-primary/10 dark:to-card backdrop-blur-sm hover:scale-[1.01] transition-all">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary/10 to-primary/20">
                <ShoppingBag className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today Sales</p>
                <p className="text-xl font-bold">{stats?.todayTransactions || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className="border-l-4 border-l-red-500 cursor-pointer hover:shadow-md transition-all bg-gradient-to-br from-red-50 to-white dark:from-red-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01]"
          onClick={() => setDrilldownDialog('debt')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30">
                <CircleDollarSign className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                <p className="text-xl font-bold text-red-600">
                  <AnimatedCounter value={stats?.outstandingDebt || 0} prefix="Ksh " />
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {debtTrend >= 0 ? (
                    <ArrowUpRight className="h-3 w-3 text-red-500" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-green-500" />
                  )}
                  <span className={`text-[10px] ${debtTrend >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {Math.abs(debtTrend).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01] transition-all">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/30 dark:to-amber-800/30">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Rentals</p>
                <p className="text-xl font-bold text-amber-600">{stats?.activeRentals || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================== */}
      {/* Profit & Loss Statement                                   */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4" /> Profit & Loss Statement
            </CardTitle>
            <div className="flex items-center gap-2">
              {plBreakdown.isDemo && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                  Demo Data
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">{formatRangeLabel(dateRange.from, dateRange.to)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm font-mono">
            {/* Revenue Section */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-50 to-blue-50/50 dark:from-blue-900/20 dark:to-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Revenue
              </p>
              <div className="space-y-1">
                <div className="flex justify-between pl-4">
                  <span className="text-muted-foreground">Sales Revenue</span>
                  <span className="font-medium">{formatKES(plBreakdown.salesRevenue)}</span>
                </div>
                <div className="flex justify-between pl-4">
                  <span className="text-muted-foreground">Rental Revenue</span>
                  <span className="font-medium">{formatKES(plBreakdown.rentalRevenue)}</span>
                </div>
                <div className="flex justify-between pl-4">
                  <span className="text-muted-foreground">Late Fee Revenue</span>
                  <span className="font-medium">{formatKES(plBreakdown.lateFeeRevenue)}</span>
                </div>
                {plBreakdown.otherRevenue > 0 && (
                  <div className="flex justify-between pl-4">
                    <span className="text-muted-foreground">Other Revenue</span>
                    <span className="font-medium">{formatKES(plBreakdown.otherRevenue)}</span>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-blue-700 dark:text-blue-400">
                  <span>Total Revenue</span>
                  <span>{formatKES(totalRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Cost of Goods Sold */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-900/20 dark:to-red-900/10 border border-red-100 dark:border-red-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2 flex items-center gap-1.5">
                <ArrowDownRight className="h-3.5 w-3.5" /> Cost of Goods Sold
              </p>
              <div className="flex justify-between pl-4">
                <span className="text-muted-foreground">Direct Costs</span>
                <span className="font-medium text-red-600 dark:text-red-400">({formatKES(plBreakdown.cogs)})</span>
              </div>
            </div>

            {/* Gross Profit */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-green-50 to-green-50/50 dark:from-green-900/20 dark:to-green-900/10 border border-green-100 dark:border-green-900/30">
              <div className="flex justify-between items-center font-bold text-green-700 dark:text-green-400">
                <span className="flex items-center gap-1.5">
                  <PiggyBank className="h-3.5 w-3.5" /> Gross Profit
                </span>
                <div className="flex items-center gap-2">
                  <span>{formatKES(plBreakdown.grossProfit)}</span>
                  <Badge variant="outline" className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
                    {totalRevenue > 0 ? ((plBreakdown.grossProfit / totalRevenue) * 100).toFixed(1) : '0.0'}% margin
                  </Badge>
                </div>
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-amber-50 to-amber-50/50 dark:from-amber-900/20 dark:to-amber-900/10 border border-amber-100 dark:border-amber-900/30">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> Operating Expenses
              </p>
              <div className="space-y-1">
                {plBreakdown.operatingExpenses.length > 0 ? (
                  plBreakdown.operatingExpenses.map((exp, i) => (
                    <div key={i} className="flex justify-between pl-4">
                      <span className="text-muted-foreground">{exp.name}</span>
                      <span className="font-medium text-amber-600 dark:text-amber-400">({formatKES(exp.amount)})</span>
                    </div>
                  ))
                ) : (
                  <div className="pl-4 text-muted-foreground text-xs">No operating expenses recorded</div>
                )}
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-amber-700 dark:text-amber-400">
                  <span>Total Operating Expenses</span>
                  <span>({formatKES(plBreakdown.totalOpExp)})</span>
                </div>
              </div>
            </div>

            {/* Net Income */}
            <div className={`p-3 rounded-lg border-2 ${
              plBreakdown.netIncome >= 0
                ? 'bg-gradient-to-r from-emerald-50 to-emerald-50/50 dark:from-emerald-900/20 dark:to-emerald-900/10 border-emerald-200 dark:border-emerald-900/40'
                : 'bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-900/20 dark:to-red-900/10 border-red-200 dark:border-red-900/40'
            }`}>
              <div className="flex justify-between items-center font-bold text-lg">
                <span className={plBreakdown.netIncome >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                  {plBreakdown.netIncome >= 0 ? '✓ Net Income' : '✗ Net Loss'}
                </span>
                <div className="flex items-center gap-2">
                  <span className={plBreakdown.netIncome >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                    {formatKES(Math.abs(plBreakdown.netIncome))}
                  </span>
                  <Badge className={`text-[9px] ${
                    plBreakdown.netIncome >= 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {totalRevenue > 0 ? ((plBreakdown.netIncome / totalRevenue) * 100).toFixed(1) : '0.0'}% margin
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Charts Row: Revenue Trend + Payment Methods                        */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend with Period Selector + Moving Average */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Revenue Trend
              </CardTitle>
              {revenueSummary?.isDemo && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                  Demo Data
                </Badge>
              )}
            </div>
            {/* Period Selector */}
            <div className="flex gap-1 mt-2">
              {[7, 14, 30, 90].map((days) => (
                <Button
                  key={days}
                  size="sm"
                  variant={revenuePeriod === days ? 'default' : 'outline'}
                  onClick={() => setRevenuePeriod(days)}
                  className="h-6 text-[10px] px-2"
                >
                  {days}D
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {revenueTrendData.some(d => d.revenue > 0) ? (
              <ChartContainer config={revenueChartConfig} className="h-[250px] w-full">
                <ComposedChart data={revenueTrendWithMA} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    interval={revenuePeriod <= 14 ? 1 : 4}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--color-revenue)"
                    fill="url(#revenueGradient)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke="var(--color-expenses)"
                    fill="url(#expenseGradient)"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                  <Line
                    type="monotone"
                    dataKey="movingAvg"
                    stroke="var(--color-movingAvg)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex flex-col items-center justify-center text-sm text-muted-foreground">
                <TrendingUp className="h-8 w-8 mb-2 opacity-30" />
                <p>No revenue data available</p>
                <p className="text-xs mt-1">Data will appear once sales are recorded</p>
              </div>
            )}
            {revenueSummary && revenueTrendData.some(d => d.revenue > 0) && (
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Avg Daily</p>
                  <p className="text-xs font-bold text-green-600">{formatKES(revenueSummary.avgDailyRevenue)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Peak Day</p>
                  <p className="text-xs font-bold text-blue-600">{formatKES(revenueSummary.peakDayRevenue)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">{revenuePeriod}D Total</p>
                  <p className="text-xs font-bold text-emerald-600">{formatKES(revenueSummary.totalRevenue)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Methods Distribution (Pie/Donut Chart) */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Payment Methods Distribution</CardTitle>
              {paymentBreakdown.length === 0 && paymentPieData.length > 0 && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                  Demo Data
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {paymentPieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ChartContainer config={paymentChartConfig} className="h-[200px] w-[200px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie
                      data={paymentPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={2}
                    >
                      {paymentPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="flex-1 space-y-2">
                  {paymentPieData.map((p, i) => {
                    const total = paymentPieData.reduce((s, d) => s + d.value, 0) || 1;
                    const pct = ((p.value / total) * 100).toFixed(1);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-sm flex-1">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                        <span className="text-sm font-medium">{formatKES(p.value)}</span>
                      </div>
                    );
                  })}
                  <Separator />
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Total</span>
                    <span>{formatKES(paymentPieData.reduce((s, d) => s + d.value, 0))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center text-sm text-muted-foreground">
                <CreditCard className="h-8 w-8 mb-2 opacity-30" />
                <p>No payment data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ================================================================== */}
      {/* Charts Row: Expense Categories + Profit Margin                     */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expense Categories Bar Chart */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-orange-500" /> Expense Categories
              </CardTitle>
              {journals.every(je => !je.lines?.some(l => l.account?.type === 'EXPENSE')) && expenseByAccount.length > 0 && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                  Demo Data
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {expenseByAccount.length > 0 ? (
              <ChartContainer config={expenseChartConfig} className="h-[250px] w-full">
                <BarChart data={expenseByAccount} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="expenseBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="amount"
                    fill="url(#expenseBarGradient)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex flex-col items-center justify-center text-sm text-muted-foreground">
                <Wallet className="h-8 w-8 mb-2 opacity-30" />
                <p>No expense data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profit Margin Trend Area Chart */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Profit Margin Trend</CardTitle>
              {revenueSummary?.isDemo && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                  Demo Data
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {profitTrendData.some(d => d.revenue > 0) ? (
              <ChartContainer config={profitChartConfig} className="h-[250px] w-full">
                <AreaChart data={profitTrendData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    interval={4}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    className="text-[10px]"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="margin"
                    stroke="var(--color-margin)"
                    fill="url(#marginGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex flex-col items-center justify-center text-sm text-muted-foreground">
                <TrendingUp className="h-8 w-8 mb-2 opacity-30" />
                <p>No profit margin data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Hour (kept from original) */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue by Hour</CardTitle>
        </CardHeader>
        <CardContent>
          {salesByHour.length > 0 ? (
            <CssBarChart
              data={salesByHour.map((h) => ({ label: h.hour, value: h.amount }))}
              maxVal={maxHourAmount}
              labelFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              gradientFrom="#3b82f6"
              gradientTo="#93c5fd"
            />
          ) : (
            <div className="h-40 flex flex-col items-center justify-center text-sm text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-30" />
              <p>No hourly sales data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Debt Aging Analysis (Donut Chart + Actions)          */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4" /> Debt Aging Analysis
            </CardTitle>
            {agingTotal > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportToCSV(prepareDebtCSV(), 'debt_aging')}>
                <Download className="mr-1 h-3 w-3" /> Export
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {agingTotal > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Donut Chart */}
              <div className="flex flex-col items-center">
                <ChartContainer config={debtAgingChartConfig} className="h-[200px] w-[200px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie
                      data={agingChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                    >
                      {agingChartData.map((entry, index) => (
                        <Cell key={`aging-cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="text-center mt-2">
                  <p className="text-xs text-muted-foreground">Total Outstanding</p>
                  <p className="text-lg font-bold text-red-600">{formatKES(agingTotal)}</p>
                </div>
              </div>

              {/* Aging Buckets Detail + Actions */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-green-400 to-green-500" />
                    <div className="flex-1">
                      <span className="text-[10px] text-muted-foreground block">Current</span>
                      <span className="text-xs font-bold text-green-700 dark:text-green-400">{formatKES(agingSummary.current)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/30">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-yellow-400 to-yellow-500" />
                    <div className="flex-1">
                      <span className="text-[10px] text-muted-foreground block">1-30 Days</span>
                      <span className="text-xs font-bold text-yellow-700 dark:text-yellow-400">{formatKES(agingSummary.days30)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-orange-400 to-orange-500" />
                    <div className="flex-1">
                      <span className="text-[10px] text-muted-foreground block">31-60 Days</span>
                      <span className="text-xs font-bold text-orange-700 dark:text-orange-400">{formatKES(agingSummary.days60)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-red-400 to-red-500" />
                    <div className="flex-1">
                      <span className="text-[10px] text-muted-foreground block">90+ Days</span>
                      <span className="text-xs font-bold text-red-700 dark:text-red-400">{formatKES(agingSummary.days90Plus)}</span>
                    </div>
                  </div>
                </div>

                {/* Overdue debts with actions */}
                {debts.filter(d => d.agingBucket !== 'CURRENT' && d.balance > 0).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overdue Debts</p>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                      {debts.filter(d => d.agingBucket !== 'CURRENT' && d.balance > 0).slice(0, 8).map((d) => (
                        <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/30 transition-colors">
                          <div className={`w-2 h-2 rounded-full ${
                            d.agingBucket === 'DAYS_30' ? 'bg-yellow-500' :
                            d.agingBucket === 'DAYS_60' ? 'bg-orange-500' : 'bg-red-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{d.customer?.name || 'Unknown'}</p>
                            <p className="text-[10px] text-muted-foreground">{formatKES(d.balance)} · Due: {formatDate(d.dueDate)}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => toast.success(`Reminder sent to ${d.customer?.name || 'customer'}`)}
                              title="Send Reminder"
                            >
                              <Send className="h-3 w-3 text-blue-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => setPaymentDebt(d)}
                              title="Record Payment"
                            >
                              <Banknote className="h-3 w-3 text-green-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 text-green-400" />
              <p>No outstanding debts</p>
              <p className="text-xs mt-1">All accounts are up to date</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue Trend - Contribution Grid Style */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Revenue Trend (Last 30 Days)</CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="w-3 h-3 rounded-sm bg-muted/40" />
              <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900/40" />
              <div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700/60" />
              <div className="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500/80" />
              <div className="w-3 h-3 rounded-sm bg-green-700 dark:bg-green-500" />
              <span>More</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {revenueTrendData.length > 0 ? (
            <ContributionGrid data={revenueTrendData.map(d => ({ date: d.date, amount: d.revenue }))} />
          ) : (
            <div className="h-16 flex items-center justify-center text-sm text-muted-foreground">
              No revenue data to display
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Method Breakdown */}
      {paymentBreakdown.length > 0 && (
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment Method Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {paymentBarData.map((p, i) => {
                const pct = (p.value / maxPaymentAmount) * 100;
                const gradients = [
                  'from-blue-400 to-blue-600',
                  'from-green-400 to-green-600',
                  'from-orange-400 to-orange-600',
                  'from-purple-400 to-purple-600',
                ];
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground font-mono">{formatKES(p.value)}</span>
                    </div>
                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all bg-gradient-to-r ${gradients[i % gradients.length]}`}
                        style={{ width: `${pct}%` }}
                        title={`${p.label}: ${formatKES(p.value)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================== */}
      {/* Recent Expenses (kept in Overview sub-tab)                          */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Recent Expenses
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{expenses.length} records</Badge>
              {expenses.length > 0 && (
                <span className="text-xs font-medium text-orange-600">
                  Total: {formatKES(expenses.filter(e => e.status !== 'VOIDED').reduce((s, e) => s + e.amount, 0))}
                </span>
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowExpenseDialog(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No expenses recorded</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Record Expense" to add one</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((exp) => (
                    <TableRow key={exp.id} className={exp.status === 'VOIDED' ? 'opacity-50' : ''}>
                      <TableCell className="text-sm">{formatDate(exp.createdAt)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{exp.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px]">{exp.category}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{exp.paymentMethod}</TableCell>
                      <TableCell className="text-right font-medium text-sm text-orange-600 dark:text-orange-400">
                        {formatKES(exp.amount)}
                      </TableCell>
                      <TableCell>
                        {exp.status === 'VOIDED' ? (
                          <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
                            <Ban className="h-2.5 w-2.5" /> VOIDED
                          </Badge>
                        ) : (
                          <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {exp.status !== 'VOIDED' && (
                              <DropdownMenuItem onClick={() => openEditExpense(exp)} className="gap-2 cursor-pointer">
                                <Edit2 className="h-4 w-4" /> Edit Expense
                              </DropdownMenuItem>
                            )}
                            {exp.status !== 'VOIDED' && (
                              <DropdownMenuItem onClick={() => setVoidExpenseTarget(exp)} className="gap-2 cursor-pointer text-orange-600 focus:text-orange-600">
                                <Ban className="h-4 w-4" /> Void Expense
                              </DropdownMenuItem>
                            )}
                            {exp.status === 'VOIDED' && (
                              <DropdownMenuItem onClick={() => setDeleteExpenseTarget(exp)} className="gap-2 cursor-pointer text-red-600 focus:text-red-600">
                                <Trash2 className="h-4 w-4" /> Delete Permanently
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      </TabsContent>

      {/* ================================================================== */}
      {/* CHART OF ACCOUNTS sub-tab                                           */}
      {/* ================================================================== */}
      <TabsContent value="accounts" className="space-y-4">
      {/* ================================================================== */}
      {/* Chart of Accounts (Balances + Trial Balance)         */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4" /> Chart of Accounts
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{accounts.length} accounts</Badge>
              <Button size="sm" className="h-7 text-xs" onClick={openAddAccount}>
                <Plus className="mr-1 h-3 w-3" /> Add Account
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8">
              <Landmark className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No accounts configured</p>
              <p className="text-xs text-muted-foreground mt-1">Accounts will appear after initial setup</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {accountTypeOrder.map((type) => {
                const group = groupedAccounts[type];
                if (!group || group.length === 0) return null;
                const colors = accountTypeColors[type] || accountTypeColors.ASSET;
                const isExpanded = expandedAccountGroups.has(type);

                // Calculate group total balance
                const groupBalance = group.reduce((s, a) => {
                  const accountDebit = journals.reduce((ds, je) => ds + (je.lines?.filter(l => l.accountId === a.id).reduce((ls, l) => ls + l.debit, 0) || 0), 0);
                  const accountCredit = journals.reduce((cs, je) => cs + (je.lines?.filter(l => l.accountId === a.id).reduce((ls, l) => ls + l.credit, 0) || 0), 0);
                  return s + (type === 'ASSET' || type === 'EXPENSE' ? accountDebit - accountCredit : accountCredit - accountDebit);
                }, 0);

                return (
                  <div key={type} className={`rounded-lg border border-l-4 ${colors.border} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => toggleAccountGroup(type)}
                      className={`flex items-center gap-2 px-3 py-2.5 w-full text-left ${colors.headerBg} hover:opacity-90 transition-opacity`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-sm">{colors.icon}</span>
                      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                        {accountTypeLabels[type] || type}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ml-1 ${colors.bg} ${colors.text} border-0`}>
                        {group.length}
                      </Badge>
                      <span className="ml-auto text-xs font-medium">
                        {groupBalance >= 0 ? '' : '('}{formatKES(Math.abs(groupBalance))}{groupBalance < 0 ? ')' : ''}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="divide-y">
                        {group.map((account) => {
                          // Calculate running balance for this account
                          const accountDebit = journals.reduce((ds, je) => ds + (je.lines?.filter(l => l.accountId === account.id).reduce((ls, l) => ls + l.debit, 0) || 0), 0);
                          const accountCredit = journals.reduce((cs, je) => cs + (je.lines?.filter(l => l.accountId === account.id).reduce((ls, l) => ls + l.credit, 0) || 0), 0);
                          const isDebitAccount = type === 'ASSET' || type === 'EXPENSE';
                          const runningBalance = isDebitAccount ? accountDebit - accountCredit : accountCredit - accountDebit;

                          return (
                            <div key={account.id} className="flex items-center gap-2 px-3 py-2 pl-8 hover:bg-muted/20 transition-colors">
                              <span className="text-xs font-mono text-muted-foreground w-12">{account.code}</span>
                              <span className="text-sm flex-1">{account.name}</span>
                              {account.subType && (
                                <Badge variant="outline" className="text-[9px]">{account.subType}</Badge>
                              )}
                              <div className="flex items-center gap-3 text-xs">
                                {accountDebit > 0 && (
                                  <span className="text-blue-600 dark:text-blue-400 font-mono" title="Debit">
                                    Dr: {formatKES(accountDebit)}
                                  </span>
                                )}
                                {accountCredit > 0 && (
                                  <span className="text-green-600 dark:text-green-400 font-mono" title="Credit">
                                    Cr: {formatKES(accountCredit)}
                                  </span>
                                )}
                                <span className={`font-bold font-mono min-w-[80px] text-right ${
                                  runningBalance >= 0
                                    ? (type === 'ASSET' || type === 'EXPENSE') ? 'text-foreground' : 'text-foreground'
                                    : 'text-red-600'
                                }`}>
                                  {formatKES(Math.abs(runningBalance))}
                                  {runningBalance < 0 && ' Cr'}
                                </span>
                              </div>
                              <Badge
                                variant={account.isActive ? 'secondary' : 'outline'}
                                className={`text-[9px] ${account.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}`}
                              >
                                {account.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem
                                    onClick={() => openEditAccount(account)}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <Edit2 className="h-4 w-4" /> Edit Account
                                  </DropdownMenuItem>
                                  {account.isActive && (
                                    <DropdownMenuItem
                                      onClick={() => setDeactivateAccountTarget(account)}
                                      className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                                    >
                                      <PowerOff className="h-4 w-4" /> Deactivate
                                    </DropdownMenuItem>
                                  )}
                                  {!account.isActive && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        if (!authUser) return;
                                        updateAccountMutation.mutate({
                                          id: account.id,
                                          data: { isActive: true, updatedByUserId: authUser.id },
                                        });
                                      }}
                                      className="gap-2 cursor-pointer text-green-600 focus:text-green-600"
                                    >
                                      <PowerOff className="h-4 w-4" /> Reactivate
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                        <div className={`flex items-center gap-2 px-3 py-2 ${colors.headerBg}`}>
                          <span className="text-xs font-bold uppercase tracking-wider pl-8" style={{ flex: 1 }}>
                            Total {accountTypeLabels[type]}: {group.length} account{group.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-xs font-bold font-mono">
                            {formatKES(Math.abs(groupBalance))}
                            {groupBalance < 0 ? ' Cr' : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Trial Balance Summary */}
          {(trialBalance.totalDebits > 0 || trialBalance.totalCredits > 0) && (
            <div className="mt-4 p-3 rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5" /> Trial Balance Summary
                </p>
                <Badge className={`text-[9px] ${trialBalance.isBalanced ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                  {trialBalance.isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="text-center flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase">Total Debits</p>
                  <p className="font-bold text-blue-600 dark:text-blue-400 font-mono">{formatKES(trialBalance.totalDebits)}</p>
                </div>
                <div className="text-center px-4">
                  <span className="text-muted-foreground">=</span>
                </div>
                <div className="text-center flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase">Total Credits</p>
                  <p className="font-bold text-green-600 dark:text-green-400 font-mono">{formatKES(trialBalance.totalCredits)}</p>
                </div>
              </div>
              {!trialBalance.isBalanced && (
                <p className="text-[10px] text-red-500 mt-1 text-center">
                  Difference: {formatKES(Math.abs(trialBalance.totalDebits - trialBalance.totalCredits))}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      {/* ================================================================== */}
      {/* JOURNAL ENTRIES sub-tab                                             */}
      {/* ================================================================== */}
      <TabsContent value="journal" className="space-y-4">
      {/* Journal Entries */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Journal Entries
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{journals.length} entries</Badge>
              {journalTotalDebit > 0 && (
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-blue-600 font-mono">Dr: {formatKES(journalTotalDebit)}</span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-green-600 font-mono">Cr: {formatKES(journalTotalCredit)}</span>
                </div>
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportToCSV(prepareFinancialCSV(), 'journal_entries')}>
                <Download className="mr-1 h-3 w-3" /> Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {journalLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : journals.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No journal entries</p>
              <p className="text-xs text-muted-foreground mt-1">Entries will appear when transactions are recorded</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]" />
                    <TableHead>Entry #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journals.map((je) => (
                    <React.Fragment key={je.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 transition-colors ${je.isVoided ? 'opacity-50' : ''}`}
                        onClick={() => toggleJournal(je.id)}
                      >
                        <TableCell>
                          {expandedJournals.has(je.id) ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs bg-muted/50">
                            {je.entryNumber}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(je.entryDate)}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{je.description}</TableCell>
                        <TableCell className="text-sm">{je.referenceType || '—'}</TableCell>
                        <TableCell className="text-right font-medium text-sm font-mono text-blue-600 dark:text-blue-400">
                          {formatKES(je.totalDebit)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm font-mono text-green-600 dark:text-green-400">
                          {formatKES(je.totalCredit)}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const status = deriveJournalStatus(je);
                            if (status === 'VOIDED') {
                              return (
                                <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
                                  <Ban className="h-2.5 w-2.5" /> VOIDED
                                </Badge>
                              );
                            }
                            if (status === 'POSTED') {
                              return (
                                <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                                  <FileCheck className="h-2.5 w-2.5" /> Posted
                                </Badge>
                              );
                            }
                            if (status === 'APPROVED') {
                              return (
                                <Badge className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 gap-1">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Approved
                                </Badge>
                              );
                            }
                            return (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Clock className="h-2.5 w-2.5" /> Draft
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {!je.isVoided && (
                                <DropdownMenuItem onClick={() => setVoidJournalTarget(je)} className="gap-2 cursor-pointer text-orange-600 focus:text-orange-600">
                                  <Ban className="h-4 w-4" /> Void Entry
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {expandedJournals.has(je.id) && je.lines && je.lines.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/20 p-0">
                            <div className="px-12 py-3 space-y-1 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                              <p className="text-xs font-medium text-muted-foreground mb-2">Journal Entry Lines</p>
                              {je.lines.map((line) => (
                                <div key={line.id} className="flex items-center gap-3 text-xs py-1 px-2 rounded hover:bg-muted/30">
                                  <span className="font-mono text-muted-foreground w-10">
                                    {line.account?.code || '—'}
                                  </span>
                                  <span className="flex-1">{line.account?.name || line.accountId}</span>
                                  {line.account?.type && (
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] ${accountTypeColors[line.account.type]?.text || ''}`}
                                    >
                                      {line.account.type}
                                    </Badge>
                                  )}
                                  <span className="w-28 text-right font-mono text-blue-600 dark:text-blue-400">
                                    {line.debit > 0 ? formatKES(line.debit) : ''}
                                  </span>
                                  <span className="w-28 text-right font-mono text-green-600 dark:text-green-400">
                                    {line.credit > 0 ? formatKES(line.credit) : ''}
                                  </span>
                                </div>
                              ))}
                              <div className="flex items-center gap-3 text-xs pt-2 border-t mt-2 px-2">
                                <span className="w-10" />
                                <span className="flex-1 font-bold text-muted-foreground">Total</span>
                                <span className="w-28 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                                  {formatKES(je.totalDebit)}
                                </span>
                                <span className="w-28 text-right font-mono font-bold text-green-600 dark:text-green-400">
                                  {formatKES(je.totalCredit)}
                                </span>
                              </div>
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
      </TabsContent>

      {/* ================================================================== */}
      {/* FINANCIAL PERIODS sub-tab                                           */}
      {/* ================================================================== */}
      <TabsContent value="periods" className="space-y-4">
        <FinancialPeriodsPanel />
      </TabsContent>

      {/* ================================================================== */}
      {/* TRIAL BALANCE sub-tab                                               */}
      {/* ================================================================== */}
      <TabsContent value="trial-balance" className="space-y-4">
        <TrialBalancePanel />
      </TabsContent>

      {/* ================================================================== */}
      {/* BUDGETS sub-tab                                                     */}
      {/* ================================================================== */}
      <TabsContent value="budgets" className="space-y-4">
        <BudgetsPanel />
      </TabsContent>

      {/* ================================================================== */}
      {/* REPORTS sub-tab                                                     */}
      {/* ================================================================== */}
      <TabsContent value="reports" className="space-y-4">
        <ReportsPanel />
      </TabsContent>
      </Tabs>

      {/* ================================================================== */}
      {/* Drill-down Dialogs                                                  */}
      {/* ================================================================== */}

      {/* Revenue Drill-down Dialog */}
      <Dialog open={drilldownDialog === 'revenue'} onOpenChange={() => setDrilldownDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" /> Revenue Breakdown
            </DialogTitle>
            <DialogDescription>Daily revenue for the selected period</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
            {revenueTrendData.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Total</p>
                    <p className="text-sm font-bold text-green-600">{formatKES(revenueTrendData.reduce((s, d) => s + d.revenue, 0))}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Average</p>
                    <p className="text-sm font-bold text-blue-600">{formatKES(revenueTrendData.reduce((s, d) => s + d.revenue, 0) / revenueTrendData.length)}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Peak Day</p>
                    <p className="text-sm font-bold text-purple-600">{formatKES(Math.max(...revenueTrendData.map(d => d.revenue)))}</p>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueTrendData.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{d.label}</TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatKES(d.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <p className="text-center text-muted-foreground py-8">No revenue data available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Debt Aging Drill-down Dialog */}
      <Dialog open={drilldownDialog === 'debt'} onOpenChange={() => setDrilldownDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-red-600" /> Outstanding Debt Breakdown
            </DialogTitle>
            <DialogDescription>Debt aging analysis by time period</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <p className="text-xs text-muted-foreground">Current (0 days)</p>
                <p className="text-lg font-bold text-green-600">{formatKES(agingSummary.current)}</p>
                <p className="text-[10px] text-muted-foreground">{debts.filter(d => d.agingBucket === 'CURRENT').length} invoices</p>
              </div>
              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p className="text-xs text-muted-foreground">1-30 Days Overdue</p>
                <p className="text-lg font-bold text-yellow-600">{formatKES(agingSummary.days30)}</p>
                <p className="text-[10px] text-muted-foreground">{debts.filter(d => d.agingBucket === 'DAYS_30').length} invoices</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                <p className="text-xs text-muted-foreground">31-60 Days Overdue</p>
                <p className="text-lg font-bold text-orange-600">{formatKES(agingSummary.days60)}</p>
                <p className="text-[10px] text-muted-foreground">{debts.filter(d => d.agingBucket === 'DAYS_60').length} invoices</p>
              </div>
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-xs text-muted-foreground">61+ Days Overdue</p>
                <p className="text-lg font-bold text-red-600">{formatKES(agingSummary.days90Plus)}</p>
                <p className="text-[10px] text-muted-foreground">{debts.filter(d => d.agingBucket === 'DAYS_90_PLUS').length} invoices</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Outstanding</span>
              <span className="text-lg font-bold text-red-600">{formatKES(agingTotal)}</span>
            </div>
            {debts.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debts.slice(0, 20).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-sm">{d.customer?.name || 'Unknown'}</TableCell>
                        <TableCell className="text-sm font-medium">{formatKES(d.balance)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[9px]">{d.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(d.dueDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => exportToCSV(prepareDebtCSV(), 'debt_aging')}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export Debt Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      {paymentDebt && (
        <RecordPaymentDialog
          debt={paymentDebt}
          open={!!paymentDebt}
          onOpenChange={(open) => { if (!open) setPaymentDebt(null); }}
          onRecordPayment={(data) => {
            recordPaymentMutation.mutate({
              storeId: currentStoreId,
              debtLedgerId: data.debtLedgerId,
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              receivedBy: authUser?.id || undefined,
            });
          }}
        />
      )}

      {/* View Ledger Dialog */}
      <Dialog open={drilldownDialog === 'ledger'} onOpenChange={() => setDrilldownDialog(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" /> General Ledger
            </DialogTitle>
            <DialogDescription>Complete ledger with all journal entries and account transactions</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journals.length > 0 ? journals.flatMap((je) =>
                  (je.lines || []).map((line, li) => (
                    <TableRow key={`${je.id}-${li}`} className={li === 0 ? 'border-t-2' : ''}>
                      {li === 0 ? (
                        <>
                          <TableCell rowSpan={je.lines?.length || 1} className="text-sm align-top">{formatDate(je.entryDate)}</TableCell>
                          <TableCell rowSpan={je.lines?.length || 1} className="align-top">
                            <Badge variant="outline" className="font-mono text-xs">{je.entryNumber}</Badge>
                          </TableCell>
                          <TableCell rowSpan={je.lines?.length || 1} className="text-sm max-w-[150px] truncate align-top">{je.description}</TableCell>
                        </>
                      ) : null}
                      <TableCell className="text-sm">
                        <span className="font-mono text-muted-foreground mr-1">{line.account?.code || ''}</span>
                        {line.account?.name || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-blue-600 dark:text-blue-400">
                        {line.debit > 0 ? formatKES(line.debit) : ''}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-600 dark:text-green-400">
                        {line.credit > 0 ? formatKES(line.credit) : ''}
                      </TableCell>
                      {li === 0 ? (
                        <TableCell rowSpan={je.lines?.length || 1} className="align-top">
                          {je.isVoided ? (
                            <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">VOIDED</Badge>
                          ) : je.isPosted ? (
                            <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Posted</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px]">Draft</Badge>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No journal entries found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Expense Dialog */}
      <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Minus className="h-5 w-5 text-orange-600" /> Record Expense
            </DialogTitle>
            <DialogDescription>Record a new expense for the store</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="e.g. Monthly rent payment"
                value={expenseForm.description}
                onChange={(e) => setExpenseForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount (KES)</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                min="1"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={expenseForm.category} onValueChange={(val) => setExpenseForm(prev => ({ ...prev, category: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RENT">Rent</SelectItem>
                    <SelectItem value="SALARIES">Salaries</SelectItem>
                    <SelectItem value="UTILITIES">Utilities</SelectItem>
                    <SelectItem value="TRANSPORT">Transport</SelectItem>
                    <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                    <SelectItem value="SUPPLIES">Supplies</SelectItem>
                    <SelectItem value="BAD_DEBT">Bad Debt</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={expenseForm.paymentMethod} onValueChange={(val) => setExpenseForm(prev => ({ ...prev, paymentMethod: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">💵 Cash</SelectItem>
                    <SelectItem value="MPESA">📱 M-Pesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Additional notes..."
                value={expenseForm.notes}
                onChange={(e) => setExpenseForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExpenseDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateExpense} disabled={createExpenseMutation.isPending} className="bg-orange-600 hover:bg-orange-700">
              {createExpenseMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Record Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Journal Entry Dialog */}
      <Dialog open={showJournalDialog} onOpenChange={setShowJournalDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" /> Add Journal Entry
            </DialogTitle>
            <DialogDescription>Create a new manual journal entry. Debits must equal credits.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Adjust inventory valuation"
                  value={journalForm.description}
                  onChange={(e) => setJournalForm(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Reference Type</Label>
                <Select value={journalForm.referenceType} onValueChange={(val) => setJournalForm(prev => ({ ...prev, referenceType: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual</SelectItem>
                    <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                    <SelectItem value="CORRECTION">Correction</SelectItem>
                    <SelectItem value="ACCRUAL">Accrual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Journal Lines</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setJournalForm(prev => ({
                    ...prev,
                    lines: [...prev.lines, { accountId: '', debit: '', credit: '', description: '' }],
                  }))}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Line
                </Button>
              </div>
              <div className="space-y-2">
                {journalForm.lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      {i === 0 && <Label className="text-xs">Account</Label>}
                      <Select value={line.accountId} onValueChange={(val) => {
                        const newLines = [...journalForm.lines];
                        newLines[i] = { ...newLines[i], accountId: val };
                        setJournalForm(prev => ({ ...prev, lines: newLines }));
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.code} - {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      {i === 0 && <Label className="text-xs">Debit</Label>}
                      <Input
                        type="number"
                        placeholder="0"
                        className="h-8 text-xs"
                        value={line.debit}
                        onChange={(e) => {
                          const newLines = [...journalForm.lines];
                          newLines[i] = { ...newLines[i], debit: e.target.value, credit: e.target.value ? '0' : newLines[i].credit };
                          setJournalForm(prev => ({ ...prev, lines: newLines }));
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      {i === 0 && <Label className="text-xs">Credit</Label>}
                      <Input
                        type="number"
                        placeholder="0"
                        className="h-8 text-xs"
                        value={line.credit}
                        onChange={(e) => {
                          const newLines = [...journalForm.lines];
                          newLines[i] = { ...newLines[i], credit: e.target.value, debit: e.target.value ? '0' : newLines[i].debit };
                          setJournalForm(prev => ({ ...prev, lines: newLines }));
                        }}
                      />
                    </div>
                    <div className="col-span-3">
                      {i === 0 && <Label className="text-xs">Line Desc</Label>}
                      <Input
                        placeholder="Optional"
                        className="h-8 text-xs"
                        value={line.description}
                        onChange={(e) => {
                          const newLines = [...journalForm.lines];
                          newLines[i] = { ...newLines[i], description: e.target.value };
                          setJournalForm(prev => ({ ...prev, lines: newLines }));
                        }}
                      />
                    </div>
                    <div className="col-span-1">
                      {journalForm.lines.length > 2 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500"
                          onClick={() => {
                            const newLines = journalForm.lines.filter((_, idx) => idx !== i);
                            setJournalForm(prev => ({ ...prev, lines: newLines }));
                          }}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const totalD = journalForm.lines.reduce((s, l) => s + (parseFloat(l.debit || '0')), 0);
                const totalC = journalForm.lines.reduce((s, l) => s + (parseFloat(l.credit || '0')), 0);
                const diff = Math.abs(totalD - totalC);
                return (
                  <div className={`text-xs p-2 rounded ${diff < 0.01 && totalD > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : totalD > 0 || totalC > 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' : 'bg-muted text-muted-foreground'}`}>
                    <span>Total Debit: {formatKES(totalD)}</span>
                    <span className="mx-2">|</span>
                    <span>Total Credit: {formatKES(totalC)}</span>
                    <span className="mx-2">|</span>
                    <span>Difference: {formatKES(diff)}</span>
                    {diff < 0.01 && totalD > 0 && <span className="ml-2">✓ Balanced</span>}
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJournalDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateJournal} disabled={createJournalMutation.isPending} className="bg-green-600 hover:bg-green-700">
              {createJournalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Create Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* Phase 3 — Add / Edit Account Dialog                                 */}
      {/* ================================================================== */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editAccountTarget ? <Edit2 className="h-5 w-5 text-orange-600" /> : <Plus className="h-5 w-5 text-green-600" />}
              {editAccountTarget ? 'Edit Account' : 'Add Account'}
            </DialogTitle>
            <DialogDescription>
              {editAccountTarget
                ? 'Update name, sub-type, description, or active status. Code, type, and normal balance are immutable (create a new account to change them).'
                : 'Create a new account in the chart of accounts. The normal balance defaults by type (DEBIT for assets/expenses).'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input
                  placeholder="e.g. 1010"
                  value={accountForm.code}
                  onChange={(e) => setAccountForm((prev) => ({ ...prev, code: e.target.value }))}
                  disabled={!!editAccountTarget}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={accountForm.type}
                  onValueChange={handleAccountTypeChange}
                  disabled={!!editAccountTarget}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ASSET">Asset</SelectItem>
                    <SelectItem value="LIABILITY">Liability</SelectItem>
                    <SelectItem value="EQUITY">Equity</SelectItem>
                    <SelectItem value="REVENUE">Revenue</SelectItem>
                    <SelectItem value="EXPENSE">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Cash on Hand"
                value={accountForm.name}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sub-Type (optional)</Label>
                <Select
                  value={accountForm.subType || 'NONE'}
                  onValueChange={(v) => setAccountForm((prev) => ({ ...prev, subType: v === 'NONE' ? '' : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">— None —</SelectItem>
                    <SelectItem value="CURRENT_ASSET">Current Asset</SelectItem>
                    <SelectItem value="FIXED_ASSET">Fixed Asset</SelectItem>
                    <SelectItem value="INVENTORY">Inventory</SelectItem>
                    <SelectItem value="CASH_EQUIVALENT">Cash Equivalent</SelectItem>
                    <SelectItem value="ACCOUNTS_RECEIVABLE">Accounts Receivable</SelectItem>
                    <SelectItem value="CURRENT_LIABILITY">Current Liability</SelectItem>
                    <SelectItem value="LONG_TERM_LIABILITY">Long-Term Liability</SelectItem>
                    <SelectItem value="ACCOUNTS_PAYABLE">Accounts Payable</SelectItem>
                    <SelectItem value="OWNERS_EQUITY">Owners Equity</SelectItem>
                    <SelectItem value="RETAINED_EARNINGS">Retained Earnings</SelectItem>
                    <SelectItem value="OPERATING_REVENUE">Operating Revenue</SelectItem>
                    <SelectItem value="OTHER_REVENUE">Other Revenue</SelectItem>
                    <SelectItem value="COGS">COGS</SelectItem>
                    <SelectItem value="OPERATING_EXPENSE">Operating Expense</SelectItem>
                    <SelectItem value="ADMIN_EXPENSE">Admin Expense</SelectItem>
                    <SelectItem value="TAX_PAYABLE">Tax Payable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Normal Balance</Label>
                <Select
                  value={accountForm.normalBalance}
                  onValueChange={(v) => setAccountForm((prev) => ({ ...prev, normalBalance: v }))}
                  disabled={!!editAccountTarget}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBIT">Debit</SelectItem>
                    <SelectItem value="CREDIT">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="e.g. Operating cash drawer — front-of-house."
                value={accountForm.description}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive accounts are excluded from new journal entries.</p>
              </div>
              <Switch
                checked={accountForm.isActive}
                onCheckedChange={(v) => setAccountForm((prev) => ({ ...prev, isActive: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSaveAccount}
              disabled={createAccountMutation.isPending || updateAccountMutation.isPending}
              className={editAccountTarget ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'}
            >
              {(createAccountMutation.isPending || updateAccountMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {editAccountTarget ? 'Update Account' : 'Create Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* Phase 3 — Deactivate Account Confirmation                           */}
      {/* ================================================================== */}
      <AlertDialog open={!!deactivateAccountTarget} onOpenChange={(open) => { if (!open) setDeactivateAccountTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PowerOff className="h-5 w-5 text-red-600" /> Deactivate Account
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deactivate account &ldquo;{deactivateAccountTarget?.code} — {deactivateAccountTarget?.name}&rdquo;?
              Deactivation is blocked if the account has a non-zero balance (would corrupt historical reports).
              The account remains in the ledger for historical reporting but cannot be used on new entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivateAccount}
              disabled={deactivateAccountMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deactivateAccountMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Expense Dialog */}
      <Dialog open={!!editExpense} onOpenChange={(open) => { if (!open) setEditExpense(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-orange-600" /> Edit Expense
            </DialogTitle>
            <DialogDescription>Update expense details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="e.g. Monthly rent payment"
                value={editExpenseForm.description}
                onChange={(e) => setEditExpenseForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount (KES)</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                min="1"
                value={editExpenseForm.amount}
                onChange={(e) => setEditExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={editExpenseForm.category} onValueChange={(val) => setEditExpenseForm(prev => ({ ...prev, category: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RENT">Rent</SelectItem>
                    <SelectItem value="SALARIES">Salaries</SelectItem>
                    <SelectItem value="UTILITIES">Utilities</SelectItem>
                    <SelectItem value="TRANSPORT">Transport</SelectItem>
                    <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                    <SelectItem value="SUPPLIES">Supplies</SelectItem>
                    <SelectItem value="BAD_DEBT">Bad Debt</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={editExpenseForm.paymentMethod} onValueChange={(val) => setEditExpenseForm(prev => ({ ...prev, paymentMethod: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">💵 Cash</SelectItem>
                    <SelectItem value="MPESA">📱 M-Pesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Additional notes..."
                value={editExpenseForm.notes}
                onChange={(e) => setEditExpenseForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditExpense(null)}>Cancel</Button>
            <Button onClick={handleUpdateExpense} disabled={updateExpenseMutation.isPending} className="bg-orange-600 hover:bg-orange-700">
              {updateExpenseMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Update Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Expense Confirmation */}
      <AlertDialog open={!!voidExpenseTarget} onOpenChange={(open) => { if (!open) setVoidExpenseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-orange-600" /> Void Expense
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void the expense &ldquo;{voidExpenseTarget?.description}&rdquo; ({formatKES(voidExpenseTarget?.amount || 0)})?
              This will also void the associated journal entry. This action can be undone by an admin but the entry will be marked as voided.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidExpenseTarget && voidExpenseMutation.mutate(voidExpenseTarget.id)}
              disabled={voidExpenseMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {voidExpenseMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Void Expense
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Expense Confirmation */}
      <AlertDialog open={!!deleteExpenseTarget} onOpenChange={(open) => { if (!open) setDeleteExpenseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" /> Delete Expense Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete the voided expense &ldquo;{deleteExpenseTarget?.description}&rdquo;?
              This action cannot be undone. The expense record and all associated data will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteExpenseTarget && deleteExpenseMutation.mutate(deleteExpenseTarget.id)}
              disabled={deleteExpenseMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteExpenseMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void Journal Entry Confirmation */}
      <AlertDialog open={!!voidJournalTarget} onOpenChange={(open) => { if (!open) setVoidJournalTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-orange-600" /> Void Journal Entry
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void journal entry {voidJournalTarget?.entryNumber}?
              {voidJournalTarget?.referenceType === 'EXPENSE' && ' This will also void the associated expense.'}
              Voided entries remain in the ledger but are marked as voided and excluded from calculations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidJournalTarget && voidJournalEntryMutation.mutate(voidJournalTarget.id)}
              disabled={voidJournalEntryMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {voidJournalEntryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Void Entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
