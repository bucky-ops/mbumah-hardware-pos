"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SalesHistory — searchable sales feed + receipt reprint for the ERP workspace.
//
// Data: GET /api/v1/sales?limit=100 (wire money = strings) + GET /api/v1/sales/{id}
// for reprints. KPI mini-row and the CASH/MPESA/other tender split are computed
// client-side from the listed rows.
//
// WHY A LOCAL SalesReceiptDialog (not <CheckoutReceipt/>): CheckoutReceipt is
// hard-wired to the global cart store (receiptDialogOpen/lastReceipt/closeReceipt,
// zero props). Rendering it here would overwrite the till's lastReceipt AND pop
// the POS tab's dialog simultaneously (page.tsx mounts its own instance bound to
// the same store). So this file renders its own 80mm thermal-paper dialog with
// serrated edges, the same eTIMS QR payload (reusing the exported
// etimsQrPayload from CheckoutReceipt so scan bytes match) and the same hidden-
// iframe print technique. CheckoutReceipt itself is untouched.
//
// Task 21-d: the reusable <ReceiptSmsButton/> (pos/ReceiptSmsButton.tsx) is
// wired into this dialog's actions for customer-attached sales. The dialog
// knows the transaction id from the clicked row (the reprint payload itself
// carries no id) and the customer name from the receipt data; the server
// re-verifies phone/role/branch (BOLA) authoritatively on every send.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import QRCode from "qrcode";
import {
  Banknote,
  CreditCard,
  Download,
  FileText,
  Landmark,
  Loader2,
  Lock,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  Smartphone,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { etimsQrPayload } from "@/components/pos/CheckoutReceipt";
import { ReceiptSmsButton } from "@/components/pos/ReceiptSmsButton";
import { formatKES, formatQty } from "@/lib/format";
import type { ReceiptData, ReceiptLine, SessionUser } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── Wire contracts (decimals serialized as strings) ──────────────────────────

interface SaleRow {
  id: string;
  ref: string;
  status: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  createdAt: string;
  customer: string | null;
  user: string;
  itemCount: number;
  payments: Array<{ method: string; amount: string }>;
}

/** GET /api/v1/sales/{id} = full ReceiptData + additive status/hsCode fields. */
interface ReprintLine extends ReceiptLine {
  hsCode: string | null;
}
interface ReprintResponse extends ReceiptData {
  status: string;
  lines: ReprintLine[];
}

function toReceiptData(res: ReprintResponse): ReceiptData {
  const receiptLines: ReceiptLine[] = res.lines.map((l) => ({
    description: l.description,
    qty: l.qty,
    uom: l.uom,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
    lineNet: l.lineNet,
    vatAmount: l.vatAmount,
  }));
  const { status: _status, lines: _lines, ...rest } = res;
  void _status;
  void _lines;
  return { ...rest, lines: receiptLines };
}

// ── Display maps ─────────────────────────────────────────────────────────────

const METHOD_ICON: Record<string, LucideIcon> = {
  CASH: Banknote,
  MPESA: Smartphone,
  BANK_TRANSFER: Landmark,
  CARD: CreditCard,
  STORE_CREDIT: Wallet,
};
const METHOD_SHORT: Record<string, string> = {
  CASH: "Cash",
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank",
  CARD: "Card",
  STORE_CREDIT: "Credit",
};
const METHOD_CLASS: Record<string, string> = {
  CASH: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  MPESA: "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  STORE_CREDIT: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
};
const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  STORE_CREDIT: "Store credit",
};
const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  CREDIT: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  PARTIAL: "border-amber-300 bg-transparent text-amber-700 dark:border-amber-800 dark:text-amber-300",
  HELD: "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
};

type StatusFilter = "ALL" | "COMPLETED" | "CREDIT" | "PARTIAL" | "HELD";
const STATUS_OPTIONS: StatusFilter[] = ["ALL", "COMPLETED", "CREDIT", "PARTIAL", "HELD"];

const TABLE_COLS = 9; // Ref · Time · Cashier · Customer · Items · Payments · Total · Status · Receipt

// ── Tiny building blocks ─────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-stone-50 px-2.5 py-2 dark:bg-stone-900/60">
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">{value}</div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Standalone 80mm print document — mirrors CheckoutReceipt's private builder
 *  (same @page, typography, eTIMS QR) so reprints are identical to originals. */
