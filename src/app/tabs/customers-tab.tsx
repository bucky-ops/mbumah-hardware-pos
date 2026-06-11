'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users, Search, Plus, CircleDollarSign, AlertTriangle,
  Eye, Loader2, HandCoins, Banknote, Smartphone,
  MessageSquare, ShoppingBag, Award, Phone, Mail, MapPin, CreditCard, Clock
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  customersApi, debtApi, transactionsApi,
  formatKES, formatDate, formatDateTime,
  type CustomerItem,
  type TransactionItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

// Avatar gradient colors based on name
const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-blue-500 to-indigo-600',
  'from-cyan-500 to-teal-600',
  'from-emerald-500 to-green-600',
  'from-amber-500 to-orange-600',
  'from-red-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-amber-600',
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

function getDebtStatus(debtBalance: number, debtLimit: number): { color: string; label: string } {
  if (debtBalance <= 0) return { color: 'bg-green-500', label: 'No Debt' };
  if (debtLimit > 0 && (debtBalance / debtLimit) > 0.5) return { color: 'bg-red-500', label: 'High Risk' };
  return { color: 'bg-amber-500', label: 'Has Debt' };
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

export default function CustomersTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '', idNumber: '', debtLimit: '50000' });
  const [debtPaymentOpen, setDebtPaymentOpen] = useState(false);
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('');
  const [debtPaymentMethod, setDebtPaymentMethod] = useState('CASH');
  const [debtPaymentReference, setDebtPaymentReference] = useState('');
  const [selectedDebtLedgerId, setSelectedDebtLedgerId] = useState<string>('');
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const queryClient = useQueryClient();

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
    queryFn: () => transactionsApi.list({ storeId: currentStoreId, limit: 5 }),
    enabled: !!selectedCustomer,
  });

  const createCustomerMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      toast.success('Customer added');
      setAddCustomerOpen(false);
      setNewCustomer({ name: '', phone: '', email: '', address: '', idNumber: '', debtLimit: '50000' });
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

  const customers = customersData?.data || [];
  const debts = debtData?.data || [];
  const customerTransactions: TransactionItem[] = (customerTransactionsData?.data || []).slice(0, 5);
  const totalDebt = customers.reduce((s, c) => s + c.currentDebtBalance, 0);
  const activeDebts = debts.filter((d) => d.status !== 'SETTLED');
  const paymentAmountNum = parseFloat(debtPaymentAmount) || 0;
  const selectedDebt = activeDebts.find((d) => d.id === selectedDebtLedgerId);
  const currentDebtBalance = selectedDebt ? selectedDebt.amountOwed - selectedDebt.amountPaid : (selectedCustomer?.currentDebtBalance ?? 0);
  const newBalancePreview = Math.max(0, currentDebtBalance - paymentAmountNum);
  const goldCustomers = customers.filter(c => c.loyaltyPoints >= 1500).length;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-card to-muted/20 border-l-4 border-l-primary hover:-translate-y-0.5 transition-transform cursor-default">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-primary/20 to-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Customers</p>
                <p className="text-xl font-bold">{customers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-muted/20 border-l-4 border-l-red-500 hover:-translate-y-0.5 transition-transform cursor-default">
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
        <Card className="bg-gradient-to-br from-card to-muted/20 border-l-4 border-l-amber-500 hover:-translate-y-0.5 transition-transform cursor-default">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">With Debt</p>
                <p className="text-xl font-bold">{customers.filter(c => c.currentDebtBalance > 0).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-muted/20 border-l-4 border-l-yellow-500 hover:-translate-y-0.5 transition-transform cursor-default">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-yellow-500/20 to-yellow-500/10">
                <Award className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gold Members</p>
                <p className="text-xl font-bold">{goldCustomers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
        <Dialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Customer</DialogTitle>
              <DialogDescription>Register a new customer</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="John Kamau" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Phone</Label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="0712 345 678" /></div>
                <div className="space-y-2"><Label>Email</Label><Input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} placeholder="john@email.com" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>ID Number</Label><Input value={newCustomer.idNumber} onChange={(e) => setNewCustomer({ ...newCustomer, idNumber: e.target.value })} placeholder="12345678" /></div>
                <div className="space-y-2"><Label>Debt Limit (KES)</Label><Input type="number" value={newCustomer.debtLimit} onChange={(e) => setNewCustomer({ ...newCustomer, debtLimit: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Address</Label><Textarea value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="Nairobi, Kenya" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddCustomerOpen(false)}>Cancel</Button>
              <Button onClick={() => createCustomerMutation.mutate({ storeId: currentStoreId, ...newCustomer, debtLimit: Number(newCustomer.debtLimit) })} disabled={createCustomerMutation.isPending || !newCustomer.name} className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
                {createCustomerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Customer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Customer Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Debt Balance</TableHead>
                    <TableHead>Debt Status</TableHead>
                    <TableHead>Loyalty Tier</TableHead>
                    <TableHead className="w-[60px]">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No customers found</TableCell></TableRow>
                  ) : customers.map((customer, idx) => {
                    const debtStatus = getDebtStatus(customer.currentDebtBalance, customer.debtLimit);
                    const loyalty = getLoyaltyTier(customer.loyaltyPoints);
                    const gradient = getAvatarGradient(customer.name);
                    const initials = customer.name.split(' ').map(n => n[0]).join('').slice(0, 2);

                    return (
                      <TableRow
                        key={customer.id}
                        className={`${idx % 2 === 1 ? 'bg-muted/30' : ''} hover:bg-primary/5 transition-colors cursor-pointer`}
                        onClick={() => setSelectedCustomer(customer)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className={`text-xs text-white font-semibold bg-gradient-to-br ${gradient}`}>
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{customer.name}</p>
                              {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{customer.phone || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={customer.currentDebtBalance > 0 ? 'text-red-600' : ''}>{formatKES(customer.currentDebtBalance)}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${debtStatus.color}`} />
                            <span className="text-xs text-muted-foreground">{debtStatus.label}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${loyalty.bg} ${loyalty.color}`}>
                            <span className="text-[10px]">{loyalty.icon}</span> {loyalty.tier}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button>
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
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Customer</span>
                <span className="text-sm font-medium">{selectedCustomer?.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Balance</span>
                <span className="text-sm font-bold text-red-600">{formatKES(currentDebtBalance)}</span>
              </div>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setDebtPaymentAmount(String(currentDebtBalance))}
                >
                  Full Amount
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setDebtPaymentAmount(String(Math.round(currentDebtBalance / 2)))}
                >
                  Half
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setDebtPaymentAmount('5000')}
                >
                  KES 5,000
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setDebtPaymentAmount('10000')}
                >
                  KES 10,000
                </Button>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={debtPaymentMethod} onValueChange={setDebtPaymentMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">
                    <div className="flex items-center gap-2">
                      <Banknote className="h-4 w-4" /> Cash
                    </div>
                  </SelectItem>
                  <SelectItem value="MPESA">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" /> M-Pesa
                    </div>
                  </SelectItem>
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
            <Button
              variant="outline"
              onClick={() => setDebtPaymentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              disabled={
                debtPaymentMutation.isPending ||
                paymentAmountNum <= 0 ||
                !selectedDebtLedgerId
              }
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
              {debtPaymentMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
              ) : (
                <><HandCoins className="mr-2 h-4 w-4" /> Record Payment</>
              )}
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

            return (
              <div className="mt-6 space-y-6">
                {/* Customer Profile Header */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className={`text-lg text-white font-bold bg-gradient-to-br ${gradient}`}>
                      {selectedCustomer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{selectedCustomer.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${loyalty.bg} ${loyalty.color}`}>
                        {loyalty.icon} {loyalty.tier} Member
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${debtStatus.color}`} />
                        <span className="text-xs text-muted-foreground">{debtStatus.label}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-3">
                  {selectedCustomer.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{selectedCustomer.phone}</span>
                    </div>
                  )}
                  {selectedCustomer.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm truncate">{selectedCustomer.email}</span>
                    </div>
                  )}
                  {selectedCustomer.idNumber && (
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">ID: {selectedCustomer.idNumber}</span>
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{selectedCustomer.address}</span>
                    </div>
                  )}
                </div>

                {/* Debt Summary */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Debt Balance</span>
                    <span className="text-lg font-bold text-red-600">{formatKES(selectedCustomer.currentDebtBalance)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Debt Limit</span>
                    <span className="text-sm font-medium">{formatKES(selectedCustomer.debtLimit)}</span>
                  </div>
                  {selectedCustomer.debtLimit > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Usage</span>
                        <span>{((selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100).toFixed(0)}%</span>
                      </div>
                      <Progress
                        value={Math.min(100, (selectedCustomer.currentDebtBalance / selectedCustomer.debtLimit) * 100)}
                        className="h-2"
                      />
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Loyalty Points</span>
                    <span className="text-sm font-medium">{selectedCustomer.loyaltyPoints} pts</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Member Since</span>
                    <span className="text-sm font-medium">{formatDate(selectedCustomer.createdAt)}</span>
                  </div>
                </div>

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
                      <MessageSquare className="mr-2 h-4 w-4" /> Send SMS Reminder
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
                    <Clock className="h-4 w-4" /> Recent Transactions
                  </h3>
                  {customerTransactions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent transactions</p>
                  ) : (
                    <div className="space-y-2">
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
                    <p className="text-sm text-muted-foreground">No debt records</p>
                  ) : (
                    <div className="space-y-3">
                      {debts.map((debt) => (
                        <Card key={debt.id}>
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium">{formatKES(debt.amountOwed)}</p>
                                <p className="text-xs text-muted-foreground">Due: {formatDate(debt.dueDate)}</p>
                              </div>
                              <Badge variant={debt.status === 'OVERDUE' ? 'destructive' : debt.status === 'SETTLED' ? 'secondary' : 'outline'} className="text-[10px]">
                                {debt.status}
                              </Badge>
                            </div>
                            <Progress value={(debt.amountPaid / debt.amountOwed) * 100} className="mt-2 h-1.5" />
                            <p className="text-xs text-muted-foreground mt-1">Paid: {formatKES(debt.amountPaid)} / {formatKES(debt.amountOwed)}</p>
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
