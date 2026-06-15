'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyRound, AlertTriangle, DollarSign, Layers, Plus,
  CheckCircle, Loader2, Clock, ArrowRight, Wrench,
  ShieldAlert, ShieldCheck, ShieldOff, CalendarDays,
  TrendingUp, Activity, Package, Search, LayoutGrid,
  List, Eye, Camera, FileText, Settings2,
  Phone, Printer, Pencil, Trash2,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  rentalsApi, productsApi, customersApi,
  formatKES, formatDate, openWhatsApp,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function RentalTimeline({ rental }: { rental: RentalItem }) {
  const start = new Date(rental.rentalStartDate).getTime();
  const expected = new Date(rental.expectedReturnDate).getTime();
  const now = Date.now();
  const actual = rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : null;
  const isOverdue = rental.status === 'OVERDUE' || (!actual && now > expected);
  const isReturned = rental.status === 'RETURNED' || rental.status === 'DAMAGED';
  const isActive = rental.status === 'ACTIVE' && !isOverdue;

  const daysRemaining = !isReturned && !isOverdue
    ? Math.max(Math.ceil((expected - now) / 86400000), 0)
    : 0;
  const daysOverdue = isOverdue
    ? Math.ceil((now - expected) / 86400000)
    : 0;

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
      <div className="flex items-center gap-0 w-full">
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
          <span className="text-[8px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatDate(rental.rentalStartDate).slice(0, 6)}</span>
        </div>
        <div className="flex-1 h-0.5 mx-1 relative">
          <div className={`absolute inset-0 ${isReturned ? lineColors.gray : lineColors[statusColor]}`} style={{ opacity: 0.4 }} />
          <div
            className={`absolute top-0 left-0 h-full ${isReturned ? lineColors.gray : lineColors[statusColor]}`}
            style={{ width: isReturned ? '100%' : `${Math.min(((now - start) / (expected - start)) * 100, 100)}%` }}
          />
        </div>
        <div className="flex flex-col items-center flex-shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${dotColors[statusColor]} shadow-sm`} />
          <span className="text-[8px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatDate(rental.expectedReturnDate).slice(0, 6)}</span>
        </div>
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
      <div className="text-center">
        {isOverdue && <span className="text-[10px] font-medium text-red-600 dark:text-red-400">{daysOverdue}d overdue</span>}
        {isCloseToDue && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{daysRemaining}d remaining</span>}
        {isActive && daysRemaining > 3 && <span className="text-[10px] font-medium text-green-600 dark:text-green-400">{daysRemaining}d remaining</span>}
        {isReturned && <span className="text-[10px] font-medium text-muted-foreground">Returned</span>}
      </div>
    </div>
  );
}

// Rental Form Component

