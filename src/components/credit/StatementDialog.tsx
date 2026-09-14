// src/components/credit/StatementDialog.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  BadgeCheck,
  MessageCircle,
  Printer,
  ReceiptText,
  RotateCw,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { formatKES } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

// ─────────────────────────────────────────────────────────────────────────────
// StatementDialog — per-customer credit statement (ledger timeline + print +
// WhatsApp share). Fetches GET /api/v1/credit/customers/[id]/statement
// (MANAGER+ server-side), renders the statement inline and offers:
//  • Print — standalone 80mm/A5-friendly HTML in a hidden iframe (srcdoc),
//    mirroring CheckoutReceipt's print technique.
//  • WhatsApp (direct) — wa.me deep link to the customer's chat with a short
//    payment reminder (needs phoneDigits from the API; hidden when the
//    customer has no phone).
//  • Share via WhatsApp — NUMBERLESS wa.me link carrying a plain-text
//    statement summary (name, as-of, closing balance, ≤8 most-recent ledger
//    lines). wa.me without a number opens WhatsApp's chat picker, so no
//    phone/PII crosses the URL. Disabled until the statement has loaded.
// Palette: emerald/amber/rose/slate/stone only.
// ─────────────────────────────────────────────────────────────────────────────

// M-Pesa paybill printed/shared on statements. NEXT_PUBLIC override for real
// deployments; fixed sandbox value otherwise (MPESA_PAYBILL is not configured).
const PAYBILL = process.env.NEXT_PUBLIC_MPESA_PAYBILL ?? "400200";

export interface StatementDialogProps {
  customerId: string | null;
  customerName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: SessionUser;
}

interface StatementInstallment {
  seq: number;
  amountDue: string;
  amountPaid: string;
  dueDate: string;
  status: string;
}
interface StatementPlan {
  id: string;
  frequency: string;
  totalAmount: string;
  downPayment: string;
  balanceRemaining: string;
  status: string;
  startDate: string;
  installments: StatementInstallment[];
}
interface StatementLedgerEntry {
  id: string;
  type: string; // CHARGE | PAYMENT | PENALTY | REFUND
  amount: string;
  previousBalance: string;
  newBalance: string;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  performedBy: string | null;
}
export interface StatementData {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    phoneDigits: string | null;
    kraPin: string | null;
    creditLimit: string;
    currentBalance: string;
    riskScore: number;
  };
  account: { id: string; status: string; totalDebt: string; creditLimit: string; createdAt: string } | null;
  summary: {
    outstanding: string;
    ledgerCharges: string;
    ledgerPayments: string;
    ledgerPenalties: string;
    ledgerRefunds: string;
    nextDueDate: string | null;
    nextDueAmount: string | null;
    activePlans: number;
    overdueInstallments: number;
    oldestDebtDays: number;
  };
  plans: StatementPlan[];
  ledger: StatementLedgerEntry[];
}

function accountChip(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900";
    case "SUSPENDED":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900";
    case "DEFAULTED":
      return "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900";
    default:
      return "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700";
  }
}

function statusChip(status: string): string {
  switch (status) {
    case "ACTIVE":
    case "PAID":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900";
    case "PARTIAL":
    case "PENDING":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900";
    case "OVERDUE":
    case "DEFAULTED":
      return "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900";
    default:
      return "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700"; // COMPLETED etc.
  }
}

/** Risk color rules — mirrors DebtAgingReport.riskChip. */
function riskChip(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 40) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-rose-100 text-rose-800 border-rose-200";
}

interface LedgerMeta {
  icon: LucideIcon;
  label: string;
  sign: "+" | "−" | "";
  chip: string; // icon chip classes
  tone: string; // signed-amount text color
}

