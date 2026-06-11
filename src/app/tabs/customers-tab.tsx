'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users, Search, Plus, CircleDollarSign, AlertTriangle,
  Eye, Loader2
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  customersApi, debtApi,
  formatKES, formatDate,
  type CustomerItem,
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';

export default function CustomersTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '', idNumber: '', debtLimit: '50000' });
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers', currentStoreId, searchQuery],
    queryFn: () => customersApi.list({ storeId: currentStoreId, search: searchQuery || undefined, limit: 200 }),
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt', currentStoreId, selectedCustomer?.id],
    queryFn: () => debtApi.list({ storeId: currentStoreId, customerId: selectedCustomer?.id, limit: 50 }),
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

  const customers = customersData?.data || [];
  const debts = debtData?.data || [];
  const totalDebt = customers.reduce((s, c) => s + c.currentDebtBalance, 0);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Users className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Customers</p>
                <p className="text-xl font-bold">{customers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><CircleDollarSign className="h-5 w-5 text-red-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                <p className="text-xl font-bold">{formatKES(totalDebt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30"><AlertTriangle className="h-5 w-5 text-yellow-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">With Debt</p>
                <p className="text-xl font-bold">{customers.filter(c => c.currentDebtBalance > 0).length}</p>
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
                    <TableHead>ID Number</TableHead>
                    <TableHead className="text-right">Debt Balance</TableHead>
                    <TableHead className="text-right">Debt Limit</TableHead>
                    <TableHead>Loyalty</TableHead>
                    <TableHead className="w-[60px]">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No customers found</TableCell></TableRow>
                  ) : customers.map((customer) => (
                    <TableRow key={customer.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCustomer(customer)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{customer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback></Avatar>
                          <div><p className="font-medium text-sm">{customer.name}</p>{customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{customer.phone || '—'}</TableCell>
                      <TableCell className="text-sm">{customer.idNumber || '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={customer.currentDebtBalance > 0 ? 'text-red-600' : ''}>{formatKES(customer.currentDebtBalance)}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{formatKES(customer.debtLimit)}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{customer.loyaltyPoints} pts</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Detail Sheet */}
      <Sheet open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedCustomer?.name}</SheetTitle>
            <SheetDescription>Customer details and debt history</SheetDescription>
          </SheetHeader>
          {selectedCustomer && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{selectedCustomer.phone || 'N/A'}</p></div>
                <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{selectedCustomer.email || 'N/A'}</p></div>
                <div><p className="text-xs text-muted-foreground">ID Number</p><p className="text-sm font-medium">{selectedCustomer.idNumber || 'N/A'}</p></div>
                <div><p className="text-xs text-muted-foreground">Address</p><p className="text-sm font-medium">{selectedCustomer.address || 'N/A'}</p></div>
                <div><p className="text-xs text-muted-foreground">Debt Balance</p><p className="text-sm font-bold text-red-600">{formatKES(selectedCustomer.currentDebtBalance)}</p></div>
                <div><p className="text-xs text-muted-foreground">Debt Limit</p><p className="text-sm font-medium">{formatKES(selectedCustomer.debtLimit)}</p></div>
                <div><p className="text-xs text-muted-foreground">Loyalty Points</p><p className="text-sm font-medium">{selectedCustomer.loyaltyPoints}</p></div>
                <div><p className="text-xs text-muted-foreground">Joined</p><p className="text-sm font-medium">{formatDate(selectedCustomer.createdAt)}</p></div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold text-sm mb-3">Debt History</h3>
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
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
