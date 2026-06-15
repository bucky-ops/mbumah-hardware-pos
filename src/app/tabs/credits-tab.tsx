'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CreditCard, Search, Plus, ArrowUpRight, ArrowDownRight,
  Minus, RotateCcw, Loader2, Filter, Users, Wallet,
  TrendingUp, TrendingDown, Scale, ChevronUp, ChevronDown,
  FileText, User, CircleDollarSign, AlertCircle,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  customerCreditsApi, customersApi,
  formatKES, formatDate, formatDateTime,
  type CustomerCreditItem,
  type CustomerItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';

// Avatar gradient helper
const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-teal-600',
  'from-emerald-500 to-green-600',
  'from-amber-500 to-orange-600',
  'from-red-500 to-rose-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-amber-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

// Credit type badge styling
function getCreditTypeBadge(creditType: string) {
  switch (creditType) {
    case 'CREDIT':
      return {
        class: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        icon: <ArrowUpRight className="h-3 w-3" />,
        label: 'Credit',
      };
    case 'DEBIT':
      return {
        class: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
        icon: <ArrowDownRight className="h-3 w-3" />,
        label: 'Debit',
      };
    case 'ADJUSTMENT':
      return {
        class: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
        icon: <Minus className="h-3 w-3" />,
        label: 'Adjustment',
      };
    case 'REFUND':
      return {
        class: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        icon: <RotateCcw className="h-3 w-3" />,
        label: 'Refund',
      };
    default:
      return {
        class: 'bg-muted text-muted-foreground',
        icon: null,
        label: creditType,
      };
  }
}

// Amount color helper
function getAmountColor(creditType: string): string {
  switch (creditType) {
    case 'CREDIT':
    case 'REFUND':
      return 'text-green-600 dark:text-green-400';
    case 'DEBIT':
    case 'ADJUSTMENT':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-foreground';
  }
}

// Amount prefix helper
function getAmountPrefix(creditType: string): string {
  switch (creditType) {
    case 'CREDIT':
    case 'REFUND':
      return '+';
    case 'DEBIT':
    case 'ADJUSTMENT':
      return '-';
    default:
      return '';
  }
}

type SortField = 'date' | 'customer' | 'type' | 'amount' | 'balance';
type SortDirection = 'asc' | 'desc';

// Sort icon component declared outside render
function SortIcon({ field, sortField, sortDirection }: { field: SortField; sortField: SortField; sortDirection: SortDirection }) {
  if (sortField !== field) return <ChevronUp className="h-3 w-3 opacity-30" />;
  return sortDirection === 'asc'
    ? <ChevronUp className="h-3 w-3" />
    : <ChevronDown className="h-3 w-3" />;
}

