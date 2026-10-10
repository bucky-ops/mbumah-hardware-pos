'use client';

// MessagePreviewDialog - enlarged, scrollable WhatsApp/SMS output (v2.8.0)
//
// CLIENT REQUEST: "WhatsApp & SMS output is not visible enough - enlarge the
// display size to be more visible, OR add a scrolling option." Previously the
// composed message text was NEVER shown on screen: the app built it on the
// server, discarded `res.message`, and just window.open'd the wa.me/sms:
// link (often popup-blocked, so the user saw nothing but a "sent" toast).
//
// Now every WhatsApp/SMS send (invoices, delivery notes, vouchers) opens this
// preview FIRST: the full message in a large, scrollable, copyable box, then
// an explicit user-gesture button opens the actual wa.me / sms: link (which
// also fixes popup blocking) - and a Copy button as the universal fallback.
//
// VF-1 (v2.8.0) EXTENSION - honest delivery status: the dialog now accepts
// optional `status` ('SENT' | 'FAILED' | 'SIMULATED') + `error` props so the
// voucher-send flow can show the REAL gateway outcome (green Sent / amber
// Failed / blue Simulated) above the message box, with the unconfigured-
// gateway warning panel and its Open-in-app / Copy fallbacks. All new props
// are optional - the plain invoice/delivery-note preview flow is unchanged.

import { useState } from 'react';
import { Copy, Check, ExternalLink, MessageCircle, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export type PreviewChannel = 'whatsapp' | 'sms';

/** Honest gateway outcome for a send (VF-1) - omit for a plain preview. */
export type PreviewDeliveryStatus = 'SENT' | 'FAILED' | 'SIMULATED';

interface MessagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: PreviewChannel;
  /** E.164 or local digits; empty → wa.me chooser / sms body-only link. */
  phone?: string;
  /** The FULL message the recipient will receive. */
  message: string;
  /** Dialog title, e.g. "WhatsApp - INV-2026-0001". */
  title?: string;
  /** Optional server-built wa.me link (used verbatim when provided). */
  waLink?: string;
  /** VF-1: gateway outcome - renders the Sent/Failed/Simulated status strip. */
  status?: PreviewDeliveryStatus;
  /** VF-1: gateway/config error text shown in the amber warning panel. */
  error?: string;
}

/** Normalise a local number (07… / +2547…) to an international 2547… form. */
export function normalizeKePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
}

export function MessagePreviewDialog({
  open,
  onOpenChange,
  channel,
  phone = '',
  message,
  title,
  waLink,
  status,
  error,
}: MessagePreviewDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success('Message copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy - please select the text manually.');
    }
  };

  // Deep link is opened from an explicit button click (user gesture), so
  // popup blockers no longer swallow it silently.
  const handleOpenApp = () => {
    if (channel === 'whatsapp') {
      // Prefer the server-built link (it carries the server-normalised phone
      // and the exact server message) - fall back to building it locally.
      const url = waLink || (() => {
        const clean = normalizeKePhone(phone);
        return clean
          ? `https://wa.me/${clean}?text=${encodeURIComponent(message)}`
          : `https://wa.me/?text=${encodeURIComponent(message)}`;
      })();
      window.open(url, '_blank', 'noopener');
    } else {
      const clean = normalizeKePhone(phone);
      const url = clean
        ? `sms:${clean}?body=${encodeURIComponent(message)}`
        : `sms:?body=${encodeURIComponent(message)}`;
      window.open(url, '_self');
    }
    onOpenChange(false);
  };

  const ChannelIcon = channel === 'whatsapp' ? MessageCircle : Smartphone;
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const defaultTitle = `${channelLabel} message preview`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="msg-preview-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ChannelIcon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {title || defaultTitle}
          </DialogTitle>
          <DialogDescription id="msg-preview-desc" className="text-xs">
            {phone
              ? `Review the exact ${channelLabel} output below before it opens in the app.`
              : `No phone number on file - the ${channelLabel} app will let you pick a recipient.`}
          </DialogDescription>
        </DialogHeader>

        {/* VF-1: honest delivery-status strip (only when a status is passed). */}
        {status && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {status === 'SENT' && (
                <>
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Sent
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Delivered to the {channelLabel} gateway.
                  </span>
                </>
              )}
              {status === 'SIMULATED' && (
                <>
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 gap-1">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Simulated
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    No {channelLabel} gateway configured - the message was NOT sent.
                  </span>
                </>
              )}
              {status === 'FAILED' && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800 gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Failed
                </Badge>
              )}
            </div>
            {status !== 'SENT' && (
              <div
                className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3"
                role="alert"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Not delivered - use the fallbacks below.
                  </p>
                  {error && (
                    <p className="text-xs text-amber-700 dark:text-amber-400/90 break-words mt-0.5">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ENLARGED + SCROLLABLE output box (the visibility fix). */}
        <div className="rounded-lg border bg-muted/40 p-4">
          <div
            className="whitespace-pre-wrap break-words text-sm sm:text-base leading-relaxed max-h-[45vh] overflow-y-auto pr-1"
            data-testid="message-preview-text"
          >
            {message || '(empty message)'}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCopy} className="gap-1.5">
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            Copy message
          </Button>
          <Button onClick={handleOpenApp} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in {channelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