const LEDGER_META: Record<string, LedgerMeta> = {
  CHARGE: {
    icon: ShoppingCart,
    label: "Charge",
    sign: "+",
    chip: "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400",
    tone: "text-rose-700 dark:text-rose-400",
  },
  PAYMENT: {
    icon: BadgeCheck,
    label: "Payment",
    sign: "−",
    chip: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  PENALTY: {
    icon: TriangleAlert,
    label: "Penalty",
    sign: "+",
    chip: "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
    tone: "text-amber-700 dark:text-amber-400",
  },
  REFUND: {
    icon: Undo2,
    label: "Refund",
    sign: "−",
    chip: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
    tone: "text-slate-700 dark:text-slate-300",
  },
};

function ledgerMeta(type: string): LedgerMeta {
  return (
    LEDGER_META[type] ?? {
      icon: ReceiptText,
      label: type.charAt(0) + type.slice(1).toLowerCase(),
      sign: "",
      chip: "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
      tone: "text-stone-700 dark:text-stone-300",
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Standalone 80mm-A5-friendly statement HTML for the hidden-iframe print. */
function buildStatementHtml(stmt: StatementData, generatedBy: string): string {
  const s = stmt.summary;
  const c = stmt.customer;
  const money = (v: string | null) => (v === null ? "—" : formatKES(v));

  const summaryRows: Array<[string, string]> = [
    ["Outstanding balance", formatKES(s.outstanding)],
    ["Credit limit", formatKES(c.creditLimit)],
    ["Ledger charges", formatKES(s.ledgerCharges)],
    ["Ledger payments", formatKES(s.ledgerPayments)],
    ["Ledger penalties", formatKES(s.ledgerPenalties)],
    ["Ledger refunds", formatKES(s.ledgerRefunds)],
    ["Active plans", String(s.activePlans)],
    ["Overdue installments", String(s.overdueInstallments)],
    ["Oldest debt", `${s.oldestDebtDays} day${s.oldestDebtDays === 1 ? "" : "s"}`],
    [
      "Next due",
      s.nextDueDate ? `${format(new Date(s.nextDueDate), "d MMM yyyy")} — ${money(s.nextDueAmount)}` : "—",
    ],
  ];

  const ledgerRows = stmt.ledger
    .map((l) => {
      const meta = ledgerMeta(l.type);
      const detail = escapeHtml(l.note ?? (l.referenceId ? `Ref ${l.referenceId}` : "—"));
      return `<div class="row"><span>${format(new Date(l.createdAt), "dd MMM yy HH:mm")} · ${escapeHtml(meta.label)}</span><span>${meta.sign}${formatKES(l.amount)}</span></div>
      <div class="row muted"><span>${detail}</span><span>Bal ${formatKES(l.newBalance)}</span></div>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Credit statement — ${escapeHtml(c.name)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; width: 74mm; margin: 0 auto; color: #111; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 12px; }
  .muted { font-size: 9px; color: #444; }
  .dashed { border-top: 1px dashed #555; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; line-height: 1.5; }
</style></head>
<body>
  <div class="center bold big">MBUMAH HARDWARE</div>
  <div class="center">CREDIT STATEMENT</div>
  <div class="dashed"></div>
  <div class="row"><span>Customer</span><span class="bold">${escapeHtml(c.name)}</span></div>
  <div class="row muted"><span>Phone</span><span>${escapeHtml(c.phone ?? "—")}</span></div>
  ${c.kraPin ? `<div class="row muted"><span>KRA PIN</span><span>${escapeHtml(c.kraPin)}</span></div>` : ""}
  <div class="row muted"><span>Account</span><span>${escapeHtml(stmt.account?.status ?? "No credit account")}</span></div>
  <div class="dashed"></div>
  ${summaryRows.map(([k, v]) => `<div class="row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join("")}
  <div class="dashed"></div>
  <div class="center bold">LEDGER HISTORY (LAST ${stmt.ledger.length})</div>
  ${ledgerRows || `<div class="center muted">No ledger activity.</div>`}
  <div class="dashed"></div>
  <div class="center muted">Generated ${format(new Date(), "dd MMM yyyy HH:mm")} by ${escapeHtml(generatedBy)}</div>
  <div class="center muted">Computer generated statement · Paybill ${PAYBILL}</div>
</body></html>`;
}

function buildWhatsAppMessage(stmt: StatementData): string {
  const s = stmt.summary;
  const lines: string[] = [
    `Hello ${stmt.customer.name},`,
    "",
    "Here is your Mbumah Hardware credit statement:",
    "",
    `Outstanding balance: ${formatKES(s.outstanding)}`,
  ];
  if (s.nextDueDate) {
    lines.push(
      `Next due: ${format(new Date(s.nextDueDate), "d MMM yyyy")} — ${formatKES(s.nextDueAmount ?? 0)}`
    );
  }
  lines.push("", `Pay via M-Pesa Paybill ${PAYBILL}.`, "", "Thank you for your business.", "— Mbumah Hardware");
  return lines.join("\n");
}

/**
 * Numberless wa.me share text built from the ALREADY-LOADED statement:
 * customer, as-of date, closing balance and up to 8 most-recent ledger lines
 * as "date — description — amount". Deliberately carries no phone number —
 * the client only ever holds masked PII; wa.me without a number lets the
 * user pick the chat themselves.
 */
function buildShareText(stmt: StatementData): string {
  const recent = stmt.ledger.slice(0, 8).map((l) => {
    const meta = ledgerMeta(l.type);
    const desc = l.note
      ? `${meta.label}: ${l.note}`
      : l.referenceId
        ? `${meta.label} (Ref ${l.referenceId})`
        : meta.label;
    return `${format(new Date(l.createdAt), "dd MMM yy")} — ${desc} — ${meta.sign}${formatKES(l.amount)}`;
  });
  const lines = [
    "MBUMAH HARDWARE — credit statement",
    `Customer: ${stmt.customer.name}`,
    `As of: ${format(new Date(), "d MMM yyyy")}`,
    `Closing balance: ${formatKES(stmt.summary.outstanding)}`,
  ];
  if (recent.length > 0) lines.push("", "Recent activity:", ...recent);
  else lines.push("", "No ledger activity yet.");
  lines.push("", `Pay via M-Pesa Paybill ${PAYBILL}.`);
  return lines.join("\n");
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading statement">
      <Skeleton className="h-16 rounded-lg" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );
}

export function StatementDialog({ customerId, customerName, open, onOpenChange, session }: StatementDialogProps) {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const fetchSeq = useRef(0);

  const load = useCallback(async () => {
    if (!customerId) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/v1/credit/customers/${encodeURIComponent(customerId)}/statement`);
      const json: unknown = await res.json().catch(() => ({}));
      if (seq !== fetchSeq.current) return; // stale response — a newer fetch took over
      if (!res.ok) {
        const msg = (json as { error?: string }).error ?? `Request failed (${res.status})`;
        setError({ status: res.status, message: msg });
      } else {
        setData(json as StatementData);
      }
    } catch {
      if (seq === fetchSeq.current) {
        setError({ status: 0, message: "Network error — could not load the statement" });
      }
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (open && customerId) void load();
    if (!open) {
      // Reset on close so a stale statement never flashes on reopen.
      setData(null);
      setError(null);
    }
  }, [open, customerId, load]);

  const printStatement = useCallback(() => {
    if (!data) return;
    // Hidden iframe print — fresh document with its own 80mm @page CSS, so the
    // workspace's print styles can never corrupt the statement (same technique
    // as CheckoutReceipt).
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.srcdoc = buildStatementHtml(data, session.name);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1_500);
    };
    document.body.appendChild(iframe);
  }, [data, session.name]);

  // Numberless share — mirrors printStatement's "act on loaded data only" guard.
  const shareStatement = useCallback(() => {
    if (!data) return;
    const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(data))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [data]);

  const shareWhatsApp = useCallback(() => {
    if (!data?.customer.phoneDigits) return;
    const url = `https://wa.me/${data.customer.phoneDigits}?text=${encodeURIComponent(buildWhatsAppMessage(data))}`;
    window.open(url, "_blank", "noopener");
  }, [data]);

  const c = data?.customer;
  const s = data?.summary;
  const balanceN = Number(c?.currentBalance ?? 0);
  const limitN = Number(c?.creditLimit ?? 0);
  const utilization = limitN > 0 ? Math.min(100, (balanceN / limitN) * 100) : balanceN > 0 ? 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Credit statement</DialogTitle>
          <DialogDescription>
            {customerName || "Customer"} — balance, repayment plans and ledger history
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          error.status === 403 ? (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
              <ShieldCheck className="size-4 text-amber-700 dark:text-amber-400" aria-hidden />
              <AlertTitle>Access restricted — MANAGER+ required</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" className="border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40">
              <TriangleAlert className="size-4 text-rose-700 dark:text-rose-400" aria-hidden />
              <AlertTitle>Could not load statement</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {error.message}
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RotateCw className="mr-1.5 size-3.5" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )
        ) : data && c && s ? (
          <div className="space-y-4">
            {/* ── Header block ── */}
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold">{c.name}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {c.phone ?? "no phone on file"}
                    {c.kraPin ? ` · KRA PIN ${c.kraPin}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {data.account && (
                    <Badge variant="outline" className={accountChip(data.account.status)}>
                      {data.account.status}
                    </Badge>
                  )}
                  <Badge variant="outline" className={riskChip(c.riskScore)}>
                    Risk {c.riskScore}
                  </Badge>
                  <Badge variant="outline" className="border-stone-300 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
                    {s.oldestDebtDays}d oldest
                  </Badge>
                </div>
              </div>
            </div>

            {/* ── KPI chip row ── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
                <p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">Outstanding (KES)</p>
                <p
                  title={formatKES(c.currentBalance)}
                  className={`mt-1 truncate text-sm font-semibold tabular-nums sm:text-base ${balanceN > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  {formatKES(c.currentBalance).replace(/^Ksh\s*/, "")}
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
                <p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">Credit limit (KES)</p>
                <p title={`Credit limit ${formatKES(c.creditLimit)}`} className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base">{formatKES(c.creditLimit).replace(/^Ksh\s*/, "")}</p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
                <p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">Utilization</p>
                <p
                  title={`${utilization.toFixed(1)}%`}
                  className={`mt-1 truncate text-sm font-semibold tabular-nums sm:text-base ${
                    utilization >= 90 ? "text-rose-700 dark:text-rose-400" : utilization >= 60 ? "text-amber-700 dark:text-amber-400" : "text-stone-800 dark:text-stone-200"
                  }`}
                >
                  {utilization.toFixed(1)}%
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
                <p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">Next due</p>
                {s.nextDueDate ? (
                  <>
                    <p className="mt-1 text-sm font-semibold">{format(new Date(s.nextDueDate), "d MMM yyyy")}</p>
                    <p className="text-xs tabular-nums text-stone-500 dark:text-stone-400">{formatKES(s.nextDueAmount ?? 0)}</p>
                  </>
                ) : (
                  <p className="mt-1 text-lg font-semibold text-stone-400 dark:text-stone-600">—</p>
                )}
              </div>
            </div>

            {/* ── Ledger timeline ── */}
            <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
              <div className="max-h-72 overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                  <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Ledger history</span>
                  <span className="text-[10px] text-stone-400 dark:text-stone-500">last {data.ledger.length} entries</span>
                </div>
                <div className="divide-y divide-stone-100 px-3 dark:divide-stone-800">
                  {data.ledger.map((l) => {
                    const meta = ledgerMeta(l.type);
                    const Icon = meta.icon;
                    return (
                      <div key={l.id} className="flex items-start gap-3 py-2.5">
                        <span
                          aria-hidden
                          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${meta.chip}`}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm">
                              <span className="font-medium">{meta.label}</span>{" "}
                              <span className={`font-semibold tabular-nums ${meta.tone}`}>
                                {meta.sign}
                                {formatKES(l.amount)}
                              </span>
                            </p>
                            <p className="shrink-0 font-mono text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
                              {formatKES(l.previousBalance)} → {formatKES(l.newBalance)}
                            </p>
                          </div>
                          {(l.note || l.referenceId) && (
                            <p className="truncate text-xs text-stone-500 dark:text-stone-400" title={l.note ?? `Ref ${l.referenceId}`}>
                              {l.note ?? `Ref ${l.referenceId}`}
                            </p>
                          )}
                          <p className="text-[10px] text-stone-400 dark:text-stone-500">
                            {format(new Date(l.createdAt), "dd MMM HH:mm")}
                            {l.performedBy ? ` · by ${l.performedBy}` : ""}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {data.ledger.length === 0 && (
                    <p className="py-6 text-center text-sm text-stone-500 dark:text-stone-400">No ledger activity yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Plans ── */}
            {data.plans.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                  Repayment plans ({data.plans.length})
                  {s.overdueInstallments > 0 && (
                    <span className="ml-2 text-xs font-normal text-rose-600 dark:text-rose-400">
                      {s.overdueInstallments} overdue installment{s.overdueInstallments === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                <div className="space-y-2">
                  {data.plans.map((plan) => {
                    const total = Number(plan.totalAmount) || 0;
                    const paid = Math.max(0, Math.min(total, total - Number(plan.balanceRemaining)));
                    const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
                    const nextInst =
                      plan.installments.find((i) => i.status !== "PAID") ??
                      plan.installments[plan.installments.length - 1];
                    const remainder = nextInst
                      ? Math.max(0, Number(nextInst.amountDue) - Number(nextInst.amountPaid))
                      : 0;
                    return (
                      <div key={plan.id} className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {plan.frequency.toLowerCase()} plan · from {format(new Date(plan.startDate), "d MMM yyyy")}
                          </p>
                          <Badge variant="outline" className={statusChip(plan.status)}>
                            {plan.status}
                          </Badge>
                        </div>
                        <Progress value={pct} className="h-2" />
                        <p className="text-xs text-stone-500 dark:text-stone-400">
                          {formatKES(paid)} paid of {formatKES(plan.totalAmount)} · down payment{" "}
                          {formatKES(plan.downPayment)} · balance {formatKES(plan.balanceRemaining)}
                        </p>
                        {nextInst && (
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
                            Next #{nextInst.seq} · {format(new Date(nextInst.dueDate), "d MMM yyyy")} ·{" "}
                            {formatKES(remainder)}
                            <Badge variant="outline" className={`${statusChip(nextInst.status)} px-1.5 py-0 text-[10px]`}>
                              {nextInst.status}
                            </Badge>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-1.5">
          <Button variant="outline" disabled={loading || !data} onClick={printStatement}>
            <Printer className="mr-1.5 size-4" /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            disabled={loading || !data}
            title={data ? undefined : "Load the statement first"}
            onClick={shareStatement}
            aria-label="Share statement via WhatsApp"
          >
            <MessageCircle className="mr-1.5 size-4" aria-hidden /> Share via WhatsApp
          </Button>
          {data?.customer.phoneDigits && (
            <Button
              disabled={loading || !data}
              onClick={shareWhatsApp}
              className="bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <MessageCircle className="mr-1.5 size-4" /> WhatsApp
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
