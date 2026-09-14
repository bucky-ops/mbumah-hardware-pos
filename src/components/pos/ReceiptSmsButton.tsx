"use client";

// src/components/pos/ReceiptSmsButton.tsx
//
// Reusable "Send via SMS" receipt action (Task 21-d) — extracted from
// CheckoutReceipt so receipt SMS is also reachable from SalesHistory's local
// reprint dialog (which must NOT mount the store-wired CheckoutReceipt).
//
// Contract (POST /api/v1/sales/[id]/receipt-sms — Task 20-b):
//   • No request body — the message is built server-side from the persisted
//     transaction. Cookie auth (CASHIER+), BOLA-checked on the server.
//   • 200 → { status: "SENT" | "FAILED" | "MOCKED", maskedPhone, message }.
//     MOCKED means no AT_API_KEY is configured (send simulated, still logged).
//   • Errors → { error: string }; 400s include the 60-second spam guard
//     ("Receipt SMS was just sent"), held/walk-in/no-phone guards — all shown
//     verbatim as a toast so the server stays the single source of truth.
//   • Only the MASKED phone ever reaches the client (KDPA 2019).
//
// State lives per mount: the "Sent" lock clears when the surrounding dialog
// closes/remounts, and the server's 60s spam guard backstops double sends.

import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ReceiptSmsGatewayStatus = "SENT" | "FAILED" | "MOCKED";

interface ReceiptSmsResponse {
  status?: ReceiptSmsGatewayStatus;
  maskedPhone?: string | null;
  error?: string;
}

export interface ReceiptSmsButtonProps {
  /** Transaction (sale) id — used as the [id] path segment. */
  transactionId: string;
  /** Extra disable (e.g. parent still loading); also disabled while pending/sent. */
  disabled?: boolean;
  size?: "sm" | "default";
  /** Button caption; defaults to "Send via SMS" (history reprints pass "Resend via SMS"). */
  label?: string;
  /** Fired after a successful dispatch (status SENT | MOCKED). */
  onSent?: () => void;
}

export function ReceiptSmsButton({
  transactionId,
  disabled = false,
  size = "default",
  label = "Send via SMS",
  onSent,
}: ReceiptSmsButtonProps) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (pending || sent) return;
    setPending(true);
    try {
      const res = await fetch(`/api/v1/sales/${encodeURIComponent(transactionId)}/receipt-sms`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as ReceiptSmsResponse | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const masked = data?.maskedPhone ?? "customer";
      if (data?.status === "FAILED") {
        throw new Error("SMS gateway rejected the send — try again or use print");
      }
      if (data?.status === "MOCKED") {
        // No AT_API_KEY configured — queue simulated, still logged in SmsLog.
        toast.success(`Receipt SMS queued to ${masked} (mock gateway)`);
      } else {
        toast.success(`Receipt SMS sent to ${masked}`);
      }
      setSent(true);
      onSent?.();
    } catch (err) {
      // Server guard messages (60s spam window, held tickets, walk-ins, BOLA)
      // arrive as { error } and surface verbatim — retry stays available.
      toast.error(err instanceof Error ? err.message : "Could not send the receipt SMS");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() => void send()}
      disabled={disabled || pending || sent}
      aria-label={sent ? "Receipt SMS sent" : label}
      className={cn(
        sent && "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
      )}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : sent ? (
        <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
      ) : (
        <MessageSquare className="mr-2 h-4 w-4" aria-hidden />
      )}
      {sent ? "Sent" : label}
    </Button>
  );
}
