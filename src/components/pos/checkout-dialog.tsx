'use client';

import React, { useEffect } from 'react';
import { formatKES, type CustomerItem } from '@/lib/api';
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
import {
  CreditCard, Banknote, Wallet, Split, Smartphone,
  AlertCircle, Loader2, AlertTriangle, CheckCircle, ExternalLink,
} from 'lucide-react';

// ─── Shared checkout dialog (ResponsiveDialog) ───────────────────────────────
// Used by both desktop & mobile POS so the payment flow stays consistent.
// Order: Cash → Debt → Either/Split → M-Pesa.

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
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'CASH', label: 'Cash', icon: Banknote, desc: 'Receive cash & give change' },
  { value: 'DEBT', label: 'Debt', icon: Wallet, desc: 'Put it on a customer account' },
  { value: 'SPLIT', label: 'Either / Split', icon: Split, desc: 'Cash + M-Pesa combined' },
  { value: 'MPESA', label: 'M-Pesa', icon: Smartphone, desc: 'STK push to customer phone' },
];

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
  } = props;

  const customer = customers.find((c) => c.id === selectedCustomer);
  const debtAvailable = customer ? Math.max(0, customer.debtLimit - customer.currentDebtBalance) : 0;
  const exceedsDebt = customer ? finalTotal > debtAvailable : false;

  const cashValid = !!cashReceived && Number(cashReceived) >= finalTotal;
  const splitValid = (Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0) >= finalTotal && (Number(splitMpesaAmount) || 0) > 0 ? !!mpesaPhone && mpesaPhone.length >= 9 : true;
  const mpesaValid = !!mpesaPhone && mpesaPhone.length >= 9;

  // Reset M-Pesa status when payment method changes (away from MPESA)
  useEffect(() => {
    if (paymentMethod !== 'MPESA' && paymentMethod !== 'SPLIT' && mpesaStatus !== 'idle') {
      setMpesaStatus('idle');
    }
  }, [paymentMethod, mpesaStatus, setMpesaStatus]);

  const isProcessingMpesa = mpesaStatus === 'processing' || mpesaStatus === 'success' || mpesaStatus === 'failed';
  const showMpesaPanel = (paymentMethod === 'MPESA' || paymentMethod === 'SPLIT');

  // Build the footer buttons depending on state
  const renderFooter = () => {
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
            className="bg-green-600 hover:bg-green-700 text-white"
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
    // Default: idle — show Cancel + Complete Sale / Send STK Push
    const canComplete =
      (paymentMethod === 'CASH' && cashValid) ||
      (paymentMethod === 'DEBT' && !!selectedCustomer && !exceedsDebt) ||
      (paymentMethod === 'SPLIT' && splitValid);

    if (showMpesaPanel && !isProcessingMpesa) {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSendStkPush}
            disabled={mpesaMutation.isPending || !mpesaValid}
            className="bg-green-600 hover:bg-green-700 text-white"
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
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          onClick={onCompleteSale}
          disabled={checkoutMutation.isPending || !canComplete}
          className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
        >
          {checkoutMutation.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
          ) : (
            <><CheckCircle className="mr-2 h-4 w-4" />Complete Sale</>
          )}
        </Button>
      </>
    );
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
        {/* Payment Method Selector — Cash, Debt, Either/Split, M-Pesa */}
        <div>
          <Label className="text-sm font-medium">Payment Method</Label>
          <RadioGroup
            value={paymentMethod}
            onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2"
          >
            {PAYMENT_METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.value}>
                  <RadioGroupItem value={m.value} id={`pm-${m.value}`} className="peer sr-only" />
                  <Label
                    htmlFor={`pm-${m.value}`}
                    className="flex flex-col items-center gap-1.5 p-3 border-2 rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors text-center min-h-[80px] justify-center"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-semibold leading-tight">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight line-clamp-2 break-words">{m.desc}</span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>

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
              />
              {/* Quick cash buttons */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[finalTotal, Math.ceil(finalTotal / 100) * 100, Math.ceil(finalTotal / 500) * 500, Math.ceil(finalTotal / 1000) * 1000].map((amt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCashReceived(String(amt))}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-muted transition-colors min-h-[36px]"
                  >
                    {formatKES(amt)}
                  </button>
                ))}
              </div>
            </div>
            {change > 0 && (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg flex items-center justify-between">
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Change Due</span>
                <span className="text-lg font-bold text-green-700 dark:text-green-400">{formatKES(change)}</span>
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
      </div>
    </ResponsiveDialog>
  );
}
