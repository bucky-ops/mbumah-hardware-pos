'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyRound, AlertTriangle, DollarSign, Layers, Plus,
  CheckCircle, Loader2
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  rentalsApi, productsApi, customersApi,
  formatKES, formatDate,
  type ProductListItem, type CustomerItem, type RentalItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

function RentalForm({ storeId, products, customers, onSuccess }: { storeId: string; products: ProductListItem[]; customers: CustomerItem[]; onSuccess: () => void }) {
  const [form, setForm] = useState({ productId: '', customerId: '', expectedReturnDate: '', securityDeposit: '', ratePerDay: '', notes: '' });

  const createRentalMutation = useMutation({
    mutationFn: rentalsApi.create,
    onSuccess: () => { toast.success('Rental created'); onSuccess(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const rentalProducts = products.filter(p => p.isRental);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Equipment</Label>
        <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
          <SelectTrigger><SelectValue placeholder="Select equipment" /></SelectTrigger>
          <SelectContent>
            {rentalProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({formatKES(p.pricePerUnit)}/day)</SelectItem>)}
            {rentalProducts.length === 0 && <SelectItem value="none" disabled>No rental products available</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Customer</Label>
        <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
          <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
          <SelectContent>
            {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Expected Return</Label><Input type="date" value={form.expectedReturnDate} onChange={(e) => setForm({ ...form, expectedReturnDate: e.target.value })} /></div>
        <div className="space-y-2"><Label>Security Deposit (KES)</Label><Input type="number" value={form.securityDeposit} onChange={(e) => setForm({ ...form, securityDeposit: e.target.value })} placeholder="0" /></div>
      </div>
      <div className="space-y-2"><Label>Rate Per Day (KES)</Label><Input type="number" value={form.ratePerDay} onChange={(e) => setForm({ ...form, ratePerDay: e.target.value })} placeholder="0" /></div>
      <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any special instructions..." /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onSuccess}>Cancel</Button>
        <Button
          onClick={() => createRentalMutation.mutate({ storeId, ...form, securityDeposit: Number(form.securityDeposit), ratePerDay: Number(form.ratePerDay) })}
          disabled={createRentalMutation.isPending || !form.productId || !form.customerId}
          className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
        >
          {createRentalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Create Rental
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function RentalsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedRental, setSelectedRental] = useState<RentalItem | null>(null);
  const [newRentalOpen, setNewRentalOpen] = useState(false);
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  const { data: rentalsData, isLoading } = useQuery({
    queryKey: ['rentals', currentStoreId, statusFilter],
    queryFn: () => rentalsApi.list({ storeId: currentStoreId, status: statusFilter !== 'all' ? statusFilter : undefined, limit: 100 }),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', currentStoreId],
    queryFn: () => productsApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 100 }),
  });

  const returnRentalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { damageAssessment?: string; damageCharge?: number; notes?: string } }) => rentalsApi.returnRental(id, data),
    onSuccess: () => {
      toast.success('Rental returned successfully');
      setReturnDialogOpen(false);
      setSelectedRental(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rentals = rentalsData?.data || [];
  const activeRentals = rentals.filter(r => r.status === 'ACTIVE').length;
  const overdueRentals = rentals.filter(r => r.status === 'OVERDUE').length;
  const totalRentalRevenue = rentals.reduce((s, r) => s + r.totalRentalCharge, 0);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><KeyRound className="h-5 w-5 text-blue-600" /></div><div><p className="text-sm text-muted-foreground">Active</p><p className="text-xl font-bold">{activeRentals}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertTriangle className="h-5 w-5 text-red-600" /></div><div><p className="text-sm text-muted-foreground">Overdue</p><p className="text-xl font-bold">{overdueRentals}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30"><DollarSign className="h-5 w-5 text-green-600" /></div><div><p className="text-sm text-muted-foreground">Rental Revenue</p><p className="text-xl font-bold">{formatKES(totalRentalRevenue)}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30"><Layers className="h-5 w-5 text-purple-600" /></div><div><p className="text-sm text-muted-foreground">Total Rentals</p><p className="text-xl font-bold">{rentals.length}</p></div></div></CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="RETURNED">Returned</SelectItem>
            <SelectItem value="DAMAGED">Damaged</SelectItem>
          </SelectContent>
        </Select>
        <Button className="ml-auto bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground" onClick={() => setNewRentalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Rental
        </Button>
      </div>

      {/* Rentals Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Return By</TableHead>
                    <TableHead className="text-right">Rate/Day</TableHead>
                    <TableHead className="text-right">Total Charge</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rentals.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No rentals found</TableCell></TableRow>
                  ) : rentals.map((rental) => (
                    <TableRow key={rental.id}>
                      <TableCell className="font-medium text-sm">{rental.product?.name || rental.productId}</TableCell>
                      <TableCell className="text-sm">{rental.customer?.name || rental.customerId}</TableCell>
                      <TableCell>
                        <Badge variant={
                          rental.status === 'ACTIVE' ? 'default' :
                          rental.status === 'OVERDUE' ? 'destructive' :
                          rental.status === 'RETURNED' ? 'secondary' : 'outline'
                        } className="text-[10px]">
                          {rental.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(rental.rentalStartDate)}</TableCell>
                      <TableCell className="text-sm">{formatDate(rental.expectedReturnDate)}</TableCell>
                      <TableCell className="text-right text-sm">{formatKES(rental.ratePerDay)}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatKES(rental.totalRentalCharge)}</TableCell>
                      <TableCell className="text-right text-sm">{formatKES(rental.securityDeposit)}</TableCell>
                      <TableCell>
                        {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setSelectedRental(rental); setReturnDialogOpen(true); }}
                          >
                            Return
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Return Dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Return</DialogTitle>
            <DialogDescription>Return rental equipment and assess any damage</DialogDescription>
          </DialogHeader>
          {selectedRental && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm"><strong>Equipment:</strong> {selectedRental.product?.name || selectedRental.productId}</p>
                <p className="text-sm"><strong>Customer:</strong> {selectedRental.customer?.name || selectedRental.customerId}</p>
                <p className="text-sm"><strong>Days Rented:</strong> {Math.ceil((Date.now() - new Date(selectedRental.rentalStartDate).getTime()) / 86400000)}</p>
                <p className="text-sm"><strong>Total Charge:</strong> {formatKES(selectedRental.totalRentalCharge)}</p>
              </div>
              <div className="space-y-2">
                <Label>Damage Assessment</Label>
                <Select onValueChange={(v) => setSelectedRental({ ...selectedRental, damageAssessment: v })}>
                  <SelectTrigger><SelectValue placeholder="Select damage level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No Damage</SelectItem>
                    <SelectItem value="MINOR">Minor Damage</SelectItem>
                    <SelectItem value="MODERATE">Moderate Damage</SelectItem>
                    <SelectItem value="SEVERE">Severe Damage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedRental && returnRentalMutation.mutate({
                id: selectedRental.id,
                data: {
                  damageAssessment: selectedRental.damageAssessment || 'NONE',
                  damageCharge: selectedRental.damageCharge || 0,
                },
              })}
              disabled={returnRentalMutation.isPending}
            >
              {returnRentalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Confirm Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Rental Dialog */}
      <Dialog open={newRentalOpen} onOpenChange={setNewRentalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Equipment Rental</DialogTitle>
            <DialogDescription>Register a new equipment rental</DialogDescription>
          </DialogHeader>
          <RentalForm
            storeId={currentStoreId}
            products={productsData?.data || []}
            customers={customersData?.data || []}
            onSuccess={() => setNewRentalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
