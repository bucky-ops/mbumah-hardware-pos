'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyRound, AlertTriangle, DollarSign, Layers, Plus,
  CheckCircle, Loader2, Clock, ArrowRight, Wrench,
  ShieldAlert, ShieldCheck, ShieldOff,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  rentalsApi, productsApi, customersApi,
  formatKES, formatDate,
  type ProductListItem, type CustomerItem, type RentalItem,
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

// ============================================================================
// Rental Timeline Visual Component
// ============================================================================

function RentalTimeline({ rental }: { rental: RentalItem }) {
  const start = new Date(rental.rentalStartDate).getTime();
  const expected = new Date(rental.expectedReturnDate).getTime();
  const now = Date.now();
  const actual = rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : null;
  const isOverdue = rental.status === 'OVERDUE' || (!actual && now > expected);
  const isReturned = rental.status === 'RETURNED' || rental.status === 'DAMAGED';

  // Calculate total span for proportioning
  const totalSpan = Math.max(expected - start, 86400000); // at least 1 day
  const rentedSpan = isReturned ? Math.max((actual || expected) - start, 0) : Math.min(now - start, totalSpan * 1.5);

  const rentedPct = Math.min((rentedSpan / totalSpan) * 100, 100);
  const expectedPct = 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{formatDate(rental.rentalStartDate)}</span>
        <ArrowRight className="h-3 w-3" />
        <span>{formatDate(rental.expectedReturnDate)}</span>
        {actual && (
          <>
            <ArrowRight className="h-3 w-3" />
            <span className={isOverdue ? 'text-red-500 font-medium' : 'text-green-600'}>
              {formatDate(rental.actualReturnDate)}
            </span>
          </>
        )}
      </div>
      <div className="relative h-3 bg-muted/30 rounded-full overflow-hidden">
        {/* Expected period bar */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-blue-200 dark:bg-blue-800/40"
          style={{ width: `${expectedPct}%` }}
        />
        {/* Actual rented period */}
        <div
          className={`absolute top-0 left-0 h-full rounded-full ${
            isOverdue ? 'bg-red-400 dark:bg-red-600/60' :
            isReturned ? 'bg-green-400 dark:bg-green-600/60' :
            'bg-primary/60'
          }`}
          style={{ width: `${rentedPct}%` }}
        />
        {/* Expected return marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-blue-600 dark:bg-blue-400 z-10"
          style={{ left: `${expectedPct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Rental Form Component
// ============================================================================

function RentalForm({ storeId, products, customers, onSuccess }: { storeId: string; products: ProductListItem[]; customers: CustomerItem[]; onSuccess: () => void }) {
  const [form, setForm] = useState({ productId: '', customerId: '', expectedReturnDate: '', securityDeposit: '', ratePerDay: '', notes: '' });

  const createRentalMutation = useMutation({
    mutationFn: rentalsApi.create,
    onSuccess: () => { toast.success('Rental created'); onSuccess(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const rentalProducts = products.filter(p => p.isRental);

  // Auto-fill rate when product is selected
  const selectedProduct = rentalProducts.find(p => p.id === form.productId);
  const effectiveRate = form.ratePerDay ? Number(form.ratePerDay) : (selectedProduct?.pricePerUnit || 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Equipment</Label>
        <Select value={form.productId} onValueChange={(v) => {
          const prod = rentalProducts.find(p => p.id === v);
          setForm({ ...form, productId: v, ratePerDay: prod ? String(prod.pricePerUnit) : form.ratePerDay });
        }}>
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

      {/* Estimated Cost Preview */}
      {form.expectedReturnDate && effectiveRate > 0 && (
        <div className="p-3 bg-muted rounded-lg text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estimated rental days:</span>
            <span className="font-medium">
              {Math.max(Math.ceil((new Date(form.expectedReturnDate).getTime() - Date.now()) / 86400000), 1)}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-muted-foreground">Estimated total:</span>
            <span className="font-bold text-primary">
              {formatKES(effectiveRate * Math.max(Math.ceil((new Date(form.expectedReturnDate).getTime() - Date.now()) / 86400000), 1))}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any special instructions..." /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onSuccess}>Cancel</Button>
        <Button
          onClick={() => createRentalMutation.mutate({ storeId, ...form, securityDeposit: Number(form.securityDeposit), ratePerDay: Number(form.ratePerDay) })}
          disabled={createRentalMutation.isPending || !form.productId || !form.customerId || !form.expectedReturnDate}
          className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
        >
          {createRentalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Create Rental
        </Button>
      </DialogFooter>
    </div>
  );
}

// ============================================================================
// Damage Assessment Form Component
// ============================================================================

function DamageAssessmentForm({
  rental,
  onSubmit,
  isPending,
}: {
  rental: RentalItem;
  onSubmit: (data: { damageAssessment: string; damageCharge: number; notes: string }) => void;
  isPending: boolean;
}) {
  const [damageLevel, setDamageLevel] = useState('NONE');
  const [damageCharge, setDamageCharge] = useState('0');
  const [returnNotes, setReturnNotes] = useState('');
  const depositAmount = rental.securityDeposit;

  const damageIcons: Record<string, React.ReactNode> = {
    NONE: <ShieldCheck className="h-5 w-5 text-green-600" />,
    MINOR: <ShieldOff className="h-5 w-5 text-yellow-600" />,
    MODERATE: <ShieldAlert className="h-5 w-5 text-orange-600" />,
    SEVERE: <AlertTriangle className="h-5 w-5 text-red-600" />,
  };

  const damageColors: Record<string, string> = {
    NONE: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30',
    MINOR: 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30',
    MODERATE: 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30',
    SEVERE: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30',
  };

  const daysRented = Math.ceil((Date.now() - new Date(rental.rentalStartDate).getTime()) / 86400000);
  const isLate = new Date() > new Date(rental.expectedReturnDate);
  const lateDays = isLate ? Math.ceil((Date.now() - new Date(rental.expectedReturnDate).getTime()) / 86400000) : 0;
  const lateFee = rental.lateFeeAccumulated;
  const totalCharge = rental.totalRentalCharge + lateFee + Number(damageCharge);
  const refundAmount = depositAmount - Number(damageCharge) - lateFee;

  return (
    <div className="space-y-4">
      {/* Rental Info Summary */}
      <div className="p-3 bg-muted rounded-lg space-y-1">
        <p className="text-sm"><strong>Equipment:</strong> {rental.product?.name || rental.productId}</p>
        <p className="text-sm"><strong>Customer:</strong> {rental.customer?.name || rental.customerId}</p>
        <p className="text-sm"><strong>Days Rented:</strong> {daysRented} day{daysRented !== 1 ? 's' : ''}</p>
        <p className="text-sm"><strong>Rental Charge:</strong> {formatKES(rental.totalRentalCharge)}</p>
        {isLate && (
          <p className="text-sm text-red-600 font-medium">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            {lateDays} day{lateDays !== 1 ? 's' : ''} late — Late fee: {formatKES(lateFee)}
          </p>
        )}
        <Separator className="my-2" />
        <p className="text-sm"><strong>Security Deposit:</strong> {formatKES(depositAmount)}</p>
      </div>

      {/* Damage Level Selection with Visual Cards */}
      <div className="space-y-2">
        <Label>Damage Assessment</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['NONE', 'MINOR', 'MODERATE', 'SEVERE'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                setDamageLevel(level);
                if (level === 'NONE') setDamageCharge('0');
              }}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left ${
                damageLevel === level
                  ? damageColors[level]
                  : 'border-transparent bg-muted/30 hover:bg-muted/50'
              }`}
            >
              {damageIcons[level]}
              <div>
                <p className="text-sm font-medium">{level === 'NONE' ? 'No Damage' : level.charAt(0) + level.slice(1).toLowerCase()}</p>
                <p className="text-[10px] text-muted-foreground">
                  {level === 'NONE' ? 'Item returned in good condition' :
                   level === 'MINOR' ? 'Small scratches, minor wear' :
                   level === 'MODERATE' ? 'Functional damage, repairable' :
                   'Major damage, may need replacement'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Damage Charge Input */}
      {damageLevel !== 'NONE' && (
        <div className="space-y-2">
          <Label>Damage Charge (KES)</Label>
          <Input
            type="number"
            value={damageCharge}
            onChange={(e) => setDamageCharge(e.target.value)}
            placeholder="0"
            min="0"
            max={String(depositAmount)}
          />
          <p className="text-xs text-muted-foreground">
            Charge will be deducted from the security deposit of {formatKES(depositAmount)}
          </p>
        </div>
      )}

      {/* Return Notes */}
      <div className="space-y-2">
        <Label>Return Notes</Label>
        <Textarea
          value={returnNotes}
          onChange={(e) => setReturnNotes(e.target.value)}
          placeholder="Any observations about the equipment condition..."
        />
      </div>

      {/* Financial Summary */}
      <div className="p-3 border rounded-lg space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Return Summary</p>
        <div className="flex justify-between text-sm">
          <span>Rental Charge</span>
          <span>{formatKES(rental.totalRentalCharge)}</span>
        </div>
        {lateFee > 0 && (
          <div className="flex justify-between text-sm text-red-600">
            <span>Late Fee</span>
            <span>{formatKES(lateFee)}</span>
          </div>
        )}
        {Number(damageCharge) > 0 && (
          <div className="flex justify-between text-sm text-orange-600">
            <span>Damage Charge</span>
            <span>{formatKES(Number(damageCharge))}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between text-sm font-bold">
          <span>Total Charge</span>
          <span>{formatKES(totalCharge)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Less: Security Deposit</span>
          <span className="text-green-600">-{formatKES(depositAmount)}</span>
        </div>
        <Separator />
        <div className={`flex justify-between text-sm font-bold ${refundAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <span>{refundAmount >= 0 ? 'Refund to Customer' : 'Customer Owes'}</span>
          <span>{formatKES(Math.abs(refundAmount))}</span>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({ damageAssessment: damageLevel, damageCharge: Number(damageCharge), notes: returnNotes })}
          disabled={isPending}
          className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
        >
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          Confirm Return
        </Button>
      </DialogFooter>
    </div>
  );
}

// ============================================================================
// Main Rentals Tab Component
// ============================================================================

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

  // Status counts
  const statusCounts = useMemo(() => ({
    active: rentals.filter(r => r.status === 'ACTIVE').length,
    overdue: rentals.filter(r => r.status === 'OVERDUE').length,
    returned: rentals.filter(r => r.status === 'RETURNED').length,
    damaged: rentals.filter(r => r.status === 'DAMAGED').length,
    total: rentals.length,
  }), [rentals]);

  // Revenue summary
  const revenueSummary = useMemo(() => {
    const totalRevenue = rentals.reduce((s, r) => s + r.totalRentalCharge, 0);
    const totalDeposits = rentals.reduce((s, r) => s + r.securityDeposit, 0);
    const totalLateFees = rentals.reduce((s, r) => s + r.lateFeeAccumulated, 0);
    const totalDamageCharges = rentals.reduce((s, r) => s + r.damageCharge, 0);
    return { totalRevenue, totalDeposits, totalLateFees, totalDamageCharges };
  }, [rentals]);

  return (
    <div className="space-y-4">
      {/* Active Rentals Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active Rentals Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <KeyRound className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="text-lg font-bold text-blue-600">{statusCounts.active}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className="text-lg font-bold text-red-600">{statusCounts.overdue}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-xs text-muted-foreground">Returned</p>
                <p className="text-lg font-bold text-green-600">{statusCounts.returned}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <Wrench className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-xs text-muted-foreground">Damaged</p>
                <p className="text-lg font-bold text-orange-600">{statusCounts.damaged}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold">{statusCounts.total}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <KeyRound className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-xl font-bold">{statusCounts.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-xl font-bold">{statusCounts.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Rental Revenue</p>
                <p className="text-xl font-bold">{formatKES(revenueSummary.totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Layers className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Rentals</p>
                <p className="text-xl font-bold">{rentals.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rental Revenue Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rental Revenue Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Rental Charges</p>
              <p className="text-lg font-bold text-emerald-600">{formatKES(revenueSummary.totalRevenue)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Security Deposits</p>
              <p className="text-lg font-bold text-blue-600">{formatKES(revenueSummary.totalDeposits)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Late Fees Collected</p>
              <p className="text-lg font-bold text-orange-600">{formatKES(revenueSummary.totalLateFees)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Damage Charges</p>
              <p className="text-lg font-bold text-red-600">{formatKES(revenueSummary.totalDamageCharges)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    <TableHead>Timeline</TableHead>
                    <TableHead className="text-right">Rate/Day</TableHead>
                    <TableHead className="text-right">Total Charge</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rentals.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No rentals found</TableCell></TableRow>
                  ) : rentals.map((rental) => {
                    const isOverdue = rental.status === 'OVERDUE';
                    return (
                      <TableRow
                        key={rental.id}
                        className={isOverdue ? 'bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30' : ''}
                      >
                        <TableCell className="font-medium text-sm">
                          <div className="flex items-center gap-2">
                            {isOverdue && <AlertTriangle className="h-3 w-3 text-red-500" />}
                            {rental.product?.name || rental.productId}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{rental.customer?.name || rental.customerId}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rental.status === 'ACTIVE' ? 'default' :
                              rental.status === 'OVERDUE' ? 'destructive' :
                              rental.status === 'RETURNED' ? 'secondary' : 'outline'
                            }
                            className="text-[10px]"
                          >
                            {rental.status}
                          </Badge>
                          {isOverdue && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              {Math.ceil((Date.now() - new Date(rental.expectedReturnDate).getTime()) / 86400000)}d overdue
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="w-[200px]">
                          <RentalTimeline rental={rental} />
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatKES(rental.ratePerDay)}</TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatKES(rental.totalRentalCharge)}</TableCell>
                        <TableCell className="text-right text-sm">{formatKES(rental.securityDeposit)}</TableCell>
                        <TableCell>
                          {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                            <Button
                              variant={isOverdue ? 'destructive' : 'outline'}
                              size="sm"
                              onClick={() => { setSelectedRental(rental); setReturnDialogOpen(true); }}
                            >
                              Return
                            </Button>
                          )}
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

      {/* Return Dialog with Damage Assessment */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Process Return</DialogTitle>
            <DialogDescription>Return rental equipment and assess any damage</DialogDescription>
          </DialogHeader>
          {selectedRental && (
            <DamageAssessmentForm
              rental={selectedRental}
              onSubmit={(data) => returnRentalMutation.mutate({ id: selectedRental.id, data })}
              isPending={returnRentalMutation.isPending}
            />
          )}
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
