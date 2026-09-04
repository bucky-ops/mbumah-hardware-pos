'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { formatKES, type CustomerItem } from '@/lib/api';
import Decimal from 'decimal.js';
import { toDec, round2 } from '@/lib/utils/financialMath';
import type { PaymentMethod } from '@/lib/types';
import { StkStatusPanel } from '@/components/pos/stk-status-panel';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  CreditCard, Banknote, Wallet, Split, Smartphone,
  AlertCircle, Loader2, AlertTriangle, CheckCircle, ExternalLink,
  Check, ChevronLeft, ChevronRight, ShoppingCart, User, Tag, Receipt,
} from 'lucide-react';

// ─── Shared checkout dialog (ResponsiveDialog) ───────────────────────────────
// Used by both desktop & mobile POS so the payment flow stays consistent.
// Order: Cash → Debt → Either/Split → M-Pesa.
//
// Multi-step flow (added enhancement):
//   Step 1 — Customer & Payment Method
//   Step 2 — Payment Details (amounts, split payments, M-Pesa phone)
//   Step 3 — Review & Confirm (order summary + Process Payment)

export interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalTotal: number;
  totalDiscount: number;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  cashReceived: string;
  setCashReceived: (v: string) => void;
  change: number;
  selectedCustomer: string;
  customers: CustomerItem[];
  splitCashAmount: string;
  setSplitCashAmount: (v: string) => void;
  splitMpesaAmount: string;
  setSplitMpesaAmount: (v: string) => void;
  mpesaPhone: string;
  setMpesaPhone: (v: string) => void;
  mpesaStatus: 'idle' | 'processing' | 'success' | 'failed';
  setMpesaStatus: (s: 'idle' | 'processing' | 'success' | 'failed') => void;
  stkCheckoutRequestId: string;
  stkResultDesc: string;
  stkPolling: boolean;
  mpesaMutation: { isPending: boolean; mutate: (data: { phoneNumber: string; amount: number; accountReference: string; transactionDesc: string }) => void };
  checkoutMutation: { isPending: boolean };
  onSendStkPush: () => void;
  onRetryStk: () => void;
  onCompleteSale: () => void;
  /** Optional cart items for the review/confirm step order summary */
  cartItems?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    pricePerUnit: number;
    lineTotal: number;
    discountPercent?: number;
  }>;
  /** Subtotal (pre-discount, pre-tax) for the order summary */
  subtotal?: number;
  /** Tax amount for the order summary */
  taxAmount?: number;
}

const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  icon: React.ElementType;
  desc: string;
  color: string;
  /** Tailwind gradient classes for the selected state border + icon tint */
  selectedGradient: string;
  /** Tailwind gradient for the icon circle when selected */
  iconGradient: string;
}[] = [
  {
    value: 'CASH', label: 'Cash', icon: Banknote, desc: 'Receive cash & give change', color: 'text-green-600',
    selectedGradient: 'from-emerald-500 to-green-600',
    iconGradient: 'bg-gradient-to-br from-emerald-500 to-green-600 text-white',
  },
  {
    value: 'DEBT', label: 'Debt', icon: Wallet, desc: 'Put it on a customer account', color: 'text-amber-600',
    selectedGradient: 'from-amber-500 to-orange-600',
    iconGradient: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
  },
  {
    value: 'SPLIT', label: 'Either / Split', icon: Split, desc: 'Cash + M-Pesa combined', color: 'text-purple-600',
    selectedGradient: 'from-fuchsia-500 to-purple-600',
    iconGradient: 'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white',
  },
  {
    value: 'MPESA', label: 'M-Pesa', icon: Smartphone, desc: 'STK push to customer phone', color: 'text-blue-600',
    selectedGradient: 'from-sky-500 to-blue-600',
    iconGradient: 'bg-gradient-to-br from-sky-500 to-blue-600 text-white',
  },
];

type Step = 1 | 2 | 3;

