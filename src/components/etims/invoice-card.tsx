'use client';

import { CheckCircle2, Clock, XCircle, Download, Eye, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QrCodeDisplay } from './qr-code-display';

interface InvoiceCardProps {
  invoice: {
    invoiceNumber: string;
    customerTin?: string;
    customerName: string;
    totalAmount: number;
    vatAmount: number;
    status: 'ISSUED' | 'PENDING' | 'CANCELLED' | 'FAILED';
    issuedAt?: Date | string;
    qrCode?: string;
    url?: string;
  };
  onView?: () => void;
  onCancel?: () => void;
  currency?: string;
  formatAmount?: (amount: number) => string;
}

const statusConfig = {
  ISSUED: {
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'Issued',
  },
  PENDING: {
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Pending',
  },
  CANCELLED: {
    icon: XCircle,
    color: 'text-rose-600',
    bg: 'bg-rose-50 border-rose-200',
    badge: 'bg-rose-100 text-rose-700',
    label: 'Cancelled',
  },
  FAILED: {
    icon: XCircle,
    color: 'text-rose-600',
    bg: 'bg-rose-50 border-rose-200',
    badge: 'bg-rose-100 text-rose-700',
    label: 'Failed',
  },
} as const;

export function InvoiceCard({
  invoice,
  onView,
  onCancel,
  currency: _currency = 'KES',
  formatAmount = (n) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`,
}: InvoiceCardProps) {
  const config = statusConfig[invoice.status] || statusConfig.PENDING;
  const StatusIcon = config.icon;
  const issuedDate = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not issued';

  return (
    <Card className={`p-4 border-2 ${config.bg} transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          <div className={`p-2 rounded-lg ${config.badge}`}>
            <StatusIcon className={`h-4 w-4 ${config.color}`} />
          </div>
          <div>
            <div className="font-mono text-sm font-semibold text-slate-900">
              {invoice.invoiceNumber}
            </div>
            <div className="text-xs text-muted-foreground">{issuedDate}</div>
          </div>
        </div>
        <Badge className={`${config.badge} border-0`}>{config.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs text-muted-foreground">Customer</div>
          <div className="text-sm font-medium text-slate-700 truncate">
            {invoice.customerName}
          </div>
          {invoice.customerTin && (
            <div className="text-xs font-mono text-muted-foreground">
              PIN: {invoice.customerTin}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total Amount</div>
          <div className="text-lg font-bold text-slate-900">
            {formatAmount(invoice.totalAmount)}
          </div>
          <div className="text-xs text-muted-foreground">
            VAT: {formatAmount(invoice.vatAmount)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex gap-1.5">
          {invoice.status === 'ISSUED' && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onView}>
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
              {invoice.qrCode && (
                <QrCodeDisplay
                  data={invoice.qrCode}
                  size={80}
                  invoiceNumber={invoice.invoiceNumber}
                />
              )}
              {invoice.url && (
                <a href={invoice.url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs">
                    <Download className="h-3 w-3 mr-1" />
                    Verify
                  </Button>
                </a>
              )}
            </>
          )}
        </div>
        {invoice.status === 'ISSUED' && onCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            onClick={onCancel}
          >
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}
