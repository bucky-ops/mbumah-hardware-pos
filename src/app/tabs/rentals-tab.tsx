'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyRound, AlertTriangle, DollarSign, Layers, Plus,
  CheckCircle, Loader2, Clock, ArrowRight, Wrench,
  ShieldAlert, ShieldCheck, ShieldOff, CalendarDays,
  TrendingUp, Activity,
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
// Rental Timeline Visual Component - Enhanced with Dots and Lines
// ============================================================================

function RentalTimeline({ rental }: { rental: RentalItem }) {
  const start = new Date(rental.rentalStartDate).getTime();
  const expected = new Date(rental.expectedReturnDate).getTime();
  const now = Date.now();
  const actual = rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : null;
  const isOverdue = rental.status === 'OVERDUE' || (!actual && now > expected);
  const isReturned = rental.status === 'RETURNED' || rental.status === 'DAMAGED';
  const isActive = rental.status === 'ACTIVE' && !isOverdue;

  // Calculate days remaining or overdue
  const daysRemaining = !isReturned && !isOverdue
    ? Math.max(Math.ceil((expected - now) / 86400000), 0)
    : 0;
  const daysOverdue = isOverdue
    ? Math.ceil((now - expected) / 86400000)
    : 0;

  // Color logic: green if on track, amber if close (<=3 days), red if overdue
  const isCloseToDue = !isOverdue && !isReturned && daysRemaining <= 3 && daysRemaining > 0;
  const statusColor = isOverdue ? 'red' : isCloseToDue ? 'amber' : isActive ? 'green' : isReturned ? 'gray' : 'green';

  const dotColors: Record<string, string> = {
    green: 'bg-green-500 shadow-green-500/50',
    amber: 'bg-amber-500 shadow-amber-500/50',
    red: 'bg-red-500 shadow-red-500/50',
    gray: 'bg-gray-400 shadow-gray-400/50',
  };

  const lineColors: Record<string, string> = {
    green: 'bg-green-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
    gray: 'bg-gray-300',
  };

  return (
    <div className="space-y-1.5">
      {/* Visual Timeline with Dots and Lines */}
      <div className="flex items-center gap-0 w-full">
        {/* Start dot */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50`} />
          <span className="text-[8px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatDate(rental.rentalStartDate).slice(0, 6)}</span>
        </div>
        {/* Progress line */}
        <div className="flex-1 h-0.5 mx-1 relative">
          <div className={`absolute inset-0 ${isReturned ? lineColors.gray : lineColors[statusColor]}`} style={{ opacity: 0.4 }} />
          <div
            className={`absolute top-0 left-0 h-full ${isReturned ? lineColors.gray : lineColors[statusColor]}`}
            style={{ width: isReturned ? '100%' : `${Math.min(((now - start) / (expected - start)) * 100, 100)}%` }}
          />
        </div>
        {/* Expected return dot */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${dotColors[statusColor]} shadow-sm`} />
          <span className="text-[8px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatDate(rental.expectedReturnDate).slice(0, 6)}</span>
        </div>
        {/* Actual return line & dot */}
        {actual && (
          <>
            <div className={`flex-1 h-0.5 mx-1 ${isOverdue ? lineColors.red : lineColors.green}`} style={{ opacity: 0.4 }} />
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${isOverdue ? dotColors.red : dotColors.green} shadow-sm`} />
              <span className="text-[8px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatDate(rental.actualReturnDate!).slice(0, 6)}</span>
            </div>
          </>
        )}
      </div>
      {/* Status indicator */}
      <div className="text-center">
        {isOverdue && (
          <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
            {daysOverdue}d overdue
          </span>
        )}
        {isCloseToDue && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
            {daysRemaining}d remaining
          </span>
        )}
        {isActive && daysRemaining > 3 && (
          <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
            {daysRemaining}d remaining
          </span>
        )}
        {isReturned && (
          <span className="text-[10px] font-medium text-muted-foreground">
            Returned
          </span>
        )}
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
// Damage Assessment Form Component - Enhanced with Visual Summary
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

  const damageSelectedRing: Record<string, string> = {
    NONE: 'ring-2 ring-green-500',
    MINOR: 'ring-2 ring-yellow-500',
    MODERATE: 'ring-2 ring-orange-500',
    SEVERE: 'ring-2 ring-red-500',
  };

  const daysRented = Math.ceil((Date.now() - new Date(rental.rentalStartDate).getTime()) / 86400000);
  const isLate = new Date() > new Date(rental.expectedReturnDate);
  const lateDays = isLate ? Math.ceil((Date.now() - new Date(rental.expectedReturnDate).getTime()) / 86400000) : 0;
  const lateFee = rental.lateFeeAccumulated;
  const totalCharge = rental.totalRentalCharge + lateFee + Number(damageCharge);
  const refundAmount = depositAmount - Number(damageCharge) - lateFee;

  return (
    <div className="space-y-4">
      {/* Rental Info Summary - Enhanced */}
      <div className="p-3 bg-gradient-to-r from-muted to-muted/50 rounded-lg space-y-2 border">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Equipment</p>
            <p className="text-sm font-medium">{rental.product?.name || rental.productId}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Customer</p>
            <p className="text-sm font-medium">{rental.customer?.name || rental.customerId}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rental Duration</p>
            <p className="text-sm font-bold">{daysRented} day{daysRented !== 1 ? 's' : ''}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rate Per Day</p>
            <p className="text-sm font-medium">{formatKES(rental.ratePerDay)}/day</p>
          </div>
        </div>
        {isLate && (
          <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {lateDays} day{lateDays !== 1 ? 's' : ''} overdue — Late fee: {formatKES(lateFee)}
            </p>
          </div>
        )}
      </div>

      {/* Expected Charge Summary */}
      <div className="p-3 border rounded-lg space-y-2">
        <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Charge Breakdown</p>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Rental Charge ({daysRented} × {formatKES(rental.ratePerDay)})</span>
          <span className="font-mono">{formatKES(rental.totalRentalCharge)}</span>
        </div>
        {lateFee > 0 && (
          <div className="flex justify-between text-sm text-red-600">
            <span>Late Fee ({lateDays} day{lateDays !== 1 ? 's' : ''} × {formatKES(rental.ratePerDay)})</span>
            <span className="font-mono">{formatKES(lateFee)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Security Deposit Held</span>
          <span className="font-mono text-green-600">{formatKES(depositAmount)}</span>
        </div>
      </div>

      {/* Damage Level Selection with Visual Cards */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wider">Damage Assessment</Label>
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
                  ? `${damageColors[level]} ${damageSelectedRing[level]}`
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
      <div className="p-3 border-2 rounded-lg space-y-2 bg-muted/30">
        <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Total Return Summary</p>
        <div className="flex justify-between text-sm">
          <span>Rental Charge</span>
          <span className="font-mono">{formatKES(rental.totalRentalCharge)}</span>
        </div>
        {lateFee > 0 && (
          <div className="flex justify-between text-sm text-red-600">
            <span>Late Fee</span>
            <span className="font-mono">{formatKES(lateFee)}</span>
          </div>
        )}
        {Number(damageCharge) > 0 && (
          <div className="flex justify-between text-sm text-orange-600">
            <span>Damage Charge</span>
            <span className="font-mono">{formatKES(Number(damageCharge))}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between text-sm font-bold">
          <span>Total Charge</span>
          <span className="font-mono">{formatKES(totalCharge)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Less: Security Deposit</span>
          <span className="text-green-600 font-mono">-{formatKES(depositAmount)}</span>
        </div>
        <Separator />
        <div className={`flex justify-between text-sm font-bold ${refundAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <span>{refundAmount >= 0 ? 'Refund to Customer' : 'Customer Owes'}</span>
          <span className="font-mono">{formatKES(Math.abs(refundAmount))}</span>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({ damageAssessment: damageLevel, damageCharge: Number(damageCharge), notes: returnNotes })}
          disabled={isPending}
          className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground h-11"
        >
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          Confirm Return — {formatKES(Math.abs(refundAmount))} {refundAmount >= 0 ? 'Refund' : 'Due'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ============================================================================
// Rental Status Badge with Animations
// ============================================================================

function RentalStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          ACTIVE
        </Badge>
      );
    case 'OVERDUE':
      return (
        <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          OVERDUE
        </Badge>
      );
    case 'RETURNED':
      return (
        <Badge className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400 border-gray-200 dark:border-gray-700 gap-1">
          <CheckCircle className="h-2.5 w-2.5" />
          RETURNED
        </Badge>
      );
    case 'DAMAGED':
      return (
        <Badge className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800 gap-1">
          <Wrench className="h-2.5 w-2.5" />
          DAMAGED
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
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

  // Total rental revenue (charges + late fees + damage)
  const totalRentalRevenue = revenueSummary.totalRevenue + revenueSummary.totalLateFees + revenueSummary.totalDamageCharges;

  return (
    <div className="space-y-4">
      {/* Gradient Accent Banner */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 p-4 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-bold">Rentals Overview</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-green-500/20">
                <DollarSign className="h-3.5 w-3.5 text-green-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Revenue</span>
            </div>
            <p className="text-lg font-bold text-green-400">{formatKES(totalRentalRevenue)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-blue-500/20">
                <KeyRound className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Active Rentals</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{statusCounts.active}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${statusCounts.overdue > 0 ? 'bg-red-500/20' : 'bg-slate-500/20'}`}>
                <AlertTriangle className={`h-3.5 w-3.5 ${statusCounts.overdue > 0 ? 'text-red-400' : 'text-slate-400'}`} />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Overdue</span>
            </div>
            <p className={`text-lg font-bold ${statusCounts.overdue > 0 ? 'text-red-400' : 'text-slate-400'}`}>{statusCounts.overdue}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-emerald-500/20">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Charges</span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{formatKES(revenueSummary.totalRevenue)}</p>
          </div>
        </div>
      </div>

      {/* Enhanced Overview Cards with border-l-4 and gradient */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30">
                <KeyRound className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="text-lg font-bold text-green-600">{statusCounts.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-l-4 ${statusCounts.overdue > 0 ? 'border-l-red-500' : 'border-l-gray-300'}`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg bg-gradient-to-br ${statusCounts.overdue > 0 ? 'from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30' : 'from-gray-100 to-gray-200 dark:from-gray-900/30 dark:to-gray-800/30'}`}>
                <AlertTriangle className={`h-4 w-4 ${statusCounts.overdue > 0 ? 'text-red-600' : 'text-gray-400'}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className={`text-lg font-bold ${statusCounts.overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{statusCounts.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800/30 dark:to-gray-700/30">
                <CheckCircle className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Returned</p>
                <p className="text-lg font-bold">{statusCounts.returned}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/30">
                <Wrench className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Damaged</p>
                <p className="text-lg font-bold text-orange-600">{statusCounts.damaged}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/10 to-primary/20">
                <Layers className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold">{statusCounts.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stats Cards - Revenue & Deposits */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/30 dark:to-emerald-800/30">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Rental Revenue</p>
                <p className="text-xl font-bold">{formatKES(revenueSummary.totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/30 dark:to-blue-800/30">
                <Layers className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Deposits</p>
                <p className="text-xl font-bold">{formatKES(revenueSummary.totalDeposits)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/30">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Late Fees</p>
                <p className="text-xl font-bold">{formatKES(revenueSummary.totalLateFees)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Damage Charges</p>
                <p className="text-xl font-bold">{formatKES(revenueSummary.totalDamageCharges)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rental Revenue Summary - Enhanced */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Rental Revenue Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-xs text-muted-foreground">Rental Charges</p>
              <p className="text-lg font-bold text-emerald-600">{formatKES(revenueSummary.totalRevenue)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <p className="text-xs text-muted-foreground">Security Deposits</p>
              <p className="text-lg font-bold text-blue-600">{formatKES(revenueSummary.totalDeposits)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <p className="text-xs text-muted-foreground">Late Fees Collected</p>
              <p className="text-lg font-bold text-orange-600">{formatKES(revenueSummary.totalLateFees)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
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

      {/* Rentals Table - Enhanced */}
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
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Rate/Day</TableHead>
                    <TableHead className="text-right">Rev/Day</TableHead>
                    <TableHead className="text-right">Total Charge</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rentals.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No rentals found</TableCell></TableRow>
                  ) : rentals.map((rental, idx) => {
                    const isOverdue = rental.status === 'OVERDUE';
                    const daysRented = Math.ceil(
                      ((rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : Date.now()) - new Date(rental.rentalStartDate).getTime()) / 86400000
                    );
                    const revPerDay = daysRented > 0 ? rental.totalRentalCharge / daysRented : 0;
                    return (
                      <TableRow
                        key={rental.id}
                        className={`
                          ${isOverdue ? 'bg-red-50/70 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30' : ''}
                          ${!isOverdue && idx % 2 === 1 ? 'bg-muted/20' : ''}
                          transition-colors
                        `}
                      >
                        <TableCell className="font-medium text-sm">
                          <div className="flex items-center gap-2">
                            {isOverdue && <AlertTriangle className="h-3 w-3 text-red-500" />}
                            {rental.product?.name || rental.productId}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{rental.customer?.name || rental.customerId}</TableCell>
                        <TableCell>
                          <RentalStatusBadge status={rental.status} />
                          {isOverdue && (
                            <p className="text-[10px] text-red-500 mt-0.5 font-medium">
                              {Math.ceil((Date.now() - new Date(rental.expectedReturnDate).getTime()) / 86400000)}d overdue
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="w-[200px]">
                          <RentalTimeline rental={rental} />
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {daysRented}d
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatKES(rental.ratePerDay)}</TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {formatKES(Math.round(revPerDay))}
                        </TableCell>
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

      {/* Return Dialog with Enhanced Damage Assessment */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Process Return
            </DialogTitle>
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
