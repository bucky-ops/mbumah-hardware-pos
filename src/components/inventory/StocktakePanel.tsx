"use client";

// src/components/inventory/StocktakePanel.tsx
//
// Stocktake (count-sheet) workspace for the Inventory tab.
//
//   FLOW:  New count sheet (MANAGER+) → snapshot of the branch's SKUs (all or
//   one category) → staff type counted quantities → Save counts (PATCH,
//   batched, idempotent per row) → Close & apply (POST close) recomputes the
//   applied delta against CURRENT stock at close time (sales made during
//   counting are never clobbered) and writes signed STOCK_COUNT adjustments.
//   Cancel discards a sheet without touching stock.
//
//   RBAC: the whole panel is rendered for MANAGER+ only (page.tsx gates the
//   mount; the API enforces the same rule server-side).
//
//   COUNT-SHEET UX DETAILS
//   • Server returns uncounted rows first (then A→Z) — the counter works
//     top-down without sorting.
//   • Live variance per row (counted − system, 3dp Decimal via lib/format D).
//   • Search box + "hide counted" switch keep the DOM light on full-branch
//     sheets (hundreds of rows inside a Dialog).
//   • Enter inside a counted input jumps to the next visible input.
//   • Close & apply confirm dialog states exactly what will happen: N SKUs
//     move, M stay, U uncounted skipped — and the snapshot variance value.
//   • Dark theme: written with dark: variants from the start (Task 19).
//
//   DECIMAL DISCIPLINE: all quantity math goes through D() (Decimal.js,
//   ROUND_HALF_UP); the wire carries strings; no float money/qty arithmetic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { D, formatQty } from "@/lib/format";
import { roleAtLeast, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Wire types (Decimal values arrive as strings) ────────────────────────────

interface StocktakeRow {
  id: string;
  ref: string;
  status: "OPEN" | "CLOSED" | "CANCELLED" | string;
  branchCode: string;
  branchName: string;
  note: string | null;
  category: string | null;
  createdByName: string;
  createdAt: string;
  closedByName: string | null;
  closedAt: string | null;
  totalItems: number;
  countedItems: number;
  varianceQtySum: string | null;
  varianceValue: string;
}

interface StocktakeItemRow {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  systemQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  unitCost: string; // snapshot at sheet creation — sent by GET /api/v1/stocktake/[id]
  countedByName: string | null;
  countedAt: string | null; // ISO stamp of the last save for this row
  note: string | null;
}

export interface StocktakePanelProps {
  session: SessionUser;
  /** OWNER branch scope from the header switcher (null = all branches). */
  branchId: string | null;
  /** Category list from the orchestrator's product cache (create-dialog filter). */
  categories: string[];
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  CLOSED: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELLED: "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400",
};

function statusChip(status: string) {
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold tracking-wide", STATUS_STYLES[status])}>
      {status}
    </Badge>
  );
}

function varianceTone(qty: string): string {
  const v = D(qty).comparedTo(0);
  if (v === 0) return "text-stone-500 dark:text-stone-400";
  return v < 0
    ? "font-medium text-rose-700 dark:text-rose-400"
    : "font-medium text-emerald-700 dark:text-emerald-400";
}

// ── CSV export (ReorderPanel pattern: Blob + <a download> + toast) ──────────

/** RFC-4180 cell: quote only when the value contains comma/quote/newline;
 *  embedded double quotes are doubled. Nullish renders as an empty cell. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds an Excel-friendly CSV (\uFEFF BOM + CRLF rows) and triggers a download. */
