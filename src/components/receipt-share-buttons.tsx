'use client';

/**
 * ReceiptShareButtons - the shared Copy / WhatsApp / SMS action row used by
 * every receipt dialog (checkout preview, enhanced preview).
 *
 * v2.14.0 share-text spec:
 *   - The share text always carries store name, receipt #, date and total
 *     (see src/lib/receipt-share-text.ts).
 *   - If the customer has NO phone on file, tapping WhatsApp/SMS opens a
 *     prompt asking for one instead of failing silently into an app chooser;
 *     "Share without phone" keeps the old chooser behaviour.
 *   - Every share action ends in a toast confirmation.
 *   - Buttons are grid-friendly (no fixed widths, no truncation, icons stay
 *     inside their button at 320px).
 */

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Copy, Check, Share2, MessageSquare, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { openSMS, type TransactionItem } from '@/lib/api';
import type { StoreInfo } from '@/lib/store-info';
import { buildReceiptText, type ReceiptShareTextOptions } from '@/lib/receipt-share-text';
import { buildWhatsAppDeepLink, normalizeKenyanPhone } from '@/lib/whatsapp-receipt';

export interface ReceiptShareButtonsProps {
  transaction: TransactionItem;
  store: StoreInfo | undefined;
  /** Extra options merged into the share text builder (M-Pesa ref, gift card, voucher). */
  buildOpts: () => ReceiptShareTextOptions;
}

type ShareChannel = 'WHATSAPP' | 'SMS';

export function ReceiptShareButtons({ transaction, store, buildOpts }: ReceiptShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  // Non-null when the "no phone on file" prompt is open for that channel.
  const [promptChannel, setPromptChannel] = useState<ShareChannel | null>(null);
  const [promptPhone, setPromptPhone] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  const customerPhone = transaction.customer?.phone || '';

  const handleCopy = useCallback(() => {
    const text = buildReceiptText(transaction, store, buildOpts());
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Receipt copied to clipboard.');
    };
    navigator.clipboard.writeText(text).then(done).catch(() => {
      // Fallback for older browsers without the async clipboard API.
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      done();
    });
  }, [transaction, store, buildOpts]);

  const shareViaWhatsApp = useCallback((phone: string | null) => {
    const text = buildReceiptText(transaction, store, buildOpts());
    if (phone) {
      const url = buildWhatsAppDeepLink(phone, text);
      if (!url) {
        toast.error('That phone number is not a valid Kenyan mobile number.');
        return false;
      }
      window.open(url, '_blank', 'noopener');
    } else {
      // No recipient: open the WhatsApp app chooser with the text prefilled.
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
    toast.success('WhatsApp draft opened - press send to deliver the receipt.');
    return true;
  }, [transaction, store, buildOpts]);

  const shareViaSms = useCallback((phone: string | null) => {
    const text = buildReceiptText(transaction, store, buildOpts());
    openSMS(phone ?? '', text);
    toast.success('SMS draft opened - press send to deliver the receipt.');
  }, [transaction, store, buildOpts]);

  const handleWhatsApp = useCallback(() => {
    if (normalizeKenyanPhone(customerPhone)) {
      shareViaWhatsApp(customerPhone);
    } else {
      setPromptPhone('');
      setPromptError(null);
      setPromptChannel('WHATSAPP');
    }
  }, [customerPhone, shareViaWhatsApp]);

  const handleSms = useCallback(() => {
    if (normalizeKenyanPhone(customerPhone)) {
      shareViaSms(customerPhone);
    } else {
      setPromptPhone('');
      setPromptError(null);
      setPromptChannel('SMS');
    }
  }, [customerPhone, shareViaSms]);

  const handlePromptSend = useCallback(() => {
    const normalized = normalizeKenyanPhone(promptPhone);
    if (!normalized) {
      setPromptError('Enter a valid Kenyan mobile number, e.g. 0712 345 678.');
      return;
    }
    setPromptBusy(true);
    try {
      const ok = promptChannel === 'SMS' ? (shareViaSms(normalized), true) : shareViaWhatsApp(normalized);
      if (ok) {
        setPromptChannel(null);
        setPromptPhone('');
        setPromptError(null);
      }
    } finally {
      setPromptBusy(false);
    }
  }, [promptPhone, promptChannel, shareViaWhatsApp, shareViaSms]);

  const handlePromptSkip = useCallback(() => {
    if (promptChannel === 'SMS') shareViaSms(null);
    else shareViaWhatsApp(null);
    setPromptChannel(null);
    setPromptPhone('');
    setPromptError(null);
  }, [promptChannel, shareViaSms, shareViaWhatsApp]);

  return (
    <>
      <Button
        variant="outline"
        onClick={handleCopy}
        aria-label="Copy receipt text to clipboard"
        className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm"
      >
        {copied ? <Check className="h-4 w-4 shrink-0 text-green-500" /> : <Copy className="h-4 w-4 shrink-0" />}
        <span className="min-w-0">{copied ? 'Copied!' : 'Copy'}</span>
      </Button>
      <Button
        variant="outline"
        onClick={handleWhatsApp}
        aria-label="Share receipt via WhatsApp"
        className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/30"
      >
        <Share2 className="h-4 w-4 shrink-0" />
        <span className="min-w-0">WhatsApp</span>
      </Button>
      <Button
        variant="outline"
        onClick={handleSms}
        aria-label="Send receipt via SMS"
        title="Send receipt via SMS"
        className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
      >
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span className="min-w-0">SMS</span>
      </Button>

      {/* No phone on file - prompt instead of failing silently. */}
      <ResponsiveDialog
        open={promptChannel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPromptChannel(null);
            setPromptError(null);
          }
        }}
        title={
          <span className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Add recipient phone
          </span>
        }
        description={
          promptChannel === 'SMS'
            ? 'No phone number is on file for this customer. Enter one to send the SMS receipt.'
            : 'No phone number is on file for this customer. Enter one to send the WhatsApp receipt.'
        }
        size="sm"
        footer={
          <div className="flex w-full flex-wrap gap-2">
            <Button variant="outline" onClick={handlePromptSkip} className="flex-1 min-w-0">
              Share without phone
            </Button>
            <Button
              onClick={handlePromptSend}
              disabled={promptBusy}
              className="flex-1 min-w-0 bg-[#C2410C] text-white hover:bg-[#9A3412]"
            >
              {promptBusy && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
              Send
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+254712345678"
            aria-label="Customer phone number"
            value={promptPhone}
            autoFocus
            onChange={(e) => {
              setPromptPhone(e.target.value);
              if (promptError) setPromptError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePromptSend();
            }}
          />
          {promptError && (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {promptError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The receipt text (store, receipt number, date and total) is prefilled in the draft.
          </p>
        </div>
      </ResponsiveDialog>
    </>
  );
}
