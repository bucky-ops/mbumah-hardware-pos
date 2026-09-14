"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Smartphone, X, XCircle } from "lucide-react";
import { formatKES } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ─────────────────────────────────────────────────────────────────────────────
// M-Pesa STK checkout — EXACT state machine per spec Task 3.2.
//
// TRANSITION TABLE (single `phase` state variable):
//
//   IDLE         ──Send STK (valid phone)──▶  SENDING_STK
//   SENDING_STK  ──POST /stk 200──▶           AWAITING_PIN
//   SENDING_STK  ──network/4xx error──▶       FAILED          → onFailed(desc)
//   AWAITING_PIN ──4s elapsed──▶              POLLING         (polling actually runs
//                                                from t=0 every 2s; phase only relabels)
//   AWAITING_PIN ──45s timeout──▶             TIMEOUT         (amber; server keeps verifying)
//   POLLING      ──status=SUCCESS (≤45s)──▶   SUCCESS         → onPaid(receiptNo) ONCE
//   POLLING      ──status=FAILED──▶           FAILED          → onFailed(desc) ONCE
//   POLLING      ──45s timeout──▶             TIMEOUT
//   FAILED       ──Retry──▶                   SENDING_STK     (fresh STK push)
//   TIMEOUT      ──Retry──▶                   SENDING_STK     (fresh STK push)
//   any          ──Cancel──▶                  onCancel()      (timers + fetch aborted)
//
// POLLING: GET /api/v1/payments/mpesa/status?checkoutRequestId=… every 2s with
// an AbortController per tick (previous tick aborted). Server-side spoof
// resistance is handled by the status route (Daraja cross-verification).
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "IDLE" | "SENDING_STK" | "AWAITING_PIN" | "POLLING" | "SUCCESS" | "FAILED" | "TIMEOUT";

const STK_TIMEOUT_S = 45; // spec: 45s customer-PIN window
const POLL_INTERVAL_MS = 2_000; // spec: poll every 2 seconds
const POLLING_LABEL_DELAY_MS = 4_000; // relabel AWAITING_PIN → POLLING after 4s
const PHONE_PATTERN = /^(\+?254|0)(7|1)\d{8}$/;

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface MPesaCheckoutModalProps {
  amount: number;
  /** Cart/sale reference — sent as transactionId and used as the STK account reference. */
  ref: string;
  customerPhone?: string;
  /** Fired EXACTLY once when the payment settles successfully. */
  onPaid: (receiptNo: string) => void;
  onFailed: (desc: string) => void;
  onCancel: () => void;
}