function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const csv = "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StocktakePanel({ session, branchId, categories }: StocktakePanelProps) {
  const isManager = roleAtLeast(session.role, "MANAGER");

  const [sheets, setSheets] = useState<StocktakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCategory, setCreateCategory] = useState<string>("ALL");
  const [createNote, setCreateNote] = useState("");
  const [creating, setCreating] = useState(false);

  // Active counting sheet
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [sheetMeta, setSheetMeta] = useState<StocktakeRow | null>(null);
  const [items, setItems] = useState<StocktakeItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, { qty: string; note?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // In-sheet filters
  const [filter, setFilter] = useState("");
  const [hideCounted, setHideCounted] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/v1/stocktake?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: StocktakeRow[] };
      setSheets(data.items ?? []);
    } catch {
      toast.error("Could not load count sheets");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openSheet = useCallback(async (sheet: StocktakeRow) => {
    setOpenSheetId(sheet.id);
    setSheetMeta(sheet);
    setItemsLoading(true);
    setCounts({});
    setFilter("");
    setHideCounted(false);
    try {
      const res = await fetch(`/api/v1/stocktake/${sheet.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { stocktake?: StocktakeRow; items?: StocktakeItemRow[] };
      setSheetMeta(data.stocktake ?? sheet);
      setItems(data.items ?? []);
      // Pre-fill inputs with saved counts so a resume feels continuous.
      const pre: Record<string, { qty: string; note?: string }> = {};
      for (const it of data.items ?? []) {
        if (it.countedQty != null) pre[it.id] = { qty: it.countedQty, note: it.note ?? undefined };
      }
      setCounts(pre);
    } catch {
      toast.error("Could not load the count sheet");
      setOpenSheetId(null);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const createSheet = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = {};
      if (branchId) body.branchId = branchId;
      if (createCategory !== "ALL") body.category = createCategory;
      if (createNote.trim().length >= 3) body.note = createNote.trim();
      const res = await fetch("/api/v1/stocktake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { stocktake?: { id: string; ref: string; totalItems: number }; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      toast.success(`Count sheet ${data.stocktake?.ref} created`, {
        description: `${data.stocktake?.totalItems ?? 0} SKUs snapshotted`,
      });
      setCreateOpen(false);
      setCreateNote("");
      await fetchList();
      if (data.stocktake) {
        await openSheet({
          id: data.stocktake.id,
          ref: data.stocktake.ref,
          status: "OPEN",
          branchCode: "", branchName: "", note: null,
          category: createCategory === "ALL" ? null : createCategory,
          createdByName: session.name, createdAt: new Date().toISOString(),
          closedByName: null, closedAt: null,
          totalItems: data.stocktake.totalItems, countedItems: 0,
          varianceQtySum: null, varianceValue: "0.00",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the count sheet");
    } finally {
      setCreating(false);
    }
  };

  const saveCounts = async () => {
    if (!openSheetId) return;
    const lines = Object.entries(counts)
      .filter(([, v]) => v.qty !== "")
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v.qty), ...(v.note ? { note: v.note } : {}) }));
    if (lines.length === 0) {
      toast.warning("Nothing to save yet — type at least one count");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/stocktake/${openSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SAVE_COUNTS", items: lines }),
      });
      const data = (await res.json()) as { saved?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      toast.success(`Saved ${data.saved ?? lines.length} count(s)`);
      await fetchList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const closeSheet = async () => {
    if (!openSheetId) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/v1/stocktake/${openSheetId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        summary?: { countedItems: number; appliedCount: number; skippedUncounted: number; snapshotVarianceValue: string };
        message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      toast.success("Count applied to stock", {
        description: `${data.summary?.appliedCount ?? 0} SKU(s) adjusted · snapshot variance KES ${data.summary?.snapshotVarianceValue ?? "0.00"}`,
      });
      setConfirmClose(false);
      setOpenSheetId(null);
      await fetchList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Close failed");
    } finally {
      setClosing(false);
    }
  };

  const cancelSheet = async () => {
    if (!openSheetId) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/v1/stocktake/${openSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", items: [] }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      toast.info("Count sheet cancelled — stock untouched");
      setOpenSheetId(null);
      await fetchList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setClosing(false);
    }
  };

  // ── CSV exports ────────────────────────────────────────────────────────────

  /** Sheet-list summary export — ref/status/progress/Σvariance/Σ|var|×cost. */
  const exportListCsv = () => {
    if (sheets.length === 0) return;
    const rows: Array<Array<string | number | null>> = [
      ["Ref", "Status", "Scope", "Branch", "Counted", "Total items", "Progress %", "Variance (units)", "Variance value (KES)", "Created by", "Created at"],
      ...sheets.map((s) => [
        s.ref,
        s.status,
        s.category ?? "All SKUs",
        s.branchCode,
        s.countedItems,
        s.totalItems,
        s.totalItems > 0 ? Math.round((s.countedItems / s.totalItems) * 100) : 0,
        s.varianceQtySum, // null while nothing is counted → empty cell
        s.varianceValue, // Σ|variance| × snapshot unit cost (absolute value)
        s.createdByName,
        s.createdAt, // ISO
      ]),
    ];
    downloadCsv(`mbumah-stocktakes-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`Exported ${sheets.length} count sheet${sheets.length === 1 ? "" : "s"} to CSV`);
  };

  /** Item-level export of the OPEN count sheet — the full counting record. */
  const exportSheetCsv = () => {
    if (!sheetMeta || items.length === 0) return;
    // Typed-but-unsaved counts live in `counts` only — flag them so the
    // manager knows to Save first for the numbers to reach the export.
    const unsaved = items.filter((it) => {
      const typed = counts[it.id]?.qty ?? "";
      return typed !== "" && typed !== (it.countedQty ?? "");
    }).length;
    const rows: Array<Array<string | number | null>> = [
      ["Ref", "Status", "SKU", "Product", "Category", "System qty", "Counted qty", "Variance", "Unit cost", "Variance value (KES)", "Counted by", "Counted at"],
      ...items.map((it) => {
        const counted = it.countedQty != null;
        // Server-stamped variance when present; else derive from the saved count.
        const variance = counted
          ? it.varianceQty != null
            ? D(it.varianceQty)
            : D(it.countedQty).minus(D(it.systemQty))
          : null;
        return [
          sheetMeta.ref,
          sheetMeta.status,
          it.sku,
          it.name,
          it.category,
          D(it.systemQty).toString(),
          counted ? D(it.countedQty).toString() : "", // blank if uncounted
          variance ? variance.toString() : "", // blank if uncounted
          it.unitCost,
          variance ? variance.mul(D(it.unitCost)).toFixed(2) : "", // variance × unit cost
          it.countedByName ?? "",
          it.countedAt ?? "", // ISO
        ];
      }),
    ];
    downloadCsv(`mbumah-stocktake-${sheetMeta.ref}.csv`, rows);
    toast.success(`Exported ${items.length} item${items.length === 1 ? "" : "s"} to CSV`,
      unsaved > 0 ? { description: `${unsaved} typed count(s) not saved yet — save first to include them.` } : undefined);
  };

  // ── Derived: filtered rows + progress for the open sheet ───────────────────
  const countedTotal = useMemo(
    () => items.filter((it) => (counts[it.id]?.qty ?? it.countedQty ?? "") !== "").length,
    [items, counts],
  );

  const visibleItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) => {
      const countedNow = (counts[it.id]?.qty ?? it.countedQty ?? "") !== "";
      if (hideCounted && countedNow) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q);
    });
  }, [items, counts, filter, hideCounted]);

  // Enter → focus next visible counted input (counting-pad flow).
  const listRef = useRef<HTMLDivElement>(null);
  const onCountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = visibleItems[idx + 1];
    if (!next) return;
    const el = listRef.current?.querySelector<HTMLInputElement>(`input[data-item-id="${next.id}"]`);
    el?.focus();
    el?.select();
  };

  const openProgress = sheetMeta && sheetMeta.totalItems > 0
    ? Math.round((countedTotal / sheetMeta.totalItems) * 100)
    : 0;

  return (
    <Card className="border-stone-200 shadow-sm dark:border-stone-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
          Stocktake — count sheets
          {isManager && (
            <span className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void fetchList()} aria-label="Refresh count sheets">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
                <span className="sr-only sm:not-sr-only sm:text-xs">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportListCsv}
                disabled={sheets.length === 0}
                aria-label="Export count sheets to CSV"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only sm:text-xs">Export CSV</span>
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New count sheet
              </Button>
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Snapshot stock, count the shelf, then close to apply — the applied delta is recomputed
          against live stock at close time, so sales made while counting are never overwritten.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-500 dark:text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading count sheets…
          </div>
        ) : sheets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-dashed border-stone-200 px-4 py-10 text-center dark:border-stone-800">
            <ClipboardList className="h-8 w-8 text-stone-300 dark:text-stone-600" aria-hidden />
            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No count sheets yet</p>
            <p className="max-w-sm text-xs text-stone-500 dark:text-stone-400">
              Start a stocktake to snapshot current stock, record what is physically on the shelf,
              and apply audited adjustments in one reviewed step.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-medium tracking-wide text-stone-500 uppercase dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400">
                  <th className="px-4 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Counted</th>
                  <th className="px-3 py-2 font-medium">Variance</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {sheets.map((s) => {
                  const pct = s.totalItems > 0 ? Math.round((s.countedItems / s.totalItems) * 100) : 0;
                  return (
                    <tr key={s.id} className="transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-900/50">
                      <td className="px-4 py-2.5">
                        <p className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-200">{s.ref}</p>
                        {s.note && <p className="max-w-48 truncate text-[11px] text-stone-500 dark:text-stone-400">{s.note}</p>}
                      </td>
                      <td className="px-3 py-2.5">{statusChip(s.status)}</td>
                      <td className="px-3 py-2.5 text-xs text-stone-600 dark:text-stone-300">
                        {s.category ?? "All SKUs"}
                        <span className="block text-[11px] text-stone-400 dark:text-stone-500">{s.branchCode}</span>
                      </td>
                      <td className="w-40 px-3 py-2.5">
                        <p className="mb-1 text-xs tabular-nums text-stone-700 dark:text-stone-300">
                          {s.countedItems}/{s.totalItems} · {pct}%
                        </p>
                        <Progress value={pct} className="h-1.5" aria-label={`${s.ref} counting progress`} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {s.countedItems === 0 ? (
                          <span className="text-stone-400 dark:text-stone-500">—</span>
                        ) : (
                          <>
                            <span className={varianceTone(s.varianceQtySum ?? "0")}>
                              {s.varianceQtySum != null && D(s.varianceQtySum).comparedTo(0) > 0 ? "+" : ""}
                              {s.varianceQtySum} units
                            </span>
                            <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                              ≈ KES {s.varianceValue} at cost
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-stone-600 dark:text-stone-300">
                        {s.createdByName}
                        <span className="block text-[11px] text-stone-400 dark:text-stone-500">
                          {new Date(s.createdAt).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant={s.status === "OPEN" ? "default" : "outline"}
                          className={cn("h-7 text-xs", s.status === "OPEN" && "bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500")}
                          onClick={() => void openSheet(s)}
                        >
                          {s.status === "OPEN" ? "Count" : "View"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* ── Create dialog ──────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New count sheet</DialogTitle>
            <DialogDescription>
              Freezes today&apos;s system quantities as the counting baseline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-category">Scope</Label>
              <Select value={createCategory} onValueChange={setCreateCategory}>
                <SelectTrigger id="st-category" aria-label="Count scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="ALL">All SKUs in this branch</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c} only</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Tip: count one category per sheet — faster to finish and apply.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-note">Note (optional)</Label>
              <Input
                id="st-note"
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder="e.g. Month-end shelf count — aisle 3–7"
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button
              onClick={() => void createSheet()}
              disabled={creating}
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              Create sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Count-sheet dialog ─────────────────────────────────────────────── */}
      <Dialog open={openSheetId != null} onOpenChange={(o) => { if (!o) setOpenSheetId(null); }}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{sheetMeta?.ref}</span>
              {sheetMeta && statusChip(sheetMeta.status)}
              {sheetMeta?.category && (
                <Badge variant="outline" className="text-[10px] text-stone-500 dark:text-stone-400">
                  {sheetMeta.category}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {sheetMeta?.status === "OPEN"
                ? "Type what is physically on the shelf — variance is calculated live."
                : "This sheet is read-only."}
            </DialogDescription>
          </DialogHeader>

          {itemsLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-500 dark:text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading items…
            </div>
          ) : (
            <>
              {/* Sheet toolbar: progress + filters */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Progress value={openProgress} className="h-2 flex-1" aria-label="Counting progress" />
                  <span className="text-xs font-medium tabular-nums text-stone-600 dark:text-stone-300">
                    {countedTotal}/{sheetMeta?.totalItems ?? 0} counted
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-40">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 dark:text-stone-500" aria-hidden />
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter by name or SKU…"
                      className="h-8 pl-8 text-xs"
                      aria-label="Filter count sheet items"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
                    <Switch checked={hideCounted} onCheckedChange={setHideCounted} aria-label="Hide counted rows" />
                    Hide counted
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 text-xs"
                    onClick={exportSheetCsv}
                    disabled={items.length === 0}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Export CSV
                  </Button>
                </div>
              </div>

              {/* Item rows */}
              <div
                ref={listRef}
                className="max-h-[42vh] overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800"
              >
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-stone-50 text-left text-[10px] font-medium tracking-wide text-stone-500 uppercase shadow-[0_1px_0_0_rgba(0,0,0,0.06)] dark:bg-stone-900 dark:text-stone-400">
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-2 py-2 text-right font-medium">System</th>
                      <th className="px-2 py-2 text-center font-medium">Counted</th>
                      <th className="px-2 py-2 text-right font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {visibleItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-xs text-stone-500 dark:text-stone-400">
                          Nothing matches the current filter.
                        </td>
                      </tr>
                    ) : (
                      visibleItems.map((it, idx) => {
                        const typed = counts[it.id]?.qty ?? "";
                        const shown = typed !== "" ? typed : it.countedQty ?? "";
                        const variance = shown !== "" ? D(shown).minus(D(it.systemQty)).toFixed(3) : null;
                        return (
                          <tr key={it.id} className="transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-900/50">
                            <td className="px-3 py-1.5">
                              <p className="max-w-64 truncate text-xs font-medium text-stone-800 dark:text-stone-200">{it.name}</p>
                              <p className="font-mono text-[10px] text-stone-400 dark:text-stone-500">{it.sku} · {it.unit}</p>
                            </td>
                            <td className="px-2 py-1.5 text-right text-xs tabular-nums text-stone-600 dark:text-stone-300">
                              {formatQty(it.systemQty, it.unit)}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {sheetMeta?.status === "OPEN" ? (
                                <Input
                                  data-item-id={it.id}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.001"
                                  value={typed}
                                  onChange={(e) =>
                                    setCounts((prev) => ({ ...prev, [it.id]: { qty: e.target.value, note: prev[it.id]?.note } }))
                                  }
                                  onKeyDown={(e) => onCountKeyDown(e, idx)}
                                  className="mx-auto h-7 w-24 text-center text-xs tabular-nums"
                                  aria-label={`Counted quantity for ${it.name}`}
                                />
                              ) : (
                                <span className="text-xs tabular-nums text-stone-700 dark:text-stone-300">
                                  {shown === "" ? "—" : shown}
                                </span>
                              )}
                            </td>
                            <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${variance ? varianceTone(variance) : "text-stone-400 dark:text-stone-500"}`}>
                              {variance ?? "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {sheetMeta?.status === "OPEN" && (
                <DialogFooter className="flex-col gap-2 border-t border-stone-200 pt-3 sm:flex-row sm:items-center dark:border-stone-800">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:text-rose-400"
                    onClick={() => void cancelSheet()}
                    disabled={closing}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Discard sheet
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void saveCounts()} disabled={saving}>
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden />}
                    Save counts
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setConfirmClose(true)}
                    disabled={saving || closing || countedTotal === 0}
                    className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Close &amp; apply
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Close & apply confirmation ─────────────────────────────────────── */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply “{sheetMeta?.ref}” to stock?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {countedTotal} SKU(s) counted, {Math.max((sheetMeta?.totalItems ?? 0) - countedTotal, 0)} not
                  counted (they will be skipped and stay open for the next count).
                </p>
                <p>
                  Stock levels are SET to the counted values and signed STOCK_COUNT adjustments are
                  written to the movement ledger under this sheet&apos;s ref.
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                  This cannot be undone — double-check the counts marked with variance first.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Keep counting</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void closeSheet(); }}
              disabled={closing}
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {closing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />}
              Apply to stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved-work guard hint when dialog closes with dirty rows — visual only */}
      {openSheetId == null && countedTotal > 0 && (
        <p className="sr-only"><XCircle aria-hidden /> Sheet closed with unsaved counts.</p>
      )}
    </Card>
  );
}