function buildReprintHtml(r: ReceiptData, qrDataUrl: string | null): string {
  const rows = r.lines
    .map(
      (l) => `
      <div class="row"><span class="grow">${escapeHtml(l.description)}</span><span class="cat">${escapeHtml(l.uom)}</span></div>
      <div class="row muted"><span>${formatQty(l.qty, l.uom)} × ${formatKES(l.unitPrice)}${l.discountPct ? ` (−${l.discountPct}%)` : ""} [${escapeHtml(r.taxCategories.includes(",") ? "B" : r.taxCategories || "B")}]</span><span>${formatKES(l.lineNet)}</span></div>`
    )
    .join("");

  const payments = r.payments
    .map(
      (p) =>
        `<div class="row"><span>${escapeHtml(PAYMENT_LABELS[p.method] ?? p.method)}${p.reference ? ` (${escapeHtml(p.reference)})` : ""}</span><span>${formatKES(p.amount)}</span></div>`
    )
    .join("");

  const net = r.total - r.vat;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(r.invoiceNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; width: 74mm; margin: 0 auto; color: #111; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 12px; }
  .muted { font-size: 9px; color: #444; }
  .dashed { border-top: 1px dashed #555; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; line-height: 1.5; }
  .grow { flex: 1; }
  .cat { color: #666; }
  .totals .row span:first-child { color: #333; }
  .qr { display: block; margin: 4px auto 0; width: 26mm; height: 26mm; }
</style></head>
<body>
  <div class="center bold big">${escapeHtml(r.branchName)}</div>
  ${r.branchLocation ? `<div class="center muted">${escapeHtml(r.branchLocation)}</div>` : ""}
  <div class="center">KRA PIN: ${escapeHtml(r.kraPin)}</div>
  <div class="center muted">CU-SN: ${escapeHtml(r.cuSerial)} · HS: ${escapeHtml(r.hsCodesSummary || "—")}</div>
  <div class="dashed"></div>
  <div class="row"><span>INVOICE: <b>${escapeHtml(r.invoiceNumber)}</b></span><span>${new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span></div>
  <div class="row muted"><span>Cashier: ${escapeHtml(r.cashier)}</span><span>${escapeHtml(r.customerName ?? "Walk-in")}</span></div>
  ${r.buyerPin ? `<div class="row"><span>BUYER PIN:</span><span>${escapeHtml(r.buyerPin)}</span></div>` : ""}
  <div class="dashed"></div>
  ${rows}
  <div class="dashed"></div>
  <div class="totals">
    <div class="row"><span>Gross</span><span>${formatKES(r.grossSubtotal)}</span></div>
    ${r.discount > 0 ? `<div class="row"><span>Discount</span><span>−${formatKES(r.discount)}</span></div>` : ""}
    <div class="row"><span>NET</span><span>${formatKES(net)}</span></div>
    <div class="row"><span>VAT 16%${r.vatInclusive ? " (incl.)" : ""}</span><span>${formatKES(r.vat)}</span></div>
    <div class="row bold big"><span>TOTAL KES</span><span>${formatKES(r.total)}</span></div>
  </div>
  <div class="dashed"></div>
  ${payments}
  ${r.balance > 0 ? `<div class="row bold"><span>BALANCE DUE</span><span>${formatKES(r.balance)}</span></div>` : `<div class="row"><span>Paid in full</span><span></span></div>`}
  <div class="dashed"></div>
  ${qrDataUrl ? `<img class="qr" alt="eTIMS verification QR" src="${qrDataUrl}" />` : ""}
  <div class="center muted">Scan to verify · eTIMS compliant tax invoice</div>
  <div class="center muted">REPRINT · Tax categories: ${escapeHtml(r.taxCategories || "B")} · ${escapeHtml(r.ref)}</div>
</body></html>`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function SalesHistory({ session }: { session: SessionUser }) {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  // Reprint dialog state
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  // Transaction id of the row behind `receipt` — the reprint payload carries no
  // id, but receipt SMS needs one (POST /api/v1/sales/{id}/receipt-sms).
  const [receiptTxId, setReceiptTxId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [reprintLoadingId, setReprintLoadingId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ ref: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const res = await fetch("/api/v1/sales?limit=100", { cache: "no-store" });
      if (res.status === 403) {
        // Role gating (e.g. future policy change) — degrade gracefully, no toast.
        setForbidden(true);
        setRows([]);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not load sales (${res.status})`);
      }
      const body = (await res.json()) as { items: SaleRow[] };
      setRows(body.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sales history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openReprint = useCallback(async (rowId: string) => {
    setReprintLoadingId(rowId);
    try {
      const res = await fetch(`/api/v1/sales/${rowId}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Reprint failed (${res.status})`);
      }
      const body = (await res.json()) as ReprintResponse;
      setReceipt(toReceiptData(body));
      setReceiptTxId(rowId);
      setReceiptOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the receipt");
    } finally {
      setReprintLoadingId(null);
    }
  }, []);

  // eTIMS QR for the reprint — keyed by ref so a slow render can never show
  // another receipt's image (same discipline as CheckoutReceipt).
  useEffect(() => {
    if (!receipt) return;
    const target = receipt;
    let cancelled = false;
    QRCode.toDataURL(etimsQrPayload(target), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQr({ ref: target.ref, url });
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [receipt]);

  // Hidden-iframe 80mm print — the exact technique CheckoutReceipt uses, so
  // the workspace's print CSS can never corrupt the receipt layout.
  const printReceipt = useCallback(() => {
    if (!receipt) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.srcdoc = buildReprintHtml(receipt, qr?.ref === receipt.ref ? qr.url : null);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1_500);
    };
    document.body.appendChild(iframe);
  }, [receipt, qr]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.ref.toLowerCase().includes(q) ||
        r.user.toLowerCase().includes(q) ||
        (r.customer ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  // Tender split computed client-side over the filtered (listed) rows.
  const kpis = useMemo(() => {
    let cash = 0;
    let mpesa = 0;
    let other = 0;
    for (const r of filtered) {
      for (const p of r.payments) {
        const a = Number(p.amount);
        if (p.method === "CASH") cash += a;
        else if (p.method === "MPESA") mpesa += a;
        else other += a;
      }
    }
    return {
      count: filtered.length,
      total: filtered.reduce((s, r) => s + Number(r.totalAmount), 0),
      cash,
      mpesa,
      other,
    };
  }, [filtered]);

  const exportCsv = useCallback(() => {
    const csvRows: string[][] = [
      ["Ref", "Time", "Cashier", "Customer", "Status", "Payment methods", "Total (KES)"],
      ...filtered.map((r) => [
        r.ref,
        format(new Date(r.createdAt), "dd MMM HH:mm"),
        r.user,
        r.customer ?? "Walk-in",
        r.status,
        r.payments.map((p) => METHOD_SHORT[p.method] ?? p.method).join("|"),
        Number(r.totalAmount).toFixed(2),
      ]),
    ];
    const csv = csvRows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mbumah-sales-history.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} sale${filtered.length === 1 ? "" : "s"} to CSV`);
  }, [filtered]);

  const scopeLabel = session.role === "OWNER" ? "all branches" : (session.branchName ?? "your branch");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden /> Sales history
          </CardTitle>
          <CardDescription>Last 100 sales · {scopeLabel} · click Receipt to reprint</CardDescription>
        </div>
        <div className="flex flex-wrap shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading || forbidden}
            aria-label="Refresh sales history"
          >
            <RefreshCw className={`mr-1.5 size-4${loading ? " animate-spin" : ""}`} aria-hidden /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={loading || forbidden || filtered.length === 0}
            aria-label="Export listed sales as CSV"
          >
            <Download className="mr-1.5 size-4" aria-hidden /> CSV
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPI mini-row (computed from the listed rows) */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Sales summary">
          <Stat label="Sales" value={loading ? <Skeleton className="h-4 w-10" /> : kpis.count} />
          <Stat
            label="Total value"
            value={loading ? <Skeleton className="h-4 w-20" /> : formatKES(kpis.total)}
          />
          <Stat
            label="Cash"
            value={loading ? <Skeleton className="h-4 w-16" /> : formatKES(kpis.cash)}
          />
          <Stat
            label="M-Pesa"
            value={loading ? <Skeleton className="h-4 w-16" /> : formatKES(kpis.mpesa)}
          />
          <Stat
            label="Other tenders"
            value={loading ? <Skeleton className="h-4 w-16" /> : formatKES(kpis.other)}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, cashier, customer…"
              className="pl-8"
              aria-label="Search sales by reference, cashier or customer"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter sales by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "ALL" ? "All statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {forbidden ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <Lock className="h-4 w-4" aria-hidden />
            <AlertTitle>Access restricted</AlertTitle>
            <AlertDescription>
              Your role can&apos;t view the sales feed. Ask a manager or the owner for access.
            </AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center dark:border-stone-700 dark:bg-stone-900/60">
            <Receipt className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No sales recorded for this filter yet</p>
            <p className="max-w-xs text-xs text-stone-400 dark:text-stone-500">
              {search || statusFilter !== "ALL"
                ? "Try a different search or clear the filters."
                : "Completed checkouts will appear here."}
            </p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="hidden lg:table-cell">Cashier</TableHead>
                  <TableHead className="hidden lg:table-cell">Customer</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Items</TableHead>
                  <TableHead className="hidden md:table-cell">Payments</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Reprint receipt</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell className="font-mono text-xs">{r.ref}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-stone-600 dark:text-stone-400">
                      {format(new Date(r.createdAt), "dd MMM HH:mm")}
                    </TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">{r.user}</TableCell>
                    <TableCell className="hidden max-w-40 truncate text-xs lg:table-cell">
                      {r.customer ?? "Walk-in"}
                    </TableCell>
                    <TableCell className="hidden text-right text-xs tabular-nums lg:table-cell">
                      {r.itemCount}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {r.payments.map((p, i) => {
                          const Icon = METHOD_ICON[p.method] ?? Wallet;
                          return (
                            <Badge
                              key={`${p.method}-${i}`}
                              variant="outline"
                              className={`gap-1 px-1.5 text-[10px] ${METHOD_CLASS[p.method] ?? "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300"}`}
                            >
                              <Icon className="h-3 w-3" aria-hidden />
                              {METHOD_SHORT[p.method] ?? p.method}
                            </Badge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatKES(Number(r.totalAmount))}
                      {Number(r.balanceDue) > 0 && (
                        <div className="text-[10px] font-normal text-amber-700 dark:text-amber-300">
                          due {formatKES(Number(r.balanceDue))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className={STATUS_BADGE[r.status] ?? STATUS_BADGE.HELD}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openReprint(r.id)}
                        disabled={reprintLoadingId !== null}
                        aria-label={`Reprint receipt for ${r.ref}`}
                        title={`Reprint receipt ${r.ref}`}
                      >
                        {reprintLoadingId === r.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <FileText className="size-4" aria-hidden />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Reprint dialog — 80mm thermal paper, serrated edges, eTIMS QR, iframe print */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> Receipt reprint
            </DialogTitle>
            <DialogDescription>80mm preview — {receipt?.ref ?? ""}</DialogDescription>
          </DialogHeader>

          {receipt && (
            <div
              className="receipt-paper relative mx-auto w-full max-w-[320px] bg-white p-4 pt-5 font-mono text-[11px] leading-relaxed text-stone-900 dark:bg-stone-900 dark:text-stone-100"
              style={{
                boxShadow: "0 1px 2px rgba(0,0,0,.08), 0 8px 24px -12px rgba(0,0,0,.25)",
                borderTop: "none",
                borderBottom: "none",
              }}
            >
              {/* perforation edges — light & dark stacked (the paper fill color
                  is baked into the gradient, which inline styles can't theme-switch) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_6px_0px,transparent_5px,#fff_5px)] dark:hidden"
                style={{
                  backgroundSize: "12px 8px",
                  backgroundPosition: "-6px -4px",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 hidden h-2 bg-[radial-gradient(circle_at_6px_0px,transparent_5px,#1c1917_5px)] dark:block"
                style={{
                  backgroundSize: "12px 8px",
                  backgroundPosition: "-6px -4px",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-[radial-gradient(circle_at_6px_8px,transparent_5px,#fff_5px)] dark:hidden"
                style={{
                  backgroundSize: "12px 8px",
                  backgroundPosition: "-6px 4px",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-2 bg-[radial-gradient(circle_at_6px_8px,transparent_5px,#1c1917_5px)] dark:block"
                style={{
                  backgroundSize: "12px 8px",
                  backgroundPosition: "-6px 4px",
                }}
              />

              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-wide">{receipt.branchName}</p>
                {receipt.branchLocation && (
                  <p className="text-[10px] text-stone-500 dark:text-stone-400">{receipt.branchLocation}</p>
                )}
                <p className="mt-1">KRA PIN: {receipt.kraPin}</p>
                {receipt.buyerPin && (
                  <p>
                    BUYER PIN: <span className="font-semibold">{receipt.buyerPin}</span>
                  </p>
                )}
                <p className="text-[10px] text-stone-500 dark:text-stone-400">
                  CU-SN: {receipt.cuSerial} · HS: {receipt.hsCodesSummary || "—"}
                </p>
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    INVOICE {receipt.invoiceNumber}
                  </Badge>
                  <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
                    Tax cat {receipt.taxCategories || "B"}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">
                  {new Date(receipt.createdAt).toLocaleString("en-KE", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {receipt.cashier}
                </p>
              </div>

              <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

              <div className="grid gap-1.5">
                {receipt.lines.map((l, idx) => (
                  <div key={`${receipt.ref}-${idx}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 grow">{l.description}</span>
                      <span className="font-semibold tabular-nums">{formatKES(l.lineNet)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-stone-500 dark:text-stone-400">
                      <span>
                        {formatQty(l.qty, l.uom)} × {formatKES(l.unitPrice)}
                        {l.discountPct ? ` (−${l.discountPct}%)` : ""}
                      </span>
                      <span className="rounded-sm border border-stone-300 px-1 leading-none dark:border-stone-700">
                        {receipt.taxCategories.includes(",") ? "B" : receipt.taxCategories || "B"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

              <div className="grid gap-0.5">
                <div className="flex justify-between">
                  <span>Gross</span>
                  <span className="tabular-nums">{formatKES(receipt.grossSubtotal)}</span>
                </div>
                {receipt.discount > 0 && (
                  <div className="flex justify-between text-rose-700 dark:text-rose-400">
                    <span>Discount</span>
                    <span className="tabular-nums">−{formatKES(receipt.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>NET</span>
                  <span className="tabular-nums">{formatKES(receipt.total - receipt.vat)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT 16%{receipt.vatInclusive ? " (incl.)" : ""}</span>
                  <span className="tabular-nums">{formatKES(receipt.vat)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-dashed border-stone-300 pt-1 text-sm font-bold dark:border-stone-700">
                  <span>TOTAL</span>
                  <span className="tabular-nums">{formatKES(receipt.total)}</span>
                </div>
              </div>

              <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

              <div className="grid gap-0.5">
                {receipt.payments.map((p, idx) => (
                  <div key={`${p.method}-${idx}`} className="flex justify-between">
                    <span>
                      {PAYMENT_LABELS[p.method] ?? p.method}
                      {p.reference ? <span className="text-stone-500 dark:text-stone-400"> ({p.reference})</span> : null}
                    </span>
                    <span className="tabular-nums">{formatKES(p.amount)}</span>
                  </div>
                ))}
                {receipt.balance > 0 ? (
                  <div className="flex justify-between font-bold text-amber-700 dark:text-amber-300">
                    <span>BALANCE DUE</span>
                    <span className="tabular-nums">{formatKES(receipt.balance)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-stone-500 dark:text-stone-400">
                    <span>Paid in full</span>
                    <span>{receipt.customerName ?? ""}</span>
                  </div>
                )}
              </div>

              <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

              {qr?.ref === receipt.ref && qr.url && (
                <div className="flex flex-col items-center gap-1">
                  <img
                    src={qr.url}
                    alt={`eTIMS verification QR for ${receipt.invoiceNumber}`}
                    className="h-24 w-24 rounded-sm bg-white p-0.5"
                  />
                  <p className="text-[9px] tracking-wide text-stone-400 dark:text-stone-500">Scan to verify with KRA</p>
                </div>
              )}
              <p className="text-center text-[10px] tracking-wide text-stone-500 dark:text-stone-400">
                eTIMS compliant tax invoice · REPRINT
              </p>
            </div>
          )}

          {receipt?.customerName && receiptTxId && (
            <p className="text-center text-[11px] text-stone-500 dark:text-stone-400">
              SMS this receipt to{" "}
              <span className="font-medium text-stone-700 dark:text-stone-300">{receipt.customerName}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={printReceipt} disabled={!receipt}>
              <Printer className="mr-2 h-4 w-4" aria-hidden /> Print
            </Button>
            {receipt?.customerName && receiptTxId ? (
              // Server re-verifies role/branch/phone (BOLA); a resend inside the
              // 60s spam window surfaces the guard message verbatim. No refresh
              // needed onSent — the dispatch doesn't mutate sale data.
              <ReceiptSmsButton transactionId={receiptTxId} label="Resend via SMS" />
            ) : null}
            <Button
              variant="ghost"
              onClick={() => setReceiptOpen(false)}
              className={receipt?.customerName && receiptTxId ? "col-span-2" : undefined}
            >
              <X className="mr-2 h-4 w-4" aria-hidden /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