export function CheckoutDialog(props: CheckoutDialogProps) {
  const {
    open, onOpenChange, finalTotal, totalDiscount,
    paymentMethod, setPaymentMethod,
    cashReceived, setCashReceived, change,
    selectedCustomer, customers,
    splitCashAmount, setSplitCashAmount, splitMpesaAmount, setSplitMpesaAmount,
    mpesaPhone, setMpesaPhone, mpesaStatus, setMpesaStatus,
    stkCheckoutRequestId, stkResultDesc, stkPolling,
    mpesaMutation, checkoutMutation,
    onSendStkPush, onRetryStk, onCompleteSale,
    cartItems, subtotal, taxAmount,
  } = props;

  const customer = customers.find((c) => c.id === selectedCustomer);
  const debtAvailable = customer ? Math.max(0, customer.debtLimit - customer.currentDebtBalance) : 0;
  const exceedsDebt = customer ? finalTotal > debtAvailable : false;

  const cashValid = !!cashReceived && Number(cashReceived) >= finalTotal;
  const splitValid = (Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0) >= finalTotal && (Number(splitMpesaAmount) || 0) > 0 ? !!mpesaPhone && mpesaPhone.length >= 9 : true;
  const mpesaValid = !!mpesaPhone && mpesaPhone.length >= 9;

  // Step state — start at step 1 (Customer & Payment Method)
  const [step, setStep] = useState<Step>(1);
  // Direction of step transition (for slide animation)
  const [stepDirection, setStepDirection] = useState<'right' | 'left'>('right');

  // Respect prefers-reduced-motion: when true, framer-motion transitions are
  // reduced to opacity-only (no translate/scale) for vestibular safety.
  const prefersReducedMotion = useReducedMotion();

  // Reset M-Pesa status when payment method changes (away from MPESA)
  useEffect(() => {
    if (paymentMethod !== 'MPESA' && paymentMethod !== 'SPLIT' && mpesaStatus !== 'idle') {
      setMpesaStatus('idle');
    }
  }, [paymentMethod, mpesaStatus, setMpesaStatus]);

  // Reset to step 1 when dialog opens
  // (deferred via requestAnimationFrame to avoid cascading-renders lint warning)
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setStep(1);
      setStepDirection('right');
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const isProcessingMpesa = mpesaStatus === 'processing' || mpesaStatus === 'success' || mpesaStatus === 'failed';
  const showMpesaPanel = (paymentMethod === 'MPESA' || paymentMethod === 'SPLIT');

  // Compute derived totals for the order summary
  // FINANCIAL MATH AUDIT: VAT is INSIDE the (VAT-inclusive) line totals.
  // The fallback tax preview extracts the per-line VAT component in Decimal
  // (never `Math.round(subtotal × 0.16)` on top — that double-counted VAT
  // and diverged from the server's per-line taxRate computation).
  const summarySubtotal = subtotal ?? cartItems?.reduce((sum, i) => sum + i.lineTotal, 0) ?? 0;
  const summaryTax = taxAmount ?? round2(
    (cartItems ?? []).reduce((sum, i) => {
      const rate = Math.min(100, Math.max(0, i.taxRate || 0));
      if (rate === 0) return sum;
      const gross = toDec(i.lineTotal);
      return sum.plus(gross.minus(gross.div(1 + rate / 100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)));
    }, new Decimal(0))
  );
  const summaryTotalItems = cartItems?.reduce((sum, i) => sum + i.quantity, 0) ?? 0;

  // Validation per step
  const step1Valid = true; // Payment method is always selected (defaults to CASH)
  const step2Valid = useMemo(() => {
    if (paymentMethod === 'CASH') return cashValid;
    if (paymentMethod === 'DEBT') return !!selectedCustomer && selectedCustomer !== 'walk-in' && !exceedsDebt;
    if (paymentMethod === 'SPLIT') return splitValid;
    if (paymentMethod === 'MPESA') return mpesaValid;
    return false;
  }, [paymentMethod, cashValid, selectedCustomer, exceedsDebt, splitValid, mpesaValid]);

  // Show the M-Pesa processing panel as a special "step 2.5" — when mpesa is processing/success/failed,
  // we still show step 2 content (STK status) but the footer changes via renderFooter.
  const goToStep = (nextStep: Step) => {
    if (nextStep > step) setStepDirection('right');
    else setStepDirection('left');
    setStep(nextStep);
  };

  // Build the footer buttons depending on state
  const renderFooter = () => {
    // M-Pesa processing/success/failed states override step navigation
    if (mpesaStatus === 'processing') {
      return (
        <>
          <Button variant="outline" onClick={() => { onRetryStk(); }} disabled={stkPolling}>
            Cancel
          </Button>
          <a
            href="https://daraja.safaricom.co.ke"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open M-Pesa Daraja
          </a>
        </>
      );
    }
    if (mpesaStatus === 'success') {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            onClick={onCompleteSale}
            disabled={checkoutMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white btn-press"
          >
            {checkoutMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Completing…</>
            ) : (
              <><CheckCircle className="mr-2 h-4 w-4" />Complete Sale</>
            )}
          </Button>
        </>
      );
    }
    if (mpesaStatus === 'failed') {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onRetryStk}>Try Again</Button>
        </>
      );
    }

    // Step-aware footer: Back/Next/Process Payment
    if (step === 1) {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => goToStep(2)}
            disabled={!step1Valid}
            className="btn-press"
          >
            Next: Payment Details
            <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        </>
      );
    }
    if (step === 2) {
      // For M-Pesa: show "Send STK Push" instead of "Next"
      if (showMpesaPanel && !isProcessingMpesa) {
        return (
          <>
            <Button variant="outline" onClick={() => goToStep(1)}>
              <ChevronLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={onSendStkPush}
              disabled={mpesaMutation.isPending || !mpesaValid}
              className="bg-green-600 hover:bg-green-700 text-white btn-press"
            >
              {mpesaMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending STK…</>
              ) : (
                <><Smartphone className="mr-2 h-4 w-4" />Send STK Push</>
              )}
            </Button>
          </>
        );
      }
      return (
        <>
          <Button variant="outline" onClick={() => goToStep(1)}>
            <ChevronLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <Button
            onClick={() => goToStep(3)}
            disabled={!step2Valid}
            className="btn-press"
          >
            Next: Review
            <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        </>
      );
    }
    // Step 3: Review & Confirm — "Process Payment" with gradient + loading spinner
    return (
      <>
        <Button variant="outline" onClick={() => goToStep(2)} disabled={isProcessingMpesa}>
          <ChevronLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onCompleteSale}
          disabled={checkoutMutation.isPending || !step2Valid}
          className="relative overflow-hidden bg-gradient-to-r from-emerald-600 via-emerald-500 to-amber-500 hover:from-emerald-700 hover:via-emerald-600 hover:to-amber-600 text-white shadow-lg shadow-emerald-500/30 btn-press"
        >
          {/* Glossy gradient sheen on top */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
          {checkoutMutation.isPending ? (
            <span className="relative z-10 flex items-center">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…
            </span>
          ) : (
            <span className="relative z-10 flex items-center">
              <CheckCircle className="mr-2 h-4 w-4" />Process Payment
            </span>
          )}
        </Button>
      </>
    );
  };

  // Step indicator (3 steps with checkmarks for completed steps)
  const renderStepIndicator = () => {
    const steps = [
      { n: 1 as Step, label: 'Customer & Method', icon: User },
      { n: 2 as Step, label: 'Payment Details', icon: CreditCard },
      { n: 3 as Step, label: 'Review & Confirm', icon: Receipt },
    ];
    return (
      <div className="flex items-center justify-between gap-2 mb-4 select-none">
        {steps.map((s, idx) => {
          const StepIcon = s.icon;
          const isComplete = step > s.n;
          const isCurrent = step === s.n;
          return (
            <React.Fragment key={s.n}>
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className={`relative flex items-center justify-center h-8 w-8 rounded-full border-2 transition-all ${
                    isComplete
                      ? 'bg-green-600 border-green-600 text-white'
                      : isCurrent
                        ? 'bg-primary border-primary text-primary-foreground animate-pulse-active'
                        : 'bg-muted border-border text-muted-foreground'
                  }`}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${s.n}: ${s.label}${isComplete ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-3.5 w-3.5" />
                  )}
                </div>
                <span className={`text-[9px] font-medium text-center leading-tight truncate w-full ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mt-[-12px] rounded transition-colors ${step > s.n ? 'bg-green-600' : 'bg-border'}`}
                  aria-hidden
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // Order summary sidebar (used in steps 2 & 3)
  const renderOrderSummary = (compact: boolean = false) => {
    if (!cartItems || cartItems.length === 0) return null;
    return (
      <div className={`rounded-lg border bg-muted/30 p-3 space-y-2 ${compact ? 'text-xs' : 'text-sm'}`}>
        <div className="flex items-center justify-between">
          <span className="font-medium flex items-center gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5" />
            Order Summary
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {summaryTotalItems} item{summaryTotalItems !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className={`max-h-32 overflow-y-auto scrollbar-thin space-y-1 ${compact ? 'text-[11px]' : ''}`}>
          {cartItems.map((item) => (
            <div key={item.productId} className="flex items-center justify-between gap-2 py-0.5">
              <div className="min-w-0 flex-1">
                <p className="truncate">{item.productName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {item.quantity} × {formatKES(item.pricePerUnit)}
                  {item.discountPercent && item.discountPercent > 0 ? ` · -${item.discountPercent}%` : ''}
                </p>
              </div>
              <span className="font-medium shrink-0">{formatKES(item.lineTotal)}</span>
            </div>
          ))}
        </div>
        <Separator />
        <div className="space-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal (VAT incl.)</span>
            <span>{formatKES(summarySubtotal)}</span>
          </div>
          {totalDiscount > 0 && (
            <div className="flex justify-between text-green-600">
              <span className="flex items-center gap-0.5"><Tag className="h-2.5 w-2.5" />Discount</span>
              <span>-{formatKES(totalDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (incl. in prices)</span>
            <span>{formatKES(summaryTax)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span className="text-gradient">{formatKES(finalTotal)}</span>
          </div>
        </div>
      </div>
    );
  };

  // Success screen — shown briefly when mpesaStatus === 'success'
  const renderSuccessScreen = () => (
    <div className="text-center py-6 space-y-3 animate-scale-in">
      <div className="relative mx-auto w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-green-100 dark:bg-green-950/40 animate-ping opacity-75" />
        <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-green-600 text-white shadow-lg">
          <Check className="h-8 w-8" />
        </div>
      </div>
      <div>
        <p className="text-lg font-bold text-green-700 dark:text-green-400">Payment Authorised!</p>
        <p className="text-sm text-muted-foreground">
          M-Pesa STK push was accepted. Tap &ldquo;Complete Sale&rdquo; to finalise the receipt.
        </p>
      </div>
    </div>
  );

  // Framer-motion variants for step slide transitions (respects prefers-reduced-motion)
  const stepVariants = {
    enter: (dir: 'right' | 'left') => ({
      opacity: 0,
      x: prefersReducedMotion ? 0 : dir === 'right' ? 24 : -24,
    }),
    center: {
      opacity: 1,
      x: 0,
    },
    exit: (dir: 'right' | 'left') => ({
      opacity: 0,
      x: prefersReducedMotion ? 0 : dir === 'right' ? -24 : 24,
    }),
  };

  const stepTransition = {
    duration: prefersReducedMotion ? 0.15 : 0.3,
    ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        // Prevent closing while STK push is actively processing
        if (!o && mpesaStatus === 'processing') return;
        onOpenChange(o);
      }}
      title={
        <span className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          Complete Payment
          {step > 1 && (
            <Badge variant="outline" className="text-[10px] ml-1">Step {step}/3</Badge>
          )}
        </span>
      }
      description={
        <span className="break-words">
          Total: <span className="font-bold text-primary">{formatKES(finalTotal)}</span>
          {totalDiscount > 0 && (
            <span className="text-green-600 text-xs ml-2">(Save {formatKES(totalDiscount)})</span>
          )}
        </span>
      }
      size="md"
      footer={renderFooter()}
    >
      <div className="space-y-4">
        {/* Step progress indicator — always visible */}
        {mpesaStatus !== 'success' && renderStepIndicator()}

        {/* === SUCCESS SCREEN (overrides steps) === */}
        {mpesaStatus === 'success' ? (
          renderSuccessScreen()
        ) : (
          <AnimatePresence mode="wait" custom={stepDirection} initial={false}>
            {/* === STEP 1: Customer & Payment Method === */}
            {step === 1 && (
              <motion.div
                key="step-1"
                custom={stepDirection}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={stepTransition}
                className="space-y-4"
              >
                {/* Customer summary */}
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    Customer
                  </Label>
                  <div className="mt-2 p-3 rounded-lg border bg-muted/30 flex items-center gap-2">
                    {customer ? (
                      <>
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>{customer.name.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{customer.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {customer.phone || 'No phone'} · Debt limit {formatKES(customer.debtLimit)}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>W</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">Walk-in Customer</p>
                          <p className="text-xs text-muted-foreground">No customer account selected</p>
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Change customer from the cart sidebar before opening checkout.
                  </p>
                </div>

                <Separator />

                {/* Payment Method Selector — Cash, Debt, Either/Split, M-Pesa
                     Each card has icon, name, and selected state with gradient border */}
                <div>
                  <Label className="text-sm font-medium">Payment Method</Label>
                  <RadioGroup
                    value={paymentMethod}
                    onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2"
                  >
                    {PAYMENT_METHODS.map((m) => {
                      const Icon = m.icon;
                      const isSelected = paymentMethod === m.value;
                      return (
                        <div key={m.value} className="relative">
                          <RadioGroupItem value={m.value} id={`pm-${m.value}`} className="peer sr-only" />
                          <Label
                            htmlFor={`pm-${m.value}`}
                            className={`payment-method-card relative flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer hover:bg-muted/50 text-center min-h-[80px] justify-center overflow-hidden transition-all ${
                              isSelected
                                ? `text-white bg-gradient-to-br ${m.selectedGradient} shadow-md`
                                : 'border-2 border-border text-foreground'
                            }`}
                          >
                            {/* Selected state sheen */}
                            {isSelected && (
                              <span
                                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent"
                                aria-hidden
                              />
                            )}
                            {/* Icon — circle with gradient when selected, plain when not */}
                            <span
                              className={`relative z-10 flex items-center justify-center h-9 w-9 rounded-full ${
                                isSelected
                                  ? 'bg-white/25 backdrop-blur-sm text-white'
                                  : m.iconGradient
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="relative z-10 text-xs font-semibold leading-tight">{m.label}</span>
                            <span className={`relative z-10 text-[10px] leading-tight line-clamp-2 break-words ${isSelected ? 'text-white/85' : 'text-muted-foreground'}`}>{m.desc}</span>
                          </Label>
                        </div>
                      );
                    })}
                  </RadioGroup>
                </div>

                {/* Order summary preview at bottom of step 1 */}
                {renderOrderSummary(true)}
              </motion.div>
            )}

            {/* === STEP 2: Payment Details === */}
            {step === 2 && (
              <motion.div
                key="step-2"
                custom={stepDirection}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={stepTransition}
                className="space-y-4"
              >
                {/* === CASH === */}
                {paymentMethod === 'CASH' && (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="cashReceived">Cash Received</Label>
                      <Input
                        id="cashReceived"
                        type="number"
                        placeholder="0"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        className="text-lg font-semibold mt-1"
                        autoFocus
                      />
                      {/* Quick cash buttons — exact, round up to 100/500/1000 */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {[
                          { label: 'Exact', amt: finalTotal },
                          { label: 'Round ↑', amt: Math.ceil(finalTotal / 100) * 100 },
                          { label: '+500', amt: Math.ceil(finalTotal / 500) * 500 },
                          { label: '+1000', amt: Math.ceil(finalTotal / 1000) * 1000 },
                        ].map((q, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setCashReceived(String(q.amt))}
                            className="quick-amount-btn px-2.5 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-gradient-to-br hover:from-emerald-50 hover:to-green-50 hover:border-emerald-300 dark:hover:from-emerald-950/40 dark:hover:to-green-950/30 dark:hover:border-emerald-700 hover:text-emerald-700 dark:hover:text-emerald-300 transition-all min-h-[40px] flex-1"
                          >
                            <span className="block text-[10px] text-muted-foreground leading-tight">{q.label}</span>
                            <span className="block font-bold leading-tight tabular-nums">{formatKES(q.amt)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {change > 0 && (
                      <div className="relative overflow-hidden p-4 rounded-lg bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/40 dark:to-green-950/30 border-2 border-emerald-200 dark:border-emerald-900 flex items-center justify-between animate-scale-in shadow-sm">
                        {/* Decorative gradient sweep on the left edge */}
                        <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-emerald-400 to-green-600" aria-hidden />
                        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 pl-1.5">
                          <Wallet className="h-5 w-5" />
                          Change Due
                        </span>
                        <span className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums tracking-tight">
                          {formatKES(change)}
                        </span>
                      </div>
                    )}
                    {cashReceived && Number(cashReceived) < finalTotal && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Insufficient amount</AlertTitle>
                        <AlertDescription>Need {formatKES(finalTotal - Number(cashReceived))} more</AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {/* === DEBT === */}
                {paymentMethod === 'DEBT' && (
                  <div className="space-y-3">
                    {!selectedCustomer || selectedCustomer === 'walk-in' ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Customer Required</AlertTitle>
                        <AlertDescription>
                          Please select a customer (not walk-in) from the cart sidebar before proceeding with debt payment.
                        </AlertDescription>
                      </Alert>
                    ) : customer ? (
                      <>
                        <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback>{customer.name.charAt(0).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{customer.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{customer.phone || 'No phone on file'}</p>
                            </div>
                          </div>
                          <Separator />
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Debt Limit</p>
                              <p className="font-semibold">{formatKES(customer.debtLimit)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Current Debt</p>
                              <p className="font-semibold">{formatKES(customer.currentDebtBalance)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Available</p>
                              <p className="font-semibold text-green-600">{formatKES(debtAvailable)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">This Sale</p>
                              <p className="font-semibold text-primary">{formatKES(finalTotal)}</p>
                            </div>
                          </div>
                        </div>
                        {exceedsDebt && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Exceeds Debt Limit</AlertTitle>
                            <AlertDescription>
                              This sale ({formatKES(finalTotal)}) exceeds the customer&rsquo;s available debt ({formatKES(debtAvailable)}).
                              Collect partial cash or increase the debt limit on the customer record.
                            </AlertDescription>
                          </Alert>
                        )}
                        <p className="text-xs text-muted-foreground">
                          On checkout, this sale will create a debt ledger entry against <span className="font-semibold">{customer.name}</span>&rsquo;s account.
                        </p>
                      </>
                    ) : null}
                  </div>
                )}

                {/* === SPLIT (Either) === */}
                {paymentMethod === 'SPLIT' && (
                  <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Split className="h-3 w-3" /> Split payment between Cash and M-Pesa
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="splitCash" className="text-xs flex items-center gap-1">
                          <Banknote className="h-3 w-3" /> Cash Amount
                        </Label>
                        <Input
                          id="splitCash"
                          type="number"
                          placeholder="0"
                          value={splitCashAmount}
                          onChange={(e) => {
                            setSplitCashAmount(e.target.value);
                            const remaining = finalTotal - Number(e.target.value);
                            if (remaining > 0) setSplitMpesaAmount(String(remaining));
                          }}
                          className="mt-1 text-sm font-semibold"
                          autoFocus
                        />
                      </div>
                      <div>
                        <Label htmlFor="splitMpesa" className="text-xs flex items-center gap-1">
                          <Smartphone className="h-3 w-3" /> M-Pesa Amount
                        </Label>
                        <Input
                          id="splitMpesa"
                          type="number"
                          placeholder="0"
                          value={splitMpesaAmount}
                          onChange={(e) => {
                            setSplitMpesaAmount(e.target.value);
                            const remaining = finalTotal - Number(e.target.value);
                            if (remaining > 0) setSplitCashAmount(String(remaining));
                          }}
                          className="mt-1 text-sm font-semibold"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="splitMpesaPhone" className="text-xs">M-Pesa Phone</Label>
                      <Input
                        id="splitMpesaPhone"
                        type="tel"
                        placeholder="0712 345 678"
                        value={mpesaPhone}
                        onChange={(e) => setMpesaPhone(e.target.value)}
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div className="text-xs flex justify-between">
                      <span className="text-muted-foreground">Total Entered:</span>
                      <span className={`font-semibold ${(Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0) >= finalTotal ? 'text-green-600' : 'text-amber-600'}`}>
                        {formatKES((Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0))}
                        {((Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0)) < finalTotal && (
                          <span className="ml-1">· short {formatKES(finalTotal - (Number(splitCashAmount) || 0) - (Number(splitMpesaAmount) || 0))}</span>
                        )}
                      </span>
                    </div>
                    {/* Show STK push state for split's mpesa portion */}
                    {isProcessingMpesa && <StkStatusPanel
                      status={mpesaStatus}
                      stkCheckoutRequestId={stkCheckoutRequestId}
                      stkResultDesc={stkResultDesc}
                      stkPolling={stkPolling}
                      amount={Number(splitMpesaAmount) || 0}
                    />}
                  </div>
                )}

                {/* === MPESA === */}
                {paymentMethod === 'MPESA' && (
                  <div className="space-y-3">
                    {mpesaStatus === 'idle' && (
                      <>
                        <div>
                          <Label htmlFor="mpesaPhone">M-Pesa Phone Number</Label>
                          <Input
                            id="mpesaPhone"
                            type="tel"
                            placeholder="0712 345 678"
                            value={mpesaPhone}
                            onChange={(e) => setMpesaPhone(e.target.value)}
                            className="mt-1"
                            autoFocus
                          />
                          <p className="text-[11px] text-muted-foreground mt-1">
                            An STK push will be sent to this number. The customer must enter their M-Pesa PIN to authorise the payment of <span className="font-semibold">{formatKES(finalTotal)}</span>.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
                          <Smartphone className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-[11px] text-green-700 dark:text-green-300">
                            Using Safaricom Daraja API. Need to check credentials or test callback?{' '}
                            <a href="https://daraja.safaricom.co.ke" target="_blank" rel="noopener noreferrer" className="font-semibold underline inline-flex items-center gap-0.5">
                              Open M-Pesa Daraja <ExternalLink className="h-3 w-3" />
                            </a>
                          </p>
                        </div>
                      </>
                    )}
                    {isProcessingMpesa && (
                      <StkStatusPanel
                        status={mpesaStatus}
                        stkCheckoutRequestId={stkCheckoutRequestId}
                        stkResultDesc={stkResultDesc}
                        stkPolling={stkPolling}
                        amount={finalTotal}
                      />
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* === STEP 3: Review & Confirm === */}
            {step === 3 && (
              <motion.div
                key="step-3"
                custom={stepDirection}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={stepTransition}
                className="space-y-4"
              >
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5" />
                    Review Your Order
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Please review the order details below. Tap &ldquo;Process Payment&rdquo; to complete the sale.
                  </p>
                </div>

                {/* Customer & payment method recap */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border bg-muted/30">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <User className="h-2.5 w-2.5" />
                      Customer
                    </p>
                    <p className="text-sm font-medium truncate">
                      {customer ? customer.name : 'Walk-in Customer'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg border bg-muted/30">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CreditCard className="h-2.5 w-2.5" />
                      Payment Method
                    </p>
                    <p className="text-sm font-medium">
                      {PAYMENT_METHODS.find(m => m.value === paymentMethod)?.label || paymentMethod}
                    </p>
                  </div>
                </div>

                {/* Order summary */}
                {renderOrderSummary(false)}

                {/* Method-specific confirmation details */}
                {paymentMethod === 'CASH' && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cash Received</span>
                      <span className="font-semibold">{cashReceived ? formatKES(Number(cashReceived)) : '—'}</span>
                    </div>
                    {change > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Change Due</span>
                        <span className="font-bold">{formatKES(change)}</span>
                      </div>
                    )}
                  </div>
                )}
                {paymentMethod === 'DEBT' && customer && (
                  <Alert>
                    <Wallet className="h-4 w-4" />
                    <AlertTitle>Debt Payment</AlertTitle>
                    <AlertDescription>
                      {formatKES(finalTotal)} will be added to {customer.name}&rsquo;s debt account.
                      Available credit after sale: {formatKES(Math.max(0, debtAvailable - finalTotal))}.
                    </AlertDescription>
                  </Alert>
                )}
                {paymentMethod === 'SPLIT' && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Banknote className="h-3 w-3" /> Cash Portion
                      </span>
                      <span className="font-semibold">{formatKES(Number(splitCashAmount) || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Smartphone className="h-3 w-3" /> M-Pesa Portion
                      </span>
                      <span className="font-semibold">{formatKES(Number(splitMpesaAmount) || 0)}</span>
                    </div>
                  </div>
                )}
                {paymentMethod === 'MPESA' && (
                  <Alert>
                    <Smartphone className="h-4 w-4" />
                    <AlertTitle>M-Pesa Payment</AlertTitle>
                    <AlertDescription>
                      STK push will be sent to <span className="font-semibold">{mpesaPhone || '—'}</span> for <span className="font-semibold">{formatKES(finalTotal)}</span>.
                    </AlertDescription>
                  </Alert>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </ResponsiveDialog>
  );
}