export function MPesaCheckoutModal({ amount, ref: saleRef, customerPhone, onPaid, onFailed, onCancel }: MPesaCheckoutModalProps) {
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [errorDesc, setErrorDesc] = useState<string | null>(null);
  const [receiptNo, setReceiptNo] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(STK_TIMEOUT_S);

  const paidFiredRef = useRef(false);
  const checkoutIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Latest-callback refs so interval closures never fire stale handlers.
  const onPaidRef = useRef(onPaid);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onPaidRef.current = onPaid;
    onFailedRef.current = onFailed;
  }, [onPaid, onFailed]);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (relabelTimerRef.current) clearTimeout(relabelTimerRef.current);
    pollTimerRef.current = null;
    countdownTimerRef.current = null;
    relabelTimerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const startTimers = useCallback(() => {
    // Countdown ring — drives the 45s TIMEOUT transition.
    countdownTimerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          clearTimers();
          // SUCCESS/FAILED win the race against the timeout.
          setPhase((p) => (p === "SUCCESS" || p === "FAILED" ? p : "TIMEOUT"));
          return 0;
        }
        return s - 1;
      });
    }, 1_000);

    // Relabel to POLLING after the first couple of ticks (UI only).
    relabelTimerRef.current = setTimeout(() => {
      setPhase((p) => (p === "AWAITING_PIN" ? "POLLING" : p));
    }, POLLING_LABEL_DELAY_MS);

    // Poll every 2 seconds (spec) with per-tick AbortController cleanup.
    pollTimerRef.current = setInterval(async () => {
      const checkoutRequestId = checkoutIdRef.current;
      if (!checkoutRequestId) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(
          `/api/v1/payments/mpesa/status?checkoutRequestId=${encodeURIComponent(checkoutRequestId)}`,
          { signal: ac.signal, cache: "no-store" }
        );
        if (!res.ok) return; // transient error — the next tick retries
        const data = (await res.json()) as {
          status: string;
          mpesaReceipt: string | null;
          resultDesc: string | null;
        };
        if (data.status === "SUCCESS") {
          clearTimers();
          setReceiptNo(data.mpesaReceipt ?? "—");
          setPhase("SUCCESS");
          if (!paidFiredRef.current) {
            paidFiredRef.current = true;
            onPaidRef.current(data.mpesaReceipt ?? "");
          }
        } else if (data.status === "FAILED") {
          clearTimers();
          const desc = data.resultDesc ?? "M-Pesa payment failed";
          setErrorDesc(desc);
          setPhase("FAILED");
          if (!paidFiredRef.current) {
            paidFiredRef.current = true;
            onFailedRef.current(desc);
          }
        }
      } catch {
        // aborted or network hiccup — keep polling until the 45s window closes
      }
    }, POLL_INTERVAL_MS);
  }, [clearTimers]);

  const initiate = useCallback(
    async (phoneNumber: string) => {
      clearTimers();
      setErrorDesc(null);
      setReceiptNo(null);
      paidFiredRef.current = false;
      setRemaining(STK_TIMEOUT_S);
      setPhase("SENDING_STK");
      try {
        const res = await fetch("/api/v1/payments/mpesa/stk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phoneNumber, amount, transactionId: saleRef, purpose: "SALE" }),
        });
        const data = (await res.json().catch(() => ({}))) as { checkoutRequestId?: string; error?: string };
        if (!res.ok || !data.checkoutRequestId) {
          throw new Error(data.error ?? `STK push failed (HTTP ${res.status})`);
        }
        checkoutIdRef.current = data.checkoutRequestId;
        setPhase("AWAITING_PIN");
        startTimers();
      } catch (err) {
        const desc = err instanceof Error ? err.message : "Failed to send STK push";
        setErrorDesc(desc);
        setPhase("FAILED");
        if (!paidFiredRef.current) {
          paidFiredRef.current = true;
          onFailedRef.current(desc);
        }
      }
    },
    [amount, saleRef, clearTimers, startTimers]
  );

  const phoneValid = PHONE_PATTERN.test(phone.trim());
  const waiting = phase === "AWAITING_PIN" || phase === "POLLING";
  const ringColor = remaining <= 10 ? "#f59e0b" : "#059669"; // amber when window is closing

  return (
    <div className="flex flex-col gap-4">
      {phase === "IDLE" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="mpesa-phone">Customer phone (receives the STK prompt)</Label>
            <Input
              id="mpesa-phone"
              inputMode="tel"
              placeholder="07XX XXX XXX or 2547XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </div>
          <p className="text-sm text-stone-500">
            An M-Pesa prompt for <span className="font-semibold text-stone-800">{formatKES(amount)}</span> will pop up on the
            customer&apos;s phone. They enter their PIN to approve.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!phoneValid}
              onClick={() => void initiate(phone.trim())}
            >
              <Smartphone className="mr-2 h-4 w-4" />
              Send STK Push
            </Button>
          </div>
        </>
      )}

      {phase === "SENDING_STK" && (
        <div className="flex flex-col items-center gap-3 py-8 text-stone-600">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm">Sending STK push to {phone}…</p>
        </div>
      )}

      {waiting && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative h-16 w-16">
            <Smartphone className="absolute inset-0 m-auto h-7 w-7 animate-pulse text-emerald-600" />
            <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
              <circle cx="32" cy="32" r={RADIUS} fill="none" stroke="#e7e5e4" strokeWidth="4" />
              <circle
                cx="32"
                cy="32"
                r={RADIUS}
                fill="none"
                stroke={ringColor}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - remaining / STK_TIMEOUT_S)}
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-stone-700">
            {phase === "AWAITING_PIN" ? "Awaiting customer M-Pesa PIN…" : "Confirming payment with Daraja…"}
          </p>
          <p className="text-xs text-stone-500">
            {formatKES(amount)} · {remaining}s remaining
          </p>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="mr-1 h-3 w-3" /> Cancel
          </Button>
        </div>
      )}

      {phase === "SUCCESS" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
          <p className="font-semibold text-emerald-700">Payment received</p>
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
            Receipt {receiptNo ?? "—"}
          </Badge>
        </div>
      )}

      {phase === "FAILED" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <XCircle className="h-10 w-10 text-rose-600" />
          <p className="font-semibold text-rose-700">Payment failed</p>
          <p className="max-w-xs text-center text-sm text-stone-600">{errorDesc ?? "The M-Pesa request was not completed."}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!phoneValid}
              onClick={() => void initiate(phone.trim())}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      {phase === "TIMEOUT" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700">
            ?
          </div>
          <p className="font-semibold text-amber-700">Confirmation window timed out</p>
          <p className="max-w-xs text-center text-sm text-stone-600">
            Verification continues server-side — POS remains usable; the sale will reconcile automatically.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!phoneValid}
              onClick={() => void initiate(phone.trim())}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