export default function CreditsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all');
  const [creditTypeFilter, setCreditTypeFilter] = useState<string>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Add credit/debit form state
  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formCreditType, setFormCreditType] = useState<string>('CREDIT');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formReference, setFormReference] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Queries
  const { data: creditsData, isLoading: creditsLoading } = useQuery({
    queryKey: ['customer-credits', currentStoreId, selectedCustomerId, creditTypeFilter],
    queryFn: () => customerCreditsApi.list({
      storeId: currentStoreId,
      customerId: selectedCustomerId !== 'all' ? selectedCustomerId : undefined,
      creditType: creditTypeFilter !== 'all' ? creditTypeFilter : undefined,
    }),
    enabled: !!currentStoreId,
  });

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 200 }),
    enabled: !!currentStoreId,
  });

  // Mutations
  const createCreditMutation = useMutation({
    mutationFn: customerCreditsApi.create,
    onSuccess: () => {
      toast.success('Credit/Debit entry created successfully');
      setAddDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['customer-credits', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['customers', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create entry'),
  });

  // Helpers
  const credits: CustomerCreditItem[] = creditsData?.data || [];
  const customers: CustomerItem[] = customersData?.data || [];

  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerItem>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  // Filter credits by search query
  const filteredCredits = useMemo(() => {
    let result = credits;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => {
        const customer = customerMap.get(c.customerId);
        const customerName = customer?.name?.toLowerCase() || '';
        const reference = c.reference?.toLowerCase() || '';
        const description = c.description?.toLowerCase() || '';
        return customerName.includes(q) || reference.includes(q) || description.includes(q);
      });
    }

    return result;
  }, [credits, searchQuery, customerMap]);

  // Sort credits
  const sortedCredits = useMemo(() => {
    const result = [...filteredCredits];

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'customer': {
          const nameA = customerMap.get(a.customerId)?.name || '';
          const nameB = customerMap.get(b.customerId)?.name || '';
          cmp = nameA.localeCompare(nameB);
          break;
        }
        case 'type':
          cmp = a.creditType.localeCompare(b.creditType);
          break;
        case 'amount':
          cmp = a.amount - b.amount;
          break;
        case 'balance':
          cmp = a.balance - b.balance;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [filteredCredits, sortField, sortDirection, customerMap]);

  // Stats calculations
  const stats = useMemo(() => {
    const totalCredits = credits
      .filter((c) => c.creditType === 'CREDIT' || c.creditType === 'REFUND')
      .reduce((sum, c) => sum + c.amount, 0);

    const totalDebits = credits
      .filter((c) => c.creditType === 'DEBIT' || c.creditType === 'ADJUSTMENT')
      .reduce((sum, c) => sum + c.amount, 0);

    const netBalance = totalCredits - totalDebits;

    // Count unique customers with outstanding credit
    const activeCustomers = new Set(
      credits.map((c) => c.customerId)
    ).size;

    return { totalCredits, totalDebits, netBalance, activeCustomers };
  }, [credits]);

  // Per-customer balance summary
  const customerBalances = useMemo(() => {
    const balanceMap = new Map<string, { customer: CustomerItem; credits: number; debits: number; balance: number; entries: number }>();

    credits.forEach((c) => {
      const existing = balanceMap.get(c.customerId);
      const isCredit = c.creditType === 'CREDIT' || c.creditType === 'REFUND';
      if (existing) {
        if (isCredit) existing.credits += c.amount;
        else existing.debits += c.amount;
        existing.balance = existing.credits - existing.debits;
        existing.entries += 1;
      } else {
        const customer = customerMap.get(c.customerId);
        if (customer) {
          balanceMap.set(c.customerId, {
            customer,
            credits: isCredit ? c.amount : 0,
            debits: isCredit ? 0 : c.amount,
            balance: isCredit ? c.amount : -c.amount,
            entries: 1,
          });
        }
      }
    });

    return Array.from(balanceMap.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [credits, customerMap]);

  // Running balance for the ledger
  const ledgerWithRunningBalance = useMemo(() => {
    // Group by customer, then compute running balance per customer
    const byCustomer = new Map<string, CustomerCreditItem[]>();
    sortedCredits.forEach((c) => {
      const arr = byCustomer.get(c.customerId) || [];
      arr.push(c);
      byCustomer.set(c.customerId, arr);
    });

    // Calculate running balance per customer
    const runningBalances = new Map<string, number>();
    const result = sortedCredits.map((c) => {
      const prev = runningBalances.get(c.customerId) || 0;
      const isCredit = c.creditType === 'CREDIT' || c.creditType === 'REFUND';
      const change = isCredit ? c.amount : -c.amount;
      const running = prev + change;
      runningBalances.set(c.customerId, running);
      return { ...c, runningBalance: running };
    });

    return result;
  }, [sortedCredits]);

  // Form helpers
  function resetForm() {
    setFormCustomerId('');
    setFormCreditType('CREDIT');
    setFormAmount('');
    setFormReference('');
    setFormDescription('');
    setFormErrors({});
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!formCustomerId) errors.customerId = 'Please select a customer';
    if (!formAmount || parseFloat(formAmount) <= 0) errors.amount = 'Amount must be greater than 0';
    if (formAmount && isNaN(parseFloat(formAmount))) errors.amount = 'Please enter a valid number';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleCreateEntry() {
    if (!validateForm()) return;
    createCreditMutation.mutate({
      storeId: currentStoreId,
      customerId: formCustomerId,
      amount: parseFloat(formAmount),
      creditType: formCreditType,
      reference: formReference || undefined,
      description: formDescription || undefined,
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  const isLoading = creditsLoading || customersLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Credits & Debits</h2>
          <p className="text-sm text-muted-foreground">
            Manage customer credit accounts and track outstanding balances
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Entry
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Credits</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatKES(stats.totalCredits)}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <ArrowUpRight className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Debits</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {formatKES(stats.totalDebits)}
                </p>
              </div>
              <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <ArrowDownRight className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Balance</p>
                <p className={`text-2xl font-bold ${stats.netBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {stats.netBalance >= 0 ? '+' : ''}{formatKES(stats.netBalance)}
                </p>
              </div>
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${stats.netBalance >= 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Scale className={`h-5 w-5 ${stats.netBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Accounts</p>
                <p className="text-2xl font-bold">{stats.activeCustomers}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters Row */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, reference, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Customers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={creditTypeFilter} onValueChange={setCreditTypeFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="CREDIT">Credits</SelectItem>
                  <SelectItem value="DEBIT">Debits</SelectItem>
                  <SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
                  <SelectItem value="REFUND">Refunds</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
                className={showFilters ? 'bg-accent' : ''}
              >
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Credit Ledger Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5" />
                  Credit Ledger
                </CardTitle>
                <Badge variant="secondary" className="font-normal">
                  {filteredCredits.length} entries
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="h-4 w-20" />
                    </div>
                  ))}
                </div>
              ) : ledgerWithRunningBalance.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CreditCard className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground">No entries found</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchQuery || selectedCustomerId !== 'all' || creditTypeFilter !== 'all'
                      ? 'Try adjusting your filters'
                      : 'Add your first credit or debit entry to get started'}
                  </p>
                  {!searchQuery && selectedCustomerId === 'all' && creditTypeFilter === 'all' && (
                    <Button onClick={() => setAddDialogOpen(true)} className="mt-4 gap-2">
                      <Plus className="h-4 w-4" />
                      Add Entry
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-[520px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('date')}
                        >
                          <div className="flex items-center gap-1">
                            Date <SortIcon field="date" sortField={sortField} sortDirection={sortDirection} />
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('customer')}
                        >
                          <div className="flex items-center gap-1">
                            Customer <SortIcon field="customer" sortField={sortField} sortDirection={sortDirection} />
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('type')}
                        >
                          <div className="flex items-center gap-1">
                            Type <SortIcon field="type" sortField={sortField} sortDirection={sortDirection} />
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('amount')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Amount <SortIcon field="amount" sortField={sortField} sortDirection={sortDirection} />
                          </div>
                        </TableHead>
                        <TableHead className="hidden md:table-cell">Reference</TableHead>
                        <TableHead className="hidden lg:table-cell">Description</TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('balance')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Balance <SortIcon field="balance" sortField={sortField} sortDirection={sortDirection} />
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerWithRunningBalance.map((entry) => {
                        const customer = customerMap.get(entry.customerId);
                        const badge = getCreditTypeBadge(entry.creditType);
                        const amountColor = getAmountColor(entry.creditType);
                        const amountPrefix = getAmountPrefix(entry.creditType);
                        const gradient = customer ? getAvatarGradient(customer.name) : '';

                        return (
                          <TableRow key={entry.id} className="hover:bg-muted/30">
                            <TableCell className="whitespace-nowrap text-sm">
                              <div className="font-medium">{formatDate(entry.createdAt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(entry.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className={`bg-gradient-to-br ${gradient} text-white text-[10px]`}>
                                    {customer?.name?.charAt(0)?.toUpperCase() || '?'}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium text-sm truncate max-w-[120px]">
                                  {customer?.name || 'Unknown'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge.class}`}>
                                {badge.icon}
                                {badge.label}
                              </span>
                            </TableCell>
                            <TableCell className={`text-right font-semibold text-sm ${amountColor}`}>
                              {amountPrefix}{formatKES(entry.amount)}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {entry.reference || '—'}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                              {entry.description || '—'}
                            </TableCell>
                            <TableCell className={`text-right font-semibold text-sm ${entry.runningBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {formatKES(Math.abs(entry.runningBalance))}
                              {entry.runningBalance < 0 && <span className="text-xs ml-0.5">DR</span>}
                              {entry.runningBalance > 0 && <span className="text-xs ml-0.5">CR</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Customer Balance Cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wallet className="h-5 w-5" />
                Customer Balances
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : customerBalances.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No customer balances</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {customerBalances.slice(0, 15).map((cb) => {
                    const gradient = getAvatarGradient(cb.customer.name);
                    const maxBalance = Math.max(...customerBalances.map((b) => Math.abs(b.balance)), 1);
                    const progressPercent = Math.min((Math.abs(cb.balance) / maxBalance) * 100, 100);

                    return (
                      <div
                        key={cb.customer.id}
                        className="p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => setSelectedCustomerId(cb.customer.id)}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={`bg-gradient-to-br ${gradient} text-white text-xs`}>
                              {cb.customer.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{cb.customer.name}</p>
                            <p className="text-xs text-muted-foreground">{cb.entries} entries</p>
                          </div>
                          <div className="text-right">
                            <p className={`font-bold text-sm ${cb.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {formatKES(Math.abs(cb.balance))}
                            </p>
                            <p className={`text-[10px] font-medium ${cb.balance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {cb.balance >= 0 ? 'CR' : 'DR'}
                            </p>
                          </div>
                        </div>
                        <Progress
                          value={progressPercent}
                          className={`h-1.5 ${cb.balance >= 0 ? '[&>div]:bg-green-500' : '[&>div]:bg-red-500'}`}
                        />
                        <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                          <span className="text-green-600 dark:text-green-400">Credits: {formatKES(cb.credits)}</span>
                          <span className="text-red-600 dark:text-red-400">Debits: {formatKES(cb.debits)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Credit/Debit Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setAddDialogOpen(open); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5" />
              Add Credit / Debit Entry
            </DialogTitle>
            <DialogDescription>
              Record a new credit, debit, adjustment, or refund for a customer account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Customer Selection */}
            <div className="space-y-2">
              <Label htmlFor="credit-customer">Customer *</Label>
              <Select value={formCustomerId} onValueChange={setFormCustomerId}>
                <SelectTrigger id="credit-customer" className={formErrors.customerId ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        {c.name}
                        {c.phone && <span className="text-xs text-muted-foreground">({c.phone})</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formErrors.customerId && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {formErrors.customerId}
                </p>
              )}
            </div>

            {/* Credit Type */}
            <div className="space-y-2">
              <Label htmlFor="credit-type">Entry Type *</Label>
              <Select value={formCreditType} onValueChange={setFormCreditType}>
                <SelectTrigger id="credit-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREDIT">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="h-3 w-3 text-green-600" />
                      Credit (Add to account)
                    </div>
                  </SelectItem>
                  <SelectItem value="DEBIT">
                    <div className="flex items-center gap-2">
                      <ArrowDownRight className="h-3 w-3 text-red-600" />
                      Debit (Deduct from account)
                    </div>
                  </SelectItem>
                  <SelectItem value="ADJUSTMENT">
                    <div className="flex items-center gap-2">
                      <Minus className="h-3 w-3 text-amber-600" />
                      Adjustment
                    </div>
                  </SelectItem>
                  <SelectItem value="REFUND">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-3 w-3 text-blue-600" />
                      Refund
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="credit-amount">Amount (KES) *</Label>
              <Input
                id="credit-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                className={formErrors.amount ? 'border-red-500' : ''}
              />
              {formErrors.amount && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {formErrors.amount}
                </p>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-2">
              <Label htmlFor="credit-reference">Reference</Label>
              <Input
                id="credit-reference"
                placeholder="e.g. INV-001, PAY-2024-03"
                value={formReference}
                onChange={(e) => setFormReference(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="credit-description">Description</Label>
              <Textarea
                id="credit-description"
                placeholder="Add notes about this entry..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Preview */}
            {formCustomerId && formAmount && parseFloat(formAmount) > 0 && (
              <>
                <Separator />
                <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Preview</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {customerMap.get(formCustomerId)?.name || 'Customer'}
                    </span>
                    <span className={`font-bold text-sm ${getAmountColor(formCreditType)}`}>
                      {getAmountPrefix(formCreditType)}{formatKES(parseFloat(formAmount))}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {(() => {
                      const badge = getCreditTypeBadge(formCreditType);
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.class}`}>
                          {badge.icon}
                          {badge.label}
                        </span>
                      );
                    })()}
                    {formReference && (
                      <span className="text-xs text-muted-foreground">Ref: {formReference}</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateEntry}
              disabled={createCreditMutation.isPending}
              className="gap-2"
            >
              {createCreditMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Entry
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