function RentalForm({ storeId, products, customers, onSuccess }: { storeId: string; products: ProductListItem[]; customers: CustomerItem[]; onSuccess: () => void }) {
  const [form, setForm] = useState({ productId: '', customerId: '', expectedReturnDate: '', securityDeposit: '', ratePerDay: '', notes: '' });

  const createRentalMutation = useMutation({
    mutationFn: rentalsApi.create,
    onSuccess: () => { toast.success('Rental created'); onSuccess(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const rentalProducts = products.filter(p => p.isRental);
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

      {form.expectedReturnDate && effectiveRate > 0 && (
        <div className="p-3 bg-muted/50 backdrop-blur-sm rounded-lg text-sm border border-border/50">
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

// Damage Assessment Form Component - Late Fee Calc & Condition

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
  const [lateFeeRate, setLateFeeRate] = useState('0');
  const [conditionNotes, setConditionNotes] = useState('');
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

  // Calculate late fee
  const expectedReturn = new Date(rental.expectedReturnDate).getTime();
  const now = Date.now();
  const daysLate = Math.max(Math.ceil((now - expectedReturn) / 86400000), 0);
  const isOverdue = daysLate > 0;
  const calculatedLateFee = isOverdue ? daysLate * Number(lateFeeRate || 0) : 0;

  // Rental duration calculation
  const rentalStart = new Date(rental.rentalStartDate).getTime();
  const rentalDays = Math.ceil((now - rentalStart) / 86400000);
  const rentalCharge = rental.ratePerDay * rentalDays;
  const totalCharge = rentalCharge + calculatedLateFee + Number(damageCharge || 0);
  const refundAmount = depositAmount + rental.totalRentalCharge - totalCharge;

  return (
    <div className="space-y-4">
      {/* Rental Timeline Summary */}
      <div className="p-3 rounded-lg bg-muted/50 backdrop-blur-sm border border-border/50">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Rental Timeline</p>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>Start: {formatDate(rental.rentalStartDate)}</span>
          </div>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isOverdue ? 'bg-red-500' : 'bg-green-500'}`} />
            <span>Due: {formatDate(rental.expectedReturnDate)}</span>
          </div>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span>Return: Today</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Duration: {rentalDays} days | Rate: {formatKES(rental.ratePerDay)}/day | Charge: {formatKES(rentalCharge)}
        </div>
      </div>

      {/* Late Fee Auto-Calculation */}
      {isOverdue && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-950/30 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">Overdue by {daysLate} day{daysLate !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Late Fee Rate (KES/day)</Label>
              <Input
                type="number"
                value={lateFeeRate}
                onChange={(e) => setLateFeeRate(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Calculated Late Fee</Label>
              <div className="h-8 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-bold text-red-600">
                {formatKES(calculatedLateFee)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Damage Assessment */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Damage Assessment</Label>
        <div className="grid grid-cols-4 gap-2">
          {['NONE', 'MINOR', 'MODERATE', 'SEVERE'].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                setDamageLevel(level);
                if (level === 'NONE') setDamageCharge('0');
              }}
              className={`p-2 rounded-lg border-2 text-center transition-all ${damageColors[level]} ${
                damageLevel === level ? 'ring-2 ring-primary ring-offset-1' : 'opacity-60 hover:opacity-80'
              }`}
            >
              <div className="flex justify-center mb-1">{damageIcons[level]}</div>
              <span className="text-[10px] font-medium">{level}</span>
            </button>
          ))}
        </div>
        {damageLevel !== 'NONE' && (
          <div className="space-y-1">
            <Label className="text-xs">Damage Charge (KES)</Label>
            <Input type="number" value={damageCharge} onChange={(e) => setDamageCharge(e.target.value)} placeholder="0" />
          </div>
        )}
      </div>

      {/* Return Condition Notes */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Camera className="h-4 w-4" /> Return Condition Notes
        </Label>
        <Textarea
          value={conditionNotes}
          onChange={(e) => setConditionNotes(e.target.value)}
          placeholder="Describe the condition of returned equipment, any visible damage, missing parts, etc."
          rows={2}
        />
      </div>

      {/* Return Notes */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Additional Notes</Label>
        <Textarea
          value={returnNotes}
          onChange={(e) => setReturnNotes(e.target.value)}
          placeholder="Any other notes about the return..."
          rows={2}
        />
      </div>

      {/* Financial Summary */}
      <div className="p-3 rounded-lg bg-muted/50 backdrop-blur-sm border border-border/50 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Rental Charge ({rentalDays}d × {formatKES(rental.ratePerDay)}):</span>
          <span className="font-mono">{formatKES(rentalCharge)}</span>
        </div>
        {calculatedLateFee > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Late Fee ({daysLate}d × {formatKES(Number(lateFeeRate))}):</span>
            <span className="font-mono">{formatKES(calculatedLateFee)}</span>
          </div>
        )}
        {Number(damageCharge || 0) > 0 && (
          <div className="flex justify-between text-orange-600">
            <span>Damage Charge:</span>
            <span className="font-mono">{formatKES(Number(damageCharge || 0))}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between font-semibold">
          <span>Total Charges:</span>
          <span className="font-mono">{formatKES(totalCharge)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Less: Deposit Paid:</span>
          <span className="font-mono">{formatKES(depositAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Less: Previous Charges:</span>
          <span className="font-mono">{formatKES(rental.totalRentalCharge)}</span>
        </div>
        <Separator />
        <div className={`flex justify-between text-sm font-bold ${refundAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <span>{refundAmount >= 0 ? 'Refund to Customer' : 'Customer Owes'}</span>
          <span className="font-mono">{formatKES(Math.abs(refundAmount))}</span>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            damageAssessment: damageLevel,
            damageCharge: Number(damageCharge),
            notes: [returnNotes, conditionNotes ? `Condition: ${conditionNotes}` : ''].filter(Boolean).join('\n'),
          })}
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

// Rental Status Badge with Animations

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
        <Badge className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800 gap-1">
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

// Calendar View Component

function RentalCalendarView({ rentals }: { rentals: RentalItem[] }) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const monthName = new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
  };

  // Map rentals to dates
  const rentalsByDate = useMemo(() => {
    const map: Record<number, RentalItem[]> = {};
    rentals.forEach(r => {
      const start = new Date(r.rentalStartDate);
      const end = r.actualReturnDate ? new Date(r.actualReturnDate) : new Date(r.expectedReturnDate);
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(currentYear, currentMonth, d);
        if (date >= start && date <= end) {
          if (!map[d]) map[d] = [];
          map[d].push(r);
        }
      }
    });
    return map;
  }, [rentals, currentMonth, currentYear, daysInMonth]);

  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-green-400',
    OVERDUE: 'bg-red-400',
    RETURNED: 'bg-blue-400',
    DAMAGED: 'bg-orange-400',
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Rental Calendar
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={prevMonth}>&lt;</Button>
            <span className="text-sm font-medium min-w-[140px] text-center">{monthName}</span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={nextMonth}>&gt;</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="h-16" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
            const dayRentals = rentalsByDate[day] || [];
            return (
              <div
                key={day}
                className={`h-16 rounded-md border p-1 text-[10px] transition-colors ${
                  isToday ? 'border-primary bg-primary/5' : 'border-border/30 bg-muted/20 hover:bg-muted/40'
                }`}
              >
                <span className={`font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{day}</span>
                <div className="mt-0.5 space-y-0.5 max-h-[36px] overflow-hidden">
                  {dayRentals.slice(0, 3).map((r, ri) => (
                    <div
                      key={ri}
                      className={`h-1.5 rounded-full ${statusColor[r.status] || 'bg-gray-400'}`}
                      title={`${r.product?.name || 'Equipment'} - ${r.status}`}
                    />
                  ))}
                  {dayRentals.length > 3 && (
                    <span className="text-[8px] text-muted-foreground">+{dayRentals.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-400" /> Active</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400" /> Overdue</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-400" /> Returned</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-400" /> Damaged</div>
        </div>
      </CardContent>
    </Card>
  );
}

// Equipment Catalog Component

function EquipmentCatalog({ products, rentals }: { products: ProductListItem[]; rentals: RentalItem[] }) {
  const rentalProducts = products.filter(p => p.isRental);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = rentalProducts.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Equipment Catalog
          </CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search equipment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 w-48 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No rental equipment found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add rental products to see equipment catalog</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
            {filtered.map(product => {
              const productRentals = rentals.filter(r => r.productId === product.id);
              const activeRentals = productRentals.filter(r => r.status === 'ACTIVE' || r.status === 'OVERDUE');
              const isAvailable = product.quantityInStock > activeRentals.length;
              const totalRentalRevenue = productRentals.reduce((s, r) => s + r.totalRentalCharge, 0);
              const maintenanceCount = productRentals.filter(r => r.status === 'DAMAGED').length;

              return (
                <div
                  key={product.id}
                  className={`p-3 rounded-lg border backdrop-blur-sm transition-all hover:shadow-md ${
                    isAvailable
                      ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20'
                      : 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold truncate">{product.name}</p>
                      <p className="text-[10px] text-muted-foreground">SKU: {product.sku}</p>
                    </div>
                    <Badge className={`text-[9px] ${isAvailable ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                      {isAvailable ? 'Available' : 'Rented Out'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="p-1.5 rounded bg-muted/30">
                      <span className="text-muted-foreground">Stock:</span>
                      <span className="font-medium ml-1">{product.quantityInStock}</span>
                    </div>
                    <div className="p-1.5 rounded bg-muted/30">
                      <span className="text-muted-foreground">Rate:</span>
                      <span className="font-medium ml-1">{formatKES(product.pricePerUnit)}/d</span>
                    </div>
                    <div className="p-1.5 rounded bg-muted/30">
                      <span className="text-muted-foreground">Rented:</span>
                      <span className="font-medium ml-1">{activeRentals.length}</span>
                    </div>
                    <div className="p-1.5 rounded bg-muted/30">
                      <span className="text-muted-foreground">Revenue:</span>
                      <span className="font-medium ml-1">{formatKES(totalRentalRevenue)}</span>
                    </div>
                  </div>
                  {/* Rental History Mini Bar */}
                  {productRentals.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <p className="text-[9px] text-muted-foreground mb-1">Rental History ({productRentals.length} total)</p>
                      <div className="flex gap-0.5">
                        {productRentals.slice(-10).map((r, i) => (
                          <div
                            key={i}
                            className={`h-2 flex-1 rounded-sm ${
                              r.status === 'ACTIVE' ? 'bg-green-400' :
                              r.status === 'OVERDUE' ? 'bg-red-400' :
                              r.status === 'RETURNED' ? 'bg-blue-400' :
                              'bg-orange-400'
                            }`}
                            title={`${r.customer?.name || 'Customer'} - ${r.status}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Maintenance Indicator */}
                  {maintenanceCount > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400">
                      <Wrench className="h-3 w-3" />
                      <span>{maintenanceCount} maintenance flag{maintenanceCount > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Rental Card View Component

function RentalCardView({ rentals, onReturn, onEdit, onDelete, onSendReceipt, onPrintReceipt }: { rentals: RentalItem[]; onReturn: (rental: RentalItem) => void; onEdit: (rental: RentalItem) => void; onDelete: (rental: RentalItem) => void; onSendReceipt: (rental: RentalItem) => void; onPrintReceipt: (rental: RentalItem) => void }) {
  const statusBorder: Record<string, string> = {
    ACTIVE: 'border-l-green-500',
    OVERDUE: 'border-l-red-500',
    RETURNED: 'border-l-blue-500',
    DAMAGED: 'border-l-orange-500',
  };
  const statusBg: Record<string, string> = {
    ACTIVE: 'bg-green-50/50 dark:bg-green-950/10',
    OVERDUE: 'bg-red-50/50 dark:bg-red-950/10',
    RETURNED: 'bg-blue-50/50 dark:bg-blue-950/10',
    DAMAGED: 'bg-orange-50/50 dark:bg-orange-950/10',
  };

  if (rentals.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="relative mx-auto w-20 h-20 mb-4">
          <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm rounded-2xl border border-border/30" />
          <KeyRound className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
        </div>
        <p className="text-base font-medium text-muted-foreground">No rentals found</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Create a new rental to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
      {rentals.map(rental => {
        const daysRented = Math.ceil(
          ((rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : Date.now()) - new Date(rental.rentalStartDate).getTime()) / 86400000
        );
        const isOverdue = rental.status === 'OVERDUE';

        return (
          <Card
            key={rental.id}
            className={`border-l-4 ${statusBorder[rental.status] || 'border-l-gray-300'} ${statusBg[rental.status] || ''} backdrop-blur-sm hover:shadow-md transition-all`}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{rental.product?.name || 'Equipment'}</p>
                  <p className="text-xs text-muted-foreground">{rental.customer?.name || 'Customer'}</p>
                </div>
                <RentalStatusBadge status={rental.status} />
              </div>
              <RentalTimeline rental={rental} />
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="p-1.5 rounded bg-muted/30 text-center">
                  <span className="text-muted-foreground block">Duration</span>
                  <span className="font-semibold">{daysRented}d</span>
                </div>
                <div className="p-1.5 rounded bg-muted/30 text-center">
                  <span className="text-muted-foreground block">Rate/Day</span>
                  <span className="font-semibold">{formatKES(rental.ratePerDay)}</span>
                </div>
                <div className="p-1.5 rounded bg-muted/30 text-center">
                  <span className="text-muted-foreground block">Total</span>
                  <span className="font-semibold">{formatKES(rental.totalRentalCharge)}</span>
                </div>
              </div>
              {isOverdue && (
                <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Overdue by {Math.ceil((Date.now() - new Date(rental.expectedReturnDate).getTime()) / 86400000)} days</span>
                </div>
              )}
              {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                <Button
                  variant={isOverdue ? 'destructive' : 'outline'}
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={() => onReturn(rental)}
                >
                  <CheckCircle className="mr-1 h-3 w-3" /> Process Return
                </Button>
              )}
              <div className="flex flex-wrap gap-1">
                {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                  <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={() => onEdit(rental)}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30" onClick={() => onSendReceipt(rental)}>
                  <Phone className="h-3 w-3 mr-1" /> WhatsApp
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={() => onPrintReceipt(rental)}>
                  <Printer className="h-3 w-3 mr-1" /> Print
                </Button>
                {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                  <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => onDelete(rental)}>
                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// Main Rentals Tab Component

export default function RentalsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedRental, setSelectedRental] = useState<RentalItem | null>(null);
  const [newRentalOpen, setNewRentalOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editRental, setEditRental] = useState<RentalItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteRental, setDeleteRental] = useState<RentalItem | null>(null);
  const [editForm, setEditForm] = useState({ expectedReturnDate: '', securityDeposit: '', ratePerDay: '', ratePerWeek: '', ratePerMonth: '', notes: '' });
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'calendar'>('table');
  const [activeTab, setActiveTab] = useState('rentals');
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

  const updateRentalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { expectedReturnDate?: string; securityDeposit?: number; ratePerDay?: number; ratePerWeek?: number; ratePerMonth?: number; notes?: string } }) => rentalsApi.update(id, data),
    onSuccess: () => {
      toast.success('Rental updated successfully');
      setEditDialogOpen(false);
      setEditRental(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteRentalMutation = useMutation({
    mutationFn: (id: string) => rentalsApi.delete(id),
    onSuccess: () => {
      toast.success('Rental deleted successfully');
      setDeleteDialogOpen(false);
      setDeleteRental(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rentals = Array.isArray(rentalsData?.data) ? rentalsData.data : [];
  const products = Array.isArray(productsData?.data) ? productsData.data : [];

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

  const totalRentalRevenue = revenueSummary.totalRevenue + revenueSummary.totalLateFees + revenueSummary.totalDamageCharges;

  // Equipment availability
  const equipmentAvailable = useMemo(() => {
    const rentalProducts = products.filter(p => p.isRental);
    const activeRentalProductIds = rentals
      .filter(r => r.status === 'ACTIVE' || r.status === 'OVERDUE')
      .map(r => r.productId);
    return rentalProducts.filter(p => !activeRentalProductIds.includes(p.id) || p.quantityInStock > 1).length;
  }, [products, rentals]);

  const handleReturn = (rental: RentalItem) => {
    setSelectedRental(rental);
    setReturnDialogOpen(true);
  };

  const handleEdit = (rental: RentalItem) => {
    setEditRental(rental);
    setEditForm({
      expectedReturnDate: rental.expectedReturnDate ? new Date(rental.expectedReturnDate).toISOString().slice(0, 10) : '',
      securityDeposit: String(rental.securityDeposit),
      ratePerDay: String(rental.ratePerDay),
      ratePerWeek: rental.ratePerWeek ? String(rental.ratePerWeek) : '',
      ratePerMonth: rental.ratePerMonth ? String(rental.ratePerMonth) : '',
      notes: rental.notes || '',
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (rental: RentalItem) => {
    setDeleteRental(rental);
    setDeleteDialogOpen(true);
  };

  const handleSendReceipt = (rental: RentalItem) => {
    const phone = rental.customer?.phone || '';
    if (!phone) {
      toast.error('Customer has no phone number on file');
      return;
    }
    const daysRented = Math.ceil(
      ((rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : Date.now()) - new Date(rental.rentalStartDate).getTime()) / 86400000
    );
    const message = [
      `*Mbumah Hardware - Rental Receipt*`,
      ``,
      `Rental ID: ${rental.id.slice(-8).toUpperCase()}`,
      `Equipment: ${rental.product?.name || 'N/A'}`,
      `Customer: ${rental.customer?.name || 'N/A'}`,
      ``,
      `Start Date: ${formatDate(rental.rentalStartDate)}`,
      `Expected Return: ${formatDate(rental.expectedReturnDate)}`,
      rental.actualReturnDate ? `Actual Return: ${formatDate(rental.actualReturnDate)}` : null,
      `Duration: ${daysRented} day(s)`,
      ``,
      `Rate/Day: KES ${rental.ratePerDay.toLocaleString()}`,
      `Security Deposit: KES ${rental.securityDeposit.toLocaleString()}`,
      `Total Rental Charge: KES ${rental.totalRentalCharge.toLocaleString()}`,
      rental.lateFeeAccumulated > 0 ? `Late Fee: KES ${rental.lateFeeAccumulated.toLocaleString()}` : null,
      rental.damageCharge > 0 ? `Damage Charge: KES ${rental.damageCharge.toLocaleString()}` : null,
      `Status: ${rental.status}`,
      ``,
      `Thank you for doing business with us`,
    ].filter(Boolean).join('\n');
    openWhatsApp(phone, message);
  };

  const handlePrintReceipt = (rental: RentalItem) => {
    const daysRented = Math.ceil(
      ((rental.actualReturnDate ? new Date(rental.actualReturnDate).getTime() : Date.now()) - new Date(rental.rentalStartDate).getTime()) / 86400000
    );
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head><title>Rental Receipt</title>
      <style>
        body { font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; padding: 20px; font-size: 12px; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .line { border-top: 1px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; }
        .title { font-size: 16px; font-weight: bold; }
      </style>
      </head>
      <body>
        <div class="center">
          <div class="title">MBUMAH HARDWARE</div>
          <div>Rental Receipt</div>
        </div>
        <div class="line"></div>
        <div class="row"><span>Receipt #:</span><span>${rental.id.slice(-8).toUpperCase()}</span></div>
        <div class="row"><span>Date:</span><span>${formatDate(rental.createdAt)}</span></div>
        <div class="line"></div>
        <div class="bold">Customer Details</div>
        <div class="row"><span>Name:</span><span>${rental.customer?.name || 'N/A'}</span></div>
        <div class="row"><span>Phone:</span><span>${rental.customer?.phone || 'N/A'}</span></div>
        <div class="line"></div>
        <div class="bold">Equipment Details</div>
        <div class="row"><span>Item:</span><span>${rental.product?.name || 'N/A'}</span></div>
        <div class="row"><span>SKU:</span><span>${rental.product?.sku || 'N/A'}</span></div>
        <div class="line"></div>
        <div class="bold">Rental Period</div>
        <div class="row"><span>Start:</span><span>${formatDate(rental.rentalStartDate)}</span></div>
        <div class="row"><span>Expected Return:</span><span>${formatDate(rental.expectedReturnDate)}</span></div>
        ${rental.actualReturnDate ? `<div class="row"><span>Actual Return:</span><span>${formatDate(rental.actualReturnDate)}</span></div>` : ''}
        <div class="row"><span>Duration:</span><span>${daysRented} day(s)</span></div>
        <div class="line"></div>
        <div class="bold">Charges</div>
        <div class="row"><span>Rate/Day:</span><span>KES ${rental.ratePerDay.toLocaleString()}</span></div>
        <div class="row"><span>Rental Charge:</span><span>KES ${rental.totalRentalCharge.toLocaleString()}</span></div>
        ${rental.lateFeeAccumulated > 0 ? `<div class="row"><span>Late Fee:</span><span>KES ${rental.lateFeeAccumulated.toLocaleString()}</span></div>` : ''}
        ${rental.damageCharge > 0 ? `<div class="row"><span>Damage Charge:</span><span>KES ${rental.damageCharge.toLocaleString()}</span></div>` : ''}
        <div class="row"><span>Security Deposit:</span><span>KES ${rental.securityDeposit.toLocaleString()}</span></div>
        <div class="line"></div>
        <div class="row bold"><span>Status:</span><span>${rental.status}</span></div>
        <div class="line"></div>
        <div class="center" style="margin-top: 12px;">
          <div>Thank you for doing business with us</div>
        </div>
      </body>
      </html>
    `;
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  return (
    <div className="space-y-4">
      {/* Gradient Accent Banner - Glass-morphism */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 p-4 text-white shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-white/5 backdrop-blur-sm" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold">Rentals Overview</h2>
            </div>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground h-8"
              onClick={() => setNewRentalOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" /> New Rental
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1 rounded bg-green-500/20">
                  <KeyRound className="h-3.5 w-3.5 text-green-400" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-300">Active Rentals</span>
              </div>
              <p className="text-lg font-bold text-green-400">{statusCounts.active}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1 rounded ${statusCounts.overdue > 0 ? 'bg-red-500/20' : 'bg-slate-500/20'}`}>
                  <AlertTriangle className={`h-3.5 w-3.5 ${statusCounts.overdue > 0 ? 'text-red-400' : 'text-slate-400'}`} />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-300">Overdue</span>
              </div>
              <p className={`text-lg font-bold ${statusCounts.overdue > 0 ? 'text-red-400' : 'text-slate-400'}`}>{statusCounts.overdue}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1 rounded bg-emerald-500/20">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-300">Rental Revenue</span>
              </div>
              <p className="text-lg font-bold text-emerald-400">{formatKES(totalRentalRevenue)}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1 rounded bg-blue-500/20">
                  <Package className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-300">Equipment Available</span>
              </div>
              <p className="text-lg font-bold text-blue-400">{equipmentAvailable}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="rentals" className="text-xs">
            <List className="h-3.5 w-3.5 mr-1.5" /> Rentals
          </TabsTrigger>
          <TabsTrigger value="calendar" className="text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" /> Calendar
          </TabsTrigger>
          <TabsTrigger value="equipment" className="text-xs">
            <Package className="h-3.5 w-3.5 mr-1.5" /> Equipment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rentals" className="space-y-4 mt-4">
          {/* Status + Revenue Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
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
            <Card className={`border-l-4 ${statusCounts.overdue > 0 ? 'border-l-red-500' : 'border-l-gray-300'} backdrop-blur-sm bg-card/80`}>
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
            <Card className="border-l-4 border-l-blue-500 backdrop-blur-sm bg-card/80">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/30 dark:to-blue-800/30">
                    <CheckCircle className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Returned</p>
                    <p className="text-lg font-bold text-blue-600">{statusCounts.returned}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-orange-500 backdrop-blur-sm bg-card/80">
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
            <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
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

          {/* Revenue Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-l-4 border-l-emerald-500 backdrop-blur-sm bg-card/80">
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
            <Card className="border-l-4 border-l-blue-500 backdrop-blur-sm bg-card/80">
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
            <Card className="border-l-4 border-l-orange-500 backdrop-blur-sm bg-card/80">
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
            <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
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

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
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
            <div className="flex items-center gap-1 ml-auto">
              <Button
                variant={viewMode === 'table' ? 'default' : 'outline'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setViewMode('table')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'default' : 'outline'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setViewMode('cards')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Rental Content - Table or Cards */}
          {isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
              <Skeleton className="h-64" />
            </div>
          ) : viewMode === 'cards' ? (
            <RentalCardView rentals={rentals} onReturn={handleReturn} onEdit={handleEdit} onDelete={handleDelete} onSendReceipt={handleSendReceipt} onPrintReceipt={handlePrintReceipt} />
          ) : (
            <Card className="backdrop-blur-sm bg-card/80 border-border/50">
              <CardContent className="p-0">
                {rentals.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="relative mx-auto w-20 h-20 mb-4">
                      <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm rounded-2xl border border-border/30" />
                      <KeyRound className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
                    </div>
                    <p className="text-base font-medium text-muted-foreground">No rentals found</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">
                      {statusFilter !== 'all' ? 'Try a different status filter' : 'Create a new rental to get started'}
                    </p>
                    {statusFilter === 'all' && (
                      <Button className="mt-3 bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground" size="sm" onClick={() => setNewRentalOpen(true)}>
                        <Plus className="mr-1.5 h-4 w-4" /> New Rental
                      </Button>
                    )}
                  </div>
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
                          <TableHead className="w-[200px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rentals.map((rental, idx) => {
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
                              <TableCell className="text-right text-sm font-mono">{daysRented}d</TableCell>
                              <TableCell className="text-right text-sm">{formatKES(rental.ratePerDay)}</TableCell>
                              <TableCell className="text-right text-sm font-mono">{formatKES(Math.round(revPerDay))}</TableCell>
                              <TableCell className="text-right font-medium text-sm">{formatKES(rental.totalRentalCharge)}</TableCell>
                              <TableCell className="text-right text-sm">{formatKES(rental.securityDeposit)}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                                    <Button
                                      variant={isOverdue ? 'destructive' : 'outline'}
                                      size="sm"
                                      className="h-7 text-[10px] px-2"
                                      onClick={() => handleReturn(rental)}
                                    >
                                      Return
                                    </Button>
                                  )}
                                  {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                                    <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={() => handleEdit(rental)}>
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                  )}
                                  <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30" onClick={() => handleSendReceipt(rental)}>
                                    <Phone className="h-3 w-3" />
                                  </Button>
                                  <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={() => handlePrintReceipt(rental)}>
                                    <Printer className="h-3 w-3" />
                                  </Button>
                                  {(rental.status === 'ACTIVE' || rental.status === 'OVERDUE') && (
                                    <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => handleDelete(rental)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
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
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <RentalCalendarView rentals={rentals} />
        </TabsContent>

        <TabsContent value="equipment" className="mt-4">
          <EquipmentCatalog products={products} rentals={rentals} />
        </TabsContent>
      </Tabs>

      {/* Return Dialog with Damage Assessment */}
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
            products={Array.isArray(productsData?.data) ? productsData.data : []}
            customers={Array.isArray(customersData?.data) ? customersData.data : []}
            onSuccess={() => setNewRentalOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Rental Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Rental
            </DialogTitle>
            <DialogDescription>Update rental details for {editRental?.product?.name || 'equipment'}</DialogDescription>
          </DialogHeader>
          {editRental && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg border border-border/50 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equipment:</span>
                  <span className="font-medium">{editRental.product?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-medium">{editRental.customer?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Status:</span>
                  <RentalStatusBadge status={editRental.status} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Expected Return Date</Label>
                <Input type="date" value={editForm.expectedReturnDate} onChange={(e) => setEditForm({ ...editForm, expectedReturnDate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Security Deposit (KES)</Label>
                  <Input type="number" value={editForm.securityDeposit} onChange={(e) => setEditForm({ ...editForm, securityDeposit: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Rate Per Day (KES)</Label>
                  <Input type="number" value={editForm.ratePerDay} onChange={(e) => setEditForm({ ...editForm, ratePerDay: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Rate Per Week (KES)</Label>
                  <Input type="number" value={editForm.ratePerWeek} onChange={(e) => setEditForm({ ...editForm, ratePerWeek: e.target.value })} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Rate Per Month (KES)</Label>
                  <Input type="number" value={editForm.ratePerMonth} onChange={(e) => setEditForm({ ...editForm, ratePerMonth: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Any special instructions..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => updateRentalMutation.mutate({
                    id: editRental.id,
                    data: {
                      expectedReturnDate: editForm.expectedReturnDate,
                      securityDeposit: Number(editForm.securityDeposit),
                      ratePerDay: Number(editForm.ratePerDay),
                      ratePerWeek: editForm.ratePerWeek ? Number(editForm.ratePerWeek) : undefined,
                      ratePerMonth: editForm.ratePerMonth ? Number(editForm.ratePerMonth) : undefined,
                      notes: editForm.notes || undefined,
                    },
                  })}
                  disabled={updateRentalMutation.isPending || !editForm.expectedReturnDate}
                  className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
                >
                  {updateRentalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Update Rental
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Delete Rental
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this rental for <strong>{deleteRental?.product?.name || 'equipment'}</strong> rented by <strong>{deleteRental?.customer?.name || 'customer'}</strong>? This action cannot be undone. The equipment stock will be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRental && deleteRentalMutation.mutate(deleteRental.id)}
              disabled={deleteRentalMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteRentalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete Rental
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
