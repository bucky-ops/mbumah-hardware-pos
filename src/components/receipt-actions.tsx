'use client';

// Reusable receipt action buttons: Send via WhatsApp, Send via Email, Edit,
// and Delete (soft-cancel). Designed to be dropped into any receipt UI —
// the POS receipt dialog, a receipts list row, or a receipt detail page.
//
// The component is intentionally server-agnostic: it just calls the
// `/api/receipts/[id]/*` endpoints and reports success via toast + optional
// callbacks. All formatting / link-building / audit logging happens
// server-side (see `src/lib/receipt-delivery.ts` and
// `src/app/api/receipts/[id]/send/route.ts`).

import * as React from 'react';
import { toast } from 'sonner';
import {
  MessageCircle,
  Mail,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptActionsProps {
  receiptId: string;
  transactionId: string;
  customerPhone?: string;
  customerEmail?: string;
  receiptNumber: string;
  /** Initial receiptType shown in the edit dialog. */
  receiptType?: string;
  /** Initial notes shown in the edit dialog (from the linked transaction). */
  notes?: string | null;
  /** Called after a successful send (WhatsApp or Email). */
  onSent?: (channel: 'WHATSAPP' | 'EMAIL') => void;
  /** Called after a successful edit. */
  onEdited?: () => void;
  /** Called after a successful delete (cancel). */
  onDeleted?: () => void;
  variant?: 'default' | 'compact' | 'dropdown';
  size?: 'sm' | 'default';
  className?: string;
}

// ── Internal fetch helper ────────────────────────────────────────────────────

async function authedFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  // Attach CSRF token for state-changing requests.
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (typeof document !== 'undefined') {
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      if (csrfMatch) headers['X-CSRF-Token'] = csrfMatch[1];
    }
  }
  return fetch(endpoint, { ...options, headers, credentials: 'same-origin' });
}

// ── Constants ────────────────────────────────────────────────────────────────

