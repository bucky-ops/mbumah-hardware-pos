'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users, Search, Plus, CircleDollarSign, AlertTriangle,
  Eye, Loader2, HandCoins, Banknote, Smartphone,
  MessageSquare, ShoppingBag, Award, Phone, Mail, MapPin, CreditCard, Clock,
  ArrowUpDown, Filter, UserPlus, TrendingUp, Calendar, FileText, Bell
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  customersApi, debtApi, transactionsApi,
  formatKES, formatDate, formatDateTime,
  type CustomerItem,
  type TransactionItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

function getLoyaltyTier(points: number): { tier: string; color: string; bg: string; icon: string } {
  if (points >= 1500) return { tier: 'Gold', color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: '🥇' };
  if (points >= 500) return { tier: 'Silver', color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-800/50', icon: '🥈' };
  return { tier: 'Bronze', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30', icon: '🥉' };
}

function getDebtStatus(debtBalance: number, debtLimit: number): { color: string; label: string; bgClass: string } {
  if (debtBalance <= 0) return { color: 'bg-green-500', label: 'No Debt', bgClass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };
  if (debtLimit > 0 && (debtBalance / debtLimit) > 0.5) return { color: 'bg-red-500', label: 'High Risk', bgClass: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
  return { color: 'bg-amber-500', label: 'Outstanding', bgClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
}

// Debt status badge with full styling
function DebtStatusBadge({ customer }: { customer: CustomerItem }) {
  const status = getDebtStatus(customer.currentDebtBalance, customer.debtLimit);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bgClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status.color} ${customer.currentDebtBalance > 0 ? 'animate-pulse' : ''}`} />
      {status.label}
    </span>
  );
}

function getPaymentMethodIcon(method: string) {
  switch (method) {
    case 'CASH': return <Banknote className="h-3 w-3" />;
    case 'MPESA': return <Smartphone className="h-3 w-3" />;
    case 'DEBT': return <CreditCard className="h-3 w-3" />;
    default: return null;
  }
}

function getPaymentMethodBadge(method: string) {
  switch (method) {
    case 'CASH': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'MPESA': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'DEBT': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

// Auto-format phone number to Kenyan format
function formatKenyanPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('254')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  }
  if (digits.startsWith('0') && digits.length >= 4) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}`.trim();
  }
  return value;
}

type SortField = 'name' | 'debt' | 'loyalty' | 'created';
type SortDirection = 'asc' | 'desc';

export default function CustomersTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '', idNumber: '', debtLimit: '50000', notes: '' });
  const [debtPaymentOpen, setDebtPaymentOpen] = useState(false);
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('');
  const [debtPaymentMethod, setDebtPaymentMethod] = useState('CASH');
  const [debtPaymentReference, setDebtPaymentReference] = useState('');
  const [selectedDebtLedgerId, setSelectedDebtLedgerId] = useState<string>('');
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const queryClient = useQueryClient();

  // Filter and sort state
  const [debtFilter, setDebtFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showFilters, setShowFilters] = useState(false);
  const [regDateFrom, setRegDateFrom] = useState('');
  const [regDateTo, setRegDateTo] = useState('');

  // Form validation
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers', currentStoreId, searchQuery],
    queryFn: () => customersApi.list({ storeId: currentStoreId, search: searchQuery || undefined, limit: 200 }),
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt', currentStoreId, selectedCustomer?.id],
    queryFn: () => debtApi.list({ storeId: currentStoreId, customerId: selectedCustomer?.id, limit: 50 }),
    enabled: !!selectedCustomer,
  });

  const { data: customerTransactionsData } = useQuery({
    queryKey: ['customer-transactions', currentStoreId, selectedCustomer?.id],
    queryFn: () => transactionsApi.list({ storeId: currentStoreId, limit: 10 }),
    enabled: !!selectedCustomer,
  });

  const createCustomerMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      toast.success('Customer added');
      setAddCustomerOpen(false);
      setNewCustomer({ name: '', phone: '', email: '', address: '', idNumber: '', debtLimit: '50000', notes: '' });
      setFormErrors({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const debtPaymentMutation = useMutation({
    mutationFn: debtApi.makePayment,
    onSuccess: (res) => {
      const newBalance = res.data?.balance ?? 0;
      toast.success(`Payment recorded! New balance: ${formatKES(newBalance)}`);
      queryClient.invalidateQueries({ queryKey: ['customers', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['debt', currentStoreId, selectedCustomer?.id] });
      setDebtPaymentOpen(false);
      setDebtPaymentAmount('');
      setDebtPaymentMethod('CASH');
      setDebtPaymentReference('');
      setSelectedDebtLedgerId('');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  });

  const rawCustomers = Array.isArray(customersData?.data) ? customersData.data : [];
  const debts = Array.isArray(debtData?.data) ? debtData.data : [];
  const customerTransactions: TransactionItem[] = (Array.isArray(customerTransactionsData?.data) ? customerTransactionsData.data : []).slice(0, 10);

  // Filter customers
  const customers = useMemo(() => {
    let result = rawCustomers;

    // Debt filter
    if (debtFilter === 'no_debt') result = result.filter(c => c.currentDebtBalance <= 0);
    else if (debtFilter === 'outstanding') result = result.filter(c => c.currentDebtBalance > 0 && (c.debtLimit <= 0 || c.currentDebtBalance / c.debtLimit <= 0.5));
    else if (debtFilter === 'overdue') result = result.filter(c => c.debtLimit > 0 && c.currentDebtBalance / c.debtLimit > 0.5);

    // Registration date filter
    if (regDateFrom) {
      const from = new Date(regDateFrom);
      result = result.filter(c => new Date(c.createdAt) >= from);
    }
    if (regDateTo) {
      const to = new Date(regDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(c => new Date(c.createdAt) <= to);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortField) {
        case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case 'debt': aVal = a.currentDebtBalance; bVal = b.currentDebtBalance; break;
        case 'loyalty': aVal = a.loyaltyPoints; bVal = b.loyaltyPoints; break;
        case 'created': aVal = new Date(a.createdAt).getTime(); bVal = new Date(b.createdAt).getTime(); break;
        default: aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase();
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [rawCustomers, debtFilter, regDateFrom, regDateTo, sortField, sortDirection]);

  // Statistics
  const totalDebt = rawCustomers.reduce((s, c) => s + c.currentDebtBalance, 0);
  const activeDebts = debts.filter((d) => d.status !== 'SETTLED');
  const paymentAmountNum = parseFloat(debtPaymentAmount) || 0;
  const selectedDebt = activeDebts.find((d) => d.id === selectedDebtLedgerId);
  const currentDebtBalance = selectedDebt ? selectedDebt.amountOwed - selectedDebt.amountPaid : (selectedCustomer?.currentDebtBalance ?? 0);
  const newBalancePreview = Math.max(0, currentDebtBalance - paymentAmountNum);
  const goldCustomers = rawCustomers.filter(c => c.loyaltyPoints >= 1500).length;
  const customersWithDebt = rawCustomers.filter(c => c.currentDebtBalance > 0).length;
  const averageSpend = rawCustomers.length > 0 ? 0 : 0; // Would need total spend data
  const newCustomersThisMonth = rawCustomers.filter(c => {
    const created = new Date(c.createdAt);
    const now = new Date();
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  // Fuzzy search
  const fuzzyMatch = (query: string, text: string): boolean => {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return true;
    // Simple fuzzy: check if all characters appear in order
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  };

  // Duplicate detection
  const duplicateWarning = useMemo(() => {
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) return null;
    const existing = rawCustomers.find(c =>
      c.name.toLowerCase() === newCustomer.name.toLowerCase() ||
      (c.phone && c.phone.replace(/\D/g, '') === newCustomer.phone.replace(/\D/g, ''))
    );
    return existing ? `Possible duplicate: ${existing.name} (${existing.phone || 'no phone'})` : null;
  }, [newCustomer.name, newCustomer.phone, rawCustomers]);

  // Form validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!newCustomer.name.trim()) errors.name = 'Name is required';
    if (newCustomer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCustomer.email)) errors.email = 'Invalid email format';
    if (newCustomer.phone && newCustomer.phone.replace(/\D/g, '').length < 9) errors.phone = 'Phone number too short';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Debt aging breakdown
  const getDebtAgingBreakdown = () => {
    const now = new Date();
    const buckets = { current: 0, thirty: 0, sixty: 0, ninety: 0, overNinety: 0 };
    debts.forEach(d => {
      if (d.status === 'SETTLED') return;
      const dueDate = new Date(d.dueDate);
      const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const balance = d.amountOwed - d.amountPaid;
      if (diffDays <= 0) buckets.current += balance;
      else if (diffDays <= 30) buckets.thirty += balance;
      else if (diffDays <= 60) buckets.sixty += balance;
      else if (diffDays <= 90) buckets.ninety += balance;
      else buckets.overNinety += balance;
    });
    return buckets;
  };

  // Mini registration trend chart (last 6 months)
  const registrationTrend = useMemo(() => {
    const months: { label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const count = rawCustomers.filter(c => {
        const created = new Date(c.createdAt);
        return created.getMonth() === d.getMonth() && created.getFullYear() === d.getFullYear();
      }).length;
      months.push({
        label: d.toLocaleDateString('en-KE', { month: 'short' }),
        count,
      });
    }
    return months;
  }, [rawCustomers]);

  const maxRegCount = Math.max(...registrationTrend.map(m => m.count), 1);

  return (
    <div className="space-y-4">
      {/* Stats Cards with glass-morphism */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-primary hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-primary/20 to-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Customers</p>
                <p className="text-xl font-bold">{rawCustomers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-red-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-red-500/20 to-red-500/10">
                <CircleDollarSign className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                <p className="text-xl font-bold whitespace-nowrap">{formatKES(totalDebt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-amber-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">With Debt</p>
                <p className="text-xl font-bold">{customersWithDebt}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-green-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-green-500/20 to-green-500/10">
                <UserPlus className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">New This Month</p>
                <p className="text-xl font-bold">{newCustomersThisMonth}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Registration Trend Mini Chart */}
      {rawCustomers.length > 0 && (
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 backdrop-blur-sm shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Customer Registration Trend
              </h3>
              <span className="text-xs text-muted-foreground">Last 6 months</span>
            </div>
            <div className="flex items-end gap-2 h-16">
              {registrationTrend.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium text-muted-foreground">{m.count}</span>
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-primary/80 to-primary/40 transition-all hover:from-primary hover:to-primary/70"
                    style={{ height: `${(m.count / maxRegCount) * 100}%`, minHeight: m.count > 0 ? '4px' : '1px' }}
                  />
                  <span className="text-[9px] text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers... (fuzzy match)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>

        {/* Sort and Filter */}
        <Select value={debtFilter} onValueChange={setDebtFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Debt Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Customers</SelectItem>
            <SelectItem value="no_debt">No Debt</SelectItem>
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="overdue">High Risk</SelectItem>
          </SelectContent>
        </Select>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Advanced Filters</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Dialog open={addCustomerOpen} onOpenChange={(open) => { setAddCustomerOpen(open); if (!open) setFormErrors({}); }}>
          <DialogTrigger asChild>
            <Button className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-accent-orange" /> Add Customer
              </DialogTitle>
              <DialogDescription>Register a new customer</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Duplicate warning */}
              {duplicateWarning && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">{duplicateWarning}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Full Name <span className="text-red-500">*</span></Label>
                <Input
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  placeholder="John Kamau"
                  className={formErrors.name ? 'border-red-500' : ''}
                />
                {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: formatKenyanPhone(e.target.value) })}
                    placeholder="0712 345 678"
                    className={formErrors.phone ? 'border-red-500' : ''}
                  />
                  {formErrors.phone && <p className="text-xs text-red-500">{formErrors.phone}</p>}
                  <p className="text-[10px] text-muted-foreground">Auto-formats to Kenyan format</p>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    placeholder="john@email.com"
                    className={formErrors.email ? 'border-red-500' : ''}
                  />
                  {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ID Number</Label>
                  <Input value={newCustomer.idNumber} onChange={(e) => setNewCustomer({ ...newCustomer, idNumber: e.target.value })} placeholder="12345678" />
                </div>
                <div className="space-y-2">
                  <Label>Credit Limit (KES)</Label>
                  <Input type="number" value={newCustomer.debtLimit} onChange={(e) => setNewCustomer({ ...newCustomer, debtLimit: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="Nairobi, Kenya" rows={2} />
              </div>

              <div className="space-y-2">
                <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} placeholder="Additional notes about the customer..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddCustomerOpen(false); setFormErrors({}); }}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!validateForm()) return;
                  createCustomerMutation.mutate({ storeId: currentStoreId, ...newCustomer, debtLimit: Number(newCustomer.debtLimit) });
                }}
                disabled={createCustomerMutation.isPending || !newCustomer.name}
                className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              >
                {createCustomerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Customer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-3 backdrop-blur-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sort By</Label>
              <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="debt">Debt Balance</SelectItem>
                  <SelectItem value="loyalty">Loyalty Points</SelectItem>
                  <SelectItem value="created">Registration Date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Registered From</Label>
              <Input type="date" value={regDateFrom} onChange={(e) => setRegDateFrom(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Registered To</Label>
              <Input type="date" value={regDateTo} onChange={(e) => setRegDateTo(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
            >
              <ArrowUpDown className="mr-1.5 h-3 w-3" />
              {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            </Button>
            {(debtFilter !== 'all' || regDateFrom || regDateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setDebtFilter('all'); setRegDateFrom(''); setRegDateTo(''); }}
              >
                Reset Filters
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Customer Table */}
      <Card className="backdrop-blur-sm shadow-sm">
        <CardContent className="p-0">
          {/* Customer count summary */}
          <div className="px-4 py-2 border-b bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium">{customers.length}</span> of <span className="font-medium">{rawCustomers.length}</span> customers
              {searchQuery && <span> matching &quot;{searchQuery}&quot;</span>}
              {debtFilter !== 'all' && <span> · {debtFilter === 'no_debt' ? 'No Debt' : debtFilter === 'outstanding' ? 'Outstanding' : 'High Risk'}</span>}
            </p>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('name')}>
                        Customer {sortField === 'name' && (sortDirection === 'asc' ? <ArrowUpDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 rotate-180" />)}
                      </button>
                    </TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('debt')}>
                        Debt Balance {sortField === 'debt' && (sortDirection === 'asc' ? <ArrowUpDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 rotate-180" />)}
                      </button>
                    </TableHead>
                    <TableHead>Debt Status</TableHead>
                    <TableHead>
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('loyalty')}>
                        Loyalty {sortField === 'loyalty' && (sortDirection === 'asc' ? <ArrowUpDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 rotate-180" />)}
                      </button>
                    </TableHead>
                    <TableHead className="w-[60px]">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-16">
                        <div className="flex flex-col items-center gap-4">
                          <div className="p-6 rounded-full bg-gradient-to-br from-muted/50 to-muted/20 backdrop-blur-sm">
                            <Users className="h-12 w-12 text-muted-foreground/20" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">No customers found</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              {searchQuery || debtFilter !== 'all'
                                ? 'Try adjusting your search or filters'
                                : 'Add your first customer to get started'}
                            </p>
                          </div>
                          {(searchQuery || debtFilter !== 'all') ? (
                            <Button variant="outline" size="sm" className="text-xs" onClick={() => { setSearchQuery(''); setDebtFilter('all'); }}>
                              Clear Filters
                            </Button>
                          ) : (
                            <Button size="sm" className="text-xs bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground" onClick={() => setAddCustomerOpen(true)}>
                              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add First Customer
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : customers.map((customer, idx) => {
                    const debtStatus = getDebtStatus(customer.currentDebtBalance, customer.debtLimit);
                    const loyalty = getLoyaltyTier(customer.loyaltyPoints);
                    const gradient = getAvatarGradient(customer.name);
                    const initials = customer.name.split(' ').map(n => n[0]).join('').slice(0, 2);

                    return (
                      <TableRow
                        key={customer.id}
                        className={`${idx % 2 === 1 ? 'bg-muted/20' : ''} hover:bg-primary/5 transition-colors cursor-pointer group`}
                        onClick={() => setSelectedCustomer(customer)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 ring-2 ring-transparent group-hover:ring-primary/20 transition-all">
                              <AvatarFallback className={`text-xs text-white font-semibold bg-gradient-to-br ${gradient}`}>
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm group-hover:text-primary transition-colors">{customer.name}</p>
                              {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{customer.phone || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={customer.currentDebtBalance > 0 ? 'text-red-600' : 'text-green-600'}>
                            {formatKES(customer.currentDebtBalance)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <DebtStatusBadge customer={customer} />
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${loyalty.bg} ${loyalty.color}`}>
                            <span className="text-[10px]">{loyalty.icon}</span> {loyalty.tier}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye className="h-4 w-4" />
                          </Button>
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

      {/* Debt Payment Dialog */}
      <Dialog open={debtPaymentOpen} onOpenChange={(open) => {
        setDebtPaymentOpen(open);
        if (!open) {
          setDebtPaymentAmount('');
          setDebtPaymentMethod('CASH');
          setDebtPaymentReference('');
          setSelectedDebtLedgerId('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-accent-orange" />
              Record Debt Payment
            </DialogTitle>
            <DialogDescription>
              Record a payment for {selectedCustomer?.name}&apos;s outstanding debt
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Customer & Balance Info */}
            <div className="rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10 p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Customer</span>
                <span className="text-sm font-medium">{selectedCustomer?.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Balance</span>
                <span className="text-sm font-bold text-red-600">{formatKES(currentDebtBalance)}</span>
              </div>
              {selectedCustomer && selectedCustomer.debtLimit > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Credit Usage</span>
                    <span>{((selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100).toFixed(0)}%</span>
                  </div>
                  <Progress
                    value={Math.min(100, (selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100)}
                    className="h-1.5"
                  />
                </div>
              )}
            </div>

            {/* Debt Selection */}
            {activeDebts.length > 1 && (
              <div className="space-y-2">
                <Label>Select Debt Record</Label>
                <Select value={selectedDebtLedgerId} onValueChange={setSelectedDebtLedgerId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a debt record" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDebts.map((debt) => (
                      <SelectItem key={debt.id} value={debt.id}>
                        {formatKES(debt.amountOwed - debt.amountPaid)} owed — Due {formatDate(debt.dueDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Payment Amount */}
            <div className="space-y-2">
              <Label>Payment Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">KES</span>
                <Input
                  type="number"
                  value={debtPaymentAmount}
                  onChange={(e) => setDebtPaymentAmount(e.target.value)}
                  placeholder="0"
                  className="pl-12"
                  min="0"
                  max={currentDebtBalance}
                />
              </div>
              {/* Quick amount buttons */}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDebtPaymentAmount(String(currentDebtBalance))}>Full Amount</Button>
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDebtPaymentAmount(String(Math.round(currentDebtBalance / 2)))}>Half</Button>
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDebtPaymentAmount('5000')}>KES 5,000</Button>
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDebtPaymentAmount('10000')}>KES 10,000</Button>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={debtPaymentMethod} onValueChange={setDebtPaymentMethod}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH"><div className="flex items-center gap-2"><Banknote className="h-4 w-4" /> Cash</div></SelectItem>
                  <SelectItem value="MPESA"><div className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> M-Pesa</div></SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reference Number */}
            <div className="space-y-2">
              <Label>Reference Number <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={debtPaymentReference}
                onChange={(e) => setDebtPaymentReference(e.target.value)}
                placeholder={debtPaymentMethod === 'MPESA' ? 'M-Pesa transaction code' : 'Receipt number'}
              />
            </div>

            {/* New Balance Preview */}
            {paymentAmountNum > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Payment</span>
                  <span className="text-sm font-medium">{formatKES(paymentAmountNum)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Balance</span>
                  <span className={`text-sm font-bold ${newBalancePreview === 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatKES(newBalancePreview)}
                  </span>
                </div>
                {paymentAmountNum > currentDebtBalance && (
                  <p className="text-xs text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Amount exceeds balance — will be capped at {formatKES(currentDebtBalance)}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDebtPaymentOpen(false)}>Cancel</Button>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              disabled={debtPaymentMutation.isPending || paymentAmountNum <= 0 || !selectedDebtLedgerId}
              onClick={() => {
                if (!selectedDebtLedgerId || paymentAmountNum <= 0) return;
                debtPaymentMutation.mutate({
                  debtLedgerId: selectedDebtLedgerId,
                  amount: Math.min(paymentAmountNum, currentDebtBalance),
                  paymentMethod: debtPaymentMethod,
                  reference: debtPaymentReference || undefined,
                });
              }}
            >
              {debtPaymentMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</> : <><HandCoins className="mr-2 h-4 w-4" /> Record Payment</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Detail Sheet */}
      <Sheet open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedCustomer?.name}</SheetTitle>
            <SheetDescription>Customer details and history</SheetDescription>
          </SheetHeader>
          {selectedCustomer && (() => {
            const gradient = getAvatarGradient(selectedCustomer.name);
            const loyalty = getLoyaltyTier(selectedCustomer.loyaltyPoints);
            const debtStatus = getDebtStatus(selectedCustomer.currentDebtBalance, selectedCustomer.debtLimit);
            const hasOverdueDebt = debts.some(d => d.status === 'OVERDUE');
            const aging = getDebtAgingBreakdown();
            const totalAging = aging.current + aging.thirty + aging.sixty + aging.ninety + aging.overNinety;

            return (
              <div className="mt-6 space-y-6">
                {/* Customer Profile Header */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 ring-2 ring-primary/10">
                    <AvatarFallback className={`text-xl text-white font-bold bg-gradient-to-br ${gradient}`}>
                      {selectedCustomer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{selectedCustomer.name}</h3>
                    <div className="flex items-center flex-wrap gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${loyalty.bg} ${loyalty.color}`}>
                        {loyalty.icon} {loyalty.tier} Member
                      </span>
                      <DebtStatusBadge customer={selectedCustomer} />
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-3">
                  {selectedCustomer.phone && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{selectedCustomer.phone}</span>
                    </div>
                  )}
                  {selectedCustomer.email && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm truncate">{selectedCustomer.email}</span>
                    </div>
                  )}
                  {selectedCustomer.idNumber && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">ID: {selectedCustomer.idNumber}</span>
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{selectedCustomer.address}</span>
                    </div>
                  )}
                </div>

                {/* Debt Summary */}
                <div className="rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Debt Balance</span>
                    <span className="text-lg font-bold text-red-600">{formatKES(selectedCustomer.currentDebtBalance)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Credit Limit</span>
                    <span className="text-sm font-medium">{formatKES(selectedCustomer.debtLimit)}</span>
                  </div>
                  {selectedCustomer.debtLimit > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Credit Usage</span>
                        <span>{((selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100).toFixed(0)}%</span>
                      </div>
                      <Progress
                        value={Math.min(100, (selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100)}
                        className="h-2"
                      />
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Loyalty Points</span>
                    <span className="text-sm font-medium">{selectedCustomer.loyaltyPoints} pts</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Member Since</span>
                    <span className="text-sm font-medium">{formatDate(selectedCustomer.createdAt)}</span>
                  </div>
                </div>

                {/* Debt Aging Breakdown */}
                {totalAging > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Debt Aging Breakdown
                    </h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Current', amount: aging.current, color: 'bg-green-500' },
                        { label: '1-30 days', amount: aging.thirty, color: 'bg-yellow-500' },
                        { label: '31-60 days', amount: aging.sixty, color: 'bg-orange-500' },
                        { label: '61-90 days', amount: aging.ninety, color: 'bg-red-500' },
                        { label: '90+ days', amount: aging.overNinety, color: 'bg-red-800' },
                      ].map(bucket => (
                        <div key={bucket.label} className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${bucket.color} shrink-0`} />
                          <span className="text-xs text-muted-foreground w-20">{bucket.label}</span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full ${bucket.color} rounded-full`} style={{ width: `${totalAging > 0 ? (bucket.amount / totalAging * 100) : 0}%` }} />
                          </div>
                          <span className="text-xs font-medium w-20 text-right">{formatKES(bucket.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="space-y-2">
                  {selectedCustomer.currentDebtBalance > 0 && (
                    <Button
                      className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
                      onClick={() => {
                        const firstActiveDebt = activeDebts[0];
                        if (firstActiveDebt) setSelectedDebtLedgerId(firstActiveDebt.id);
                        setDebtPaymentOpen(true);
                      }}
                    >
                      <HandCoins className="mr-2 h-4 w-4" /> Record Payment
                    </Button>
                  )}
                  {hasOverdueDebt && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => toast.info(`SMS reminder would be sent to ${selectedCustomer.phone || 'N/A'}`)}
                    >
                      <Bell className="mr-2 h-4 w-4" /> Send Reminder
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setActiveTab('transactions');
                    }}
                  >
                    <ShoppingBag className="mr-2 h-4 w-4" /> View Transactions
                  </Button>
                </div>

                <Separator />

                {/* Transaction History */}
                <div>
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4" /> Recent Transactions
                  </h3>
                  {customerTransactions.length === 0 ? (
                    <div className="flex flex-col items-center py-6 gap-2">
                      <div className="p-3 rounded-full bg-muted/30">
                        <FileText className="h-6 w-6 text-muted-foreground/30" />
                      </div>
                      <p className="text-sm text-muted-foreground">No recent transactions</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[250px] overflow-y-auto">
                      {customerTransactions.map((txn) => (
                        <div key={txn.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">{txn.receiptNumber}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(txn.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${getPaymentMethodBadge(txn.paymentMethod)}`}>
                              {getPaymentMethodIcon(txn.paymentMethod)}
                              {txn.paymentMethod}
                            </span>
                            <span className="text-sm font-semibold">{formatKES(txn.totalAmount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Debt History */}
                <div>
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <CircleDollarSign className="h-4 w-4" /> Debt History
                  </h3>
                  {debts.length === 0 ? (
                    <div className="flex flex-col items-center py-6 gap-2">
                      <div className="p-3 rounded-full bg-muted/30">
                        <CircleDollarSign className="h-6 w-6 text-muted-foreground/30" />
                      </div>
                      <p className="text-sm text-muted-foreground">No debt records</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {debts.map((debt) => (
                        <Card key={debt.id} className="bg-muted/5">
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium">{formatKES(debt.amountOwed)}</p>
                                <p className="text-xs text-muted-foreground">Due: {formatDate(debt.dueDate)}</p>
                              </div>
                              <Badge
                                variant={debt.status === 'OVERDUE' ? 'destructive' : debt.status === 'SETTLED' ? 'secondary' : 'outline'}
                                className="text-[10px]"
                              >
                                {debt.status}
                              </Badge>
                            </div>
                            <Progress
                              value={debt.amountOwed > 0 ? (debt.amountPaid / debt.amountOwed) * 100 : 0}
                              className="mt-2 h-1.5"
                            />
                            <div className="flex justify-between mt-1">
                              <p className="text-xs text-muted-foreground">Paid: {formatKES(debt.amountPaid)}</p>
                              <p className="text-xs text-muted-foreground">of {formatKES(debt.amountOwed)}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
