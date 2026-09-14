// src/components/inventory/ReorderPanel.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  MessageCircle,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { roleAtLeast } from "@/lib/types";
import { formatKES, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// ReorderPanel — "Reorder & restock intelligence". Consumes
// GET /api/v1/reports/reorder (MANAGER+, server BOLA-fences the branch) and
// renders purchase-requisition suggestions from 14-day sales velocity:
// days of cover, two-week-cover suggested quantities and estimated restock
// cost, with OUT/CRITICAL/LOW/WATCH urgency badges.
//
// `branchId` is the OWNER branch-scope filter (null = all branches): a change
// refetches and it is forwarded as ?branchId= only when non-null. Non-OWNER
// callers pass null — the server scopes them to their own branch.
// Palette: stone cards, emerald-700 accents, amber/rose urgency. No emoji.
// ─────────────────────────────────────────────────────────────────────────────

export function ReorderPanel({
  session,
  branchId,
}: {
  session: SessionUser;
  branchId: string | null;
}) {
  const canView = roleAtLeast(session.role, "MANAGER");

  const [data, setData] = useState<ReorderData | null>(null);
  const [loading, setLoading] = useState(canView);
  const [error, setError] = useState<string | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  const fallbackAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // Race guard: only the newest run may write state.
  const runRef = useRef(0);

  const load = useCallback(async () => {
    if (!canView) return;
    const run = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId); // null/empty = all branches (OWNER)
      const qs = params.toString();
      const res = await fetch(`/api/v1/reports/reorder${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error ?? `Failed to load reorder suggestions (${res.status})`
        );
      }
      if (runRef.current === run) setData(json as ReorderData);
    } catch (err) {
      if (runRef.current === run) {
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load reorder suggestions");
      }
    } finally {
      if (runRef.current === run) setLoading(false);
    }
  }, [branchId, canView]);

  // Initial load + refetch whenever the OWNER branch scope changes.
  useEffect(() => {
    void load();
  }, [load]);

  /** Plain-text supplier order list: one `SKU × QTY — Name` line per SKU. */
  const supplierText = useCallback(
    (d: ReorderData) => d.items.map((i) => `${i.sku} × ${i.suggestedQty} — ${i.name}`).join("\n"),
    []
  );

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [
      ["Mbumah Hardware — Reorder suggestions"],
      [`As of ${data.asOf} · ${data.windowDays}-day velocity window · two-week cover target`],
      [],
      [
        "SKU",
        "Product",
        "Category",
        "Unit",
        "In stock",
        "Reorder level",
        "Avg daily sales",
        "Days cover",
        "Suggested qty",
        "Est. cost (KES)",
        "Urgency",
      ],
      ...data.items.map((i) => [
        i.sku,
        i.name,
        i.category,
        i.unit,
        i.stockQty,
        i.reorderLevel,
        i.avgDailySales,
        i.daysOfCover ?? "no demand",
        String(i.suggestedQty),
        i.estCost,
        i.urgency,
      ]),
      [],
      [
        "Summary",
        "SKUs to reorder",
        String(data.totals.count),
        "Out of stock",
        String(data.totals.outCount),
        "Estimated restock cost (KES)",
        data.totals.estTotalCost,
      ],
    ];
    // BOM + CRLF so Excel opens the file with correct encoding/line breaks.
    const csv =
      "\uFEFF" + rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mbumah-reorder-${data.asOf.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.totals.count} SKU${data.totals.count === 1 ? "" : "s"} to CSV`);
  }

  async function copyForSupplier() {
    if (!data) return;
    const text = supplierText(data);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(
          `Order list copied — ${data.items.length} line${data.items.length === 1 ? "" : "s"} ready for the supplier`
        );
        return;
      } catch {
        // Clipboard API blocked (permissions/insecure context) → dialog fallback.
      }
    }
    setFallbackText(text);
    setFallbackOpen(true);
  }

  /** Numberless WhatsApp share — reuses the EXACT text the copy button builds
   *  (supplierText); wa.me without a recipient opens the chat picker. */
  function shareForWhatsApp() {
    if (!data || data.items.length === 0) return;
    const url = `https://wa.me/?text=${encodeURIComponent(supplierText(data))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /** execCommand fallback for browsers where navigator.clipboard is unavailable. */
  function copyFromFallback() {
    const el = fallbackAreaRef.current;
    if (!el) return;
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    if (ok) {
      toast.success("Order list copied for the supplier");
      setFallbackOpen(false);
    } else {
      toast.error("Copy failed — select the text and copy manually");
    }
  }

  // Cashiers never reach this tab in practice — defensive render keeps the
  // panel honest if it is ever mounted without the MANAGER+ gate.
  if (!canView) {
    return (
      <Alert>
        <ShieldAlert className="size-4" aria-hidden />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>
          Reorder intelligence is limited to MANAGER and OWNER roles (enforced server-side).
        </AlertDescription>
      </Alert>
    );
  }

  const d = data;

  return (
    <Card className="animate-fade-in-up border-stone-200 shadow-sm dark:border-stone-800">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> Reorder suggestions
          </CardTitle>
          <CardDescription>14-day velocity analysis · two-week cover target</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 size-4", loading && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!d || d.items.length === 0}>
            <Download className="mr-1.5 size-4" aria-hidden /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyForSupplier()}
            disabled={!d || d.items.length === 0}
          >
            <ClipboardCopy className="mr-1.5 size-4" aria-hidden /> Copy for supplier
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={shareForWhatsApp}
            disabled={!d || d.items.length === 0}
            aria-label="Share reorder list via WhatsApp"
          >
            <MessageCircle className="mr-1.5 size-4" aria-hidden /> WhatsApp
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>Could not load reorder suggestions</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {loading || !d ? (
          <>
            <div className="flex flex-wrap gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800"
                >
                  <Skeleton className="size-7 shrink-0 rounded-md" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-2.5 w-24" />
                    <Skeleton className="h-3.5 w-16" />
                  </div>
                </div>
              ))}
            </div>
            <div
              className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800"
              aria-hidden
            >
              {Array.from({ length: 6 }).map((_, r) => (
                <div key={r} className="flex items-center gap-4">
                  <Skeleton className="h-3 w-20 shrink-0" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-14 shrink-0" />
                  <Skeleton className="h-3 w-14 shrink-0" />
                  <Skeleton className="h-3 w-16 shrink-0" />
                  <Skeleton className="h-4 w-20 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </>
        ) : d.items.length === 0 ? (
          <>
            <KpiChipsRow data={d} />
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-6 py-10 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
              <CheckCircle2 className="size-8 text-emerald-700 dark:text-emerald-400" aria-hidden />
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300">
                All stocked items are healthy — nothing to reorder
              </p>
              <p className="text-xs text-emerald-800/70 dark:text-emerald-400/70">
                Every SKU in scope is currently above its reorder level.
              </p>
            </div>
          </>
        ) : (
          <>
            <KpiChipsRow data={d} />

            {/* Long-list handling: max-height + scroll (global thin-scrollbar CSS applies) */}
            <div className="max-h-96 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50 shadow-[0_1px_0_0_#e7e5e4] dark:bg-stone-900 dark:shadow-[0_1px_0_0_#3f3f46]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                    <TableHead className="text-right">Reorder lvl</TableHead>
                    <TableHead className="text-right">Avg daily sales</TableHead>
                    <TableHead className="text-right">Days cover</TableHead>
                    <TableHead className="text-right">Suggested qty</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead>Urgency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((i) => (
                    <TableRow key={i.productId}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-stone-600 dark:text-stone-400">
                        {i.sku}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate font-medium" title={i.name}>
                          {i.name}
                        </p>
                        <p className="truncate text-[11px] text-stone-500 dark:text-stone-400" title={i.category}>
                          {i.category}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatQty(i.stockQty, i.unit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-stone-600 dark:text-stone-400">
                        {formatQty(i.reorderLevel, i.unit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-stone-600 dark:text-stone-400">
                        {formatQty(i.avgDailySales, i.unit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {i.daysOfCover === null ? (
                          <span className="text-stone-400 dark:text-stone-500" title="No sales in the last 14 days">
                            —
                          </span>
                        ) : (
                          `${i.daysOfCover} d`
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold text-emerald-700 dark:text-emerald-400">
                        {i.suggestedQty.toLocaleString("en-KE")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatKES(i.estCost)}
                      </TableCell>
                      <TableCell>
                        <UrgencyBadge urgency={i.urgency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      {/* Clipboard fallback for browsers that block navigator.clipboard */}
      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy order list</DialogTitle>
            <DialogDescription>
              Automatic clipboard access was blocked by the browser — copy the order list below
              manually.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            ref={fallbackAreaRef}
            readOnly
            rows={10}
            value={fallbackText}
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Supplier order list"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFallbackOpen(false)}>
              Close
            </Button>
            <Button size="sm" onClick={copyFromFallback}>
              <ClipboardCopy className="mr-1.5 size-4" aria-hidden /> Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal pieces
// ─────────────────────────────────────────────────────────────────────────────

type Urgency = "OUT" | "CRITICAL" | "LOW" | "WATCH";

/** Wire type — mirrors GET /api/v1/reports/reorder (Decimals as strings). */
interface ReorderItem {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stockQty: string;
  reorderLevel: string;
  avgDailySales: string;
  daysOfCover: string | null;
  suggestedQty: number;
  estCost: string;
  urgency: Urgency;
}

interface ReorderData {
  asOf: string;
  windowDays: number;
  items: ReorderItem[];
  totals: { count: number; outCount: number; estTotalCost: string };
}

const URGENCY_STYLES: Record<Urgency, { label: string; icon: LucideIcon; className: string }> = {
  OUT: { label: "Out of stock", icon: XCircle, className: "border-transparent bg-rose-600 text-white dark:bg-rose-600" },
  CRITICAL: { label: "Critical", icon: AlertTriangle, className: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400" },
  LOW: { label: "Low", icon: AlertTriangle, className: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400" },
  WATCH: { label: "Watch", icon: AlertTriangle, className: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const { label, icon: Icon, className } = URGENCY_STYLES[urgency];
  return (
    <Badge variant="outline" className={cn("font-semibold", className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

function KpiChipsRow({ data }: { data: ReorderData }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <KpiChip
        icon={PackageSearch}
        tileClass="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        label="SKUs to reorder"
        value={data.totals.count.toLocaleString("en-KE")}
        caption={`as of ${new Date(data.asOf).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}`}
      />
      <KpiChip
        icon={XCircle}
        tileClass="bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
        label="Out of stock"
        value={data.totals.outCount.toLocaleString("en-KE")}
        valueClass={data.totals.outCount > 0 ? "text-rose-700 dark:text-rose-400" : undefined}
      />
      <KpiChip
        icon={Wallet}
        tileClass="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        label="Estimated restock cost"
        value={formatKES(data.totals.estTotalCost)}
      />
    </div>
  );
}

function KpiChip({
  icon: Icon,
  tileClass,
  label,
  value,
  valueClass,
  caption,
}: {
  icon: LucideIcon;
  tileClass: string;
  label: string;
  value: string;
  valueClass?: string;
  caption?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-sm dark:border-stone-800 dark:bg-stone-800">
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", tileClass)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
        <p className={cn("text-sm font-bold tabular-nums text-stone-900 dark:text-stone-50", valueClass)}>{value}</p>
        {caption && <p className="truncate text-[10px] text-stone-500 dark:text-stone-400">{caption}</p>}
      </div>
    </div>
  );
}