const RECEIPT_TYPE_OPTIONS = [
  { value: 'DIGITAL', label: 'Digital' },
  { value: 'PRINTED', label: 'Printed' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export function ReceiptActions({
  receiptId,
  transactionId,
  customerPhone,
  customerEmail,
  receiptNumber,
  receiptType,
  notes,
  onSent,
  onEdited,
  onDeleted,
  variant = 'default',
  size = 'default',
  className,
}: ReceiptActionsProps) {
  // Sending state
  const [sendingWhatsApp, setSendingWhatsApp] = React.useState(false);
  const [sendingEmail, setSendingEmail] = React.useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = React.useState(false);
  const [editReceiptType, setEditReceiptType] = React.useState<string>(
    receiptType || 'DIGITAL'
  );
  const [editNotes, setEditNotes] = React.useState<string>(notes || '');
  const [saving, setSaving] = React.useState(false);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Keep the edit dialog in sync when props change (e.g. the parent refetches
  // the receipt and passes a new receiptType/notes).
  React.useEffect(() => {
    if (editOpen) {
      setEditReceiptType(receiptType || 'DIGITAL');
      setEditNotes(notes || '');
    }
  }, [editOpen, receiptType, notes]);

  // ── Send via WhatsApp ──────────────────────────────────────────────────────

  const handleSendWhatsApp = async () => {
    if (!customerPhone) {
      toast.error('No customer phone on file', {
        description:
          'Attach a customer with a phone number to the transaction, or send from the customer record.',
      });
      return;
    }
    setSendingWhatsApp(true);
    try {
      const res = await authedFetch(`/api/receipts/${receiptId}/send`, {
        method: 'POST',
        body: JSON.stringify({ channel: 'WHATSAPP', phone: customerPhone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to send receipt (${res.status})`);
      }
      const waLink = json.waLink as string | undefined;
      if (waLink && typeof window !== 'undefined') {
        window.open(waLink, '_blank', 'noopener,noreferrer');
      }
      toast.success('WhatsApp receipt ready', {
        description: `Opened wa.me for ${receiptNumber}.`,
      });
      onSent?.('WHATSAPP');
    } catch (err) {
      toast.error('Could not send WhatsApp receipt', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  // ── Send via Email ─────────────────────────────────────────────────────────

  const handleSendEmail = async () => {
    if (!customerEmail) {
      toast.error('No customer email on file', {
        description:
          'Attach a customer with an email to the transaction, or send from the customer record.',
      });
      return;
    }
    setSendingEmail(true);
    try {
      const res = await authedFetch(`/api/receipts/${receiptId}/send`, {
        method: 'POST',
        body: JSON.stringify({ channel: 'EMAIL', email: customerEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to send receipt (${res.status})`);
      }
      const mailtoLink = json.mailtoLink as string | undefined;
      if (mailtoLink && typeof window !== 'undefined') {
        // mailto: links are best opened via location.href — window.open is
        // blocked by some browsers as a popup for non-http(s) schemes.
        window.location.href = mailtoLink;
      }
      toast.success('Email receipt ready', {
        description: `Opened mail composer for ${receiptNumber}.`,
      });
      onSent?.('EMAIL');
    } catch (err) {
      toast.error('Could not send email receipt', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSendingEmail(false);
    }
  };

  // ── Edit (PUT) ─────────────────────────────────────────────────────────────

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await authedFetch(`/api/receipts/${receiptId}`, {
        method: 'PUT',
        body: JSON.stringify({
          receiptType: editReceiptType,
          notes: editNotes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to update receipt (${res.status})`);
      }
      toast.success('Receipt updated', {
        description: `Receipt ${receiptNumber} saved.`,
      });
      setEditOpen(false);
      onEdited?.();
    } catch (err) {
      toast.error('Could not update receipt', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete (soft-cancel via DELETE) ────────────────────────────────────────

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await authedFetch(`/api/receipts/${receiptId}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to cancel receipt (${res.status})`);
      }
      toast.success('Receipt cancelled', {
        description: `Receipt ${receiptNumber} has been voided.`,
      });
      setDeleteOpen(false);
      onDeleted?.();
    } catch (err) {
      toast.error('Could not cancel receipt', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const buttonSize = size === 'sm' ? 'sm' : 'default';
  const iconOnly = variant === 'compact';

  const whatsappBtn = (
    <Button
      type="button"
      variant="outline"
      size={buttonSize}
      onClick={handleSendWhatsApp}
      disabled={sendingWhatsApp || sendingEmail || deleting || saving}
      className="border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950"
      title="Send receipt via WhatsApp"
      aria-label="Send receipt via WhatsApp"
    >
      {sendingWhatsApp ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageCircle className="h-4 w-4" />
      )}
      {!iconOnly && <span>WhatsApp</span>}
    </Button>
  );

  const emailBtn = (
    <Button
      type="button"
      variant="outline"
      size={buttonSize}
      onClick={handleSendEmail}
      disabled={sendingWhatsApp || sendingEmail || deleting || saving}
      className="border-blue-600 text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-950"
      title="Send receipt via Email"
      aria-label="Send receipt via Email"
    >
      {sendingEmail ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mail className="h-4 w-4" />
      )}
      {!iconOnly && <span>Email</span>}
    </Button>
  );

  const editBtn = (
    <Button
      type="button"
      variant="outline"
      size={buttonSize}
      onClick={() => setEditOpen(true)}
      disabled={sendingWhatsApp || sendingEmail || deleting || saving}
      title="Edit receipt"
      aria-label="Edit receipt"
    >
      <Pencil className="h-4 w-4" />
      {!iconOnly && <span>Edit</span>}
    </Button>
  );

  const deleteBtn = (
    <Button
      type="button"
      variant="outline"
      size={buttonSize}
      onClick={() => setDeleteOpen(true)}
      disabled={sendingWhatsApp || sendingEmail || deleting || saving}
      className="border-red-600 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950"
      title="Cancel / void receipt"
      aria-label="Cancel / void receipt"
    >
      <Trash2 className="h-4 w-4" />
      {!iconOnly && <span>Cancel</span>}
    </Button>
  );

  return (
    <>
      <div
        className={
          className
            ? className
            : 'flex flex-wrap items-center gap-2'
        }
        data-receipt-actions={receiptId}
        data-transaction-id={transactionId}
      >
        {whatsappBtn}
        {emailBtn}
        {editBtn}
        {deleteBtn}
      </div>

      {/* ── Edit Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
            <DialogDescription>
              Receipt <span className="font-mono">{receiptNumber}</span>. Notes
              are stored on the underlying transaction.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="receipt-type-select">Receipt Type</Label>
              <Select value={editReceiptType} onValueChange={setEditReceiptType}>
                <SelectTrigger id="receipt-type-select" className="w-full">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {RECEIPT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt-notes">Notes</Label>
              <Textarea
                id="receipt-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Optional notes for this transaction (printed on the receipt)…"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Notes are written to the linked transaction and will appear on
                re-printed receipts.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete (cancel) confirmation ────────────────────────────────── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this receipt?</AlertDialogTitle>
            <AlertDialogDescription>
              This will void receipt{' '}
              <span className="font-mono font-semibold">{receiptNumber}</span>.
              The row is preserved for the audit trail (soft-delete) and the
              action is logged. This cannot be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/20 dark:bg-red-600 dark:hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cancelling…
                </>
              ) : (
                'Cancel receipt'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ReceiptActions;
