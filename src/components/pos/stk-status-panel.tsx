'use client';

import { formatKES } from '@/lib/api';
import { Loader2, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';

export function StkStatusPanel({
  status, stkCheckoutRequestId, stkResultDesc, stkPolling, amount,
}: {
  status: 'processing' | 'success' | 'failed';
  stkCheckoutRequestId: string;
  stkResultDesc: string;
  stkPolling: boolean;
  amount: number;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={`px-3 py-2 text-xs font-semibold flex items-center justify-between ${
        status === 'success' ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
        : status === 'failed' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
        : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
      }`}>
        <span className="flex items-center gap-1.5">
          {status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status === 'success' && <CheckCircle className="h-3.5 w-3.5" />}
          {status === 'failed' && <AlertCircle className="h-3.5 w-3.5" />}
          {status === 'processing' ? 'STK Push Sent — Awaiting PIN' : status === 'success' ? 'Payment Confirmed' : 'Payment Failed'}
        </span>
        <span className="font-mono">{formatKES(amount)}</span>
      </div>
      <div className="p-3 space-y-2 text-xs">
        {stkCheckoutRequestId && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">CheckoutRequestID:</span>
            <span className="font-mono break-all text-right">{stkCheckoutRequestId}</span>
          </div>
        )}
        {stkResultDesc && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Status:</span>
            <span className="break-words text-right">{stkResultDesc}</span>
          </div>
        )}
        {status === 'processing' && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-muted-foreground flex items-center gap-1">
              <RefreshCw className={`h-3 w-3 ${stkPolling ? 'animate-spin' : ''}`} />
              {stkPolling ? 'Polling Safaricom every 5s…' : 'Waiting…'}
            </span>
            <a
              href="https://daraja.safaricom.co.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Daraja <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
