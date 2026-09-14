"use client";

// src/components/reports/DrawerPanel.tsx
//
// Cash-drawer lifecycle card for the EOD tab — OPEN → float movements → COUNT.
//
//   • No open session (MANAGER+): inline "Open drawer session" form — opening
//     float with quick chips + optional note → POST /api/v1/drawer/open.
//     (One drawer per branch; the API 409s if a session is already open.)
//   • Open session: LIVE expected figure ledger (opening float + float-ins +
//     cash payments − payouts; digital tenders never sit in the drawer),
//     FLOAT IN / PAYOUT actions → POST /api/v1/drawer/movement, and the
//     counted close → POST /api/v1/drawer with a live variance preview
//     (BALANCED / SHORT / OVER).
//   • GOVERNANCE: |variance| > Ksh 1,000 at close requires a written note
//     (enforced server-side too — 400 without one). The EOD report reads the
//     frozen counted + variance figures.
//   • SESSION HISTORY (Task 21-a): paginated closed-session drill-down —
//     GET /api/v1/drawer/history — expandable rows with the closing summary
//     (float / float-in / payouts / expected / counted / variance), the full
//     FLOAT-IN & PAYOUT movement list and the frozen variance close-note.
//   • LIVE WALLBOARD (Task 21-b): the drawer state + history auto-revalidate
//     every 30 s while the tab is visible (paused in background tabs, instant
//     catch-up poll on return) — the header shows a pulsing LIVE · 30s badge.
//
//   STYLING: variance-driven color semantics — emerald when balanced, amber
//     for small drift (≤ ±100 KES), rose for material shortage/overage. Dark
//     theme variants included (Task 19; extended in Tasks 20–21).
//
//   Props: session (RBAC context), branchId (OWNER scope), onChanged (fired
//   after any successful mutation so the parent can refresh the EOD report).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatKES } from "@/lib/format";
import { roleAtLeast, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Wire types ───────────────────────────────────────────────────────────────

interface ActiveSession {
  id: string;
  branchId: string;
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  floatIn: number;
  payouts: number;
  cashReceived: number;
  expectedDrawer: number;
}

interface ClosedSession {
  id: string;
  countedAmount: number;
  variance: number | null;
  closedAt: string | null;
  closedByName: string;
}

interface DrawerResponse {
  active: ActiveSession | null;
  recentClosed: ClosedSession[];
}

// Task 21-a wire types — /api/v1/drawer/history.
interface HistoryMovement {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: string;
}
interface HistorySession {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string;
  closing: {
    openingFloat: number;
    floatIn: number;
    payouts: number;
    expectedDrawer: number | null;
    countedAmount: number | null;
    variance: number | null;
    closeNote: string | null;
  };
  movements: HistoryMovement[];
}
interface HistoryResponse {
  page: number;
  pageSize: number;
  total: number;
  sessions: HistorySession[];
}

/** Quick-float chips for opening a shift drawer (KES). */
const FLOAT_CHIPS = [5_000, 10_000, 20_000];
/** |variance| above which a written note is required at close (mirrors the API). */
const VARIANCE_NOTE_THRESHOLD = 1_000;
/** Wallboard auto-revalidation cadence (ms) — Task 21-b. */
const AUTO_REFRESH_MS = 30_000;
/** History page size for the drill-down list. */
const HISTORY_PAGE_SIZE = 6;

export interface DrawerPanelProps {
  session: SessionUser;
  /** OWNER branch scope from the header switcher (null = own branch). */
  branchId: string | null;
  /** Fired after a successful mutation so the parent can refresh EOD figures. */
  onChanged?: () => void;
}

/** Variance tone: emerald balanced · amber small drift · rose material. */
function varianceTone(variance: number): { text: string; chip: string; label: string } {
  if (variance === 0)
    return {
      label: "BALANCED",
      text: "text-emerald-700 dark:text-emerald-400",
      chip: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    };
  const abs = Math.abs(variance);
  if (abs <= 100)
    return {
      label: variance > 0 ? "OVER" : "SHORT",
      text: "text-amber-700 dark:text-amber-400",
      chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    };
  return {
    label: variance > 0 ? "OVER" : "SHORT",
    text: "text-rose-700 dark:text-rose-400",
    chip: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300",
  };
}

/** "2026-09-05T15:30:00Z" → "05 Sep" (en-KE, machine-TZ safe enough for a label). */
function histDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
}
function histTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

// ── Session history drill-down (Task 21-a) ───────────────────────────────────
// Expandable closed-session rows: header = date · window · who → who · counted
// + variance chip; expansion = closing-summary chips, the full movement list
// and the frozen variance close-note. Scroll-capped at max-h-96.
function SessionHistorySection({
  history,
  expandedId,
  onToggle,
  onPage,
}: {
  history: HistoryResponse | null;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onPage: (dir: 1 | -1) => void;
}) {
  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;
  return (
    <div className="mt-1 w-full space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-stone-400 uppercase dark:text-stone-500">
        <History className="size-3" aria-hidden />
        Session history
        {history && history.total > 0 && (
          <span className="normal-case text-stone-400 dark:text-stone-500">· {history.total} closed</span>
        )}
      </p>
      {!history || history.sessions.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-200 px-2.5 py-2 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          No closed drawer sessions yet — the audit trail appears here after the first counted close.
        </p>
      ) : (
        <div className="max-h-96 space-y-1.5 overflow-y-auto pr-0.5">
          {history.sessions.map((s) => {
            const tone = varianceTone(s.closing.variance ?? 0);
            const expanded = expandedId === s.id;
            return (
              <div
                key={s.id}
                className="overflow-hidden rounded-md border border-stone-100 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-900/60"
              >
                <button
                  type="button"
                  onClick={() => onToggle(s.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-stone-100/70 dark:hover:bg-stone-900"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-stone-600 dark:text-stone-300">
                    <ChevronDown
                      className={cn("size-3 shrink-0 text-stone-400 transition-transform", expanded && "rotate-180")}
                      aria-hidden
                    />
                    <span className="shrink-0 font-medium">{histDay(s.closedAt)}</span>
                    <span className="truncate text-stone-400 dark:text-stone-500">
                      {histTime(s.openedAt)}–{histTime(s.closedAt)} · {s.openedByName} → {s.closedByName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="font-medium tabular-nums text-stone-700 dark:text-stone-200">
                      {formatKES(s.closing.countedAmount ?? 0)}
                    </span>
                    <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-semibold tracking-wide", tone.chip)}>
                      {tone.label} {s.closing.variance != null && s.closing.variance !== 0 ? (s.closing.variance > 0 ? "+" : "") + formatKES(s.closing.variance) : ""}
                    </Badge>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-stone-100 px-2.5 py-2 dark:border-stone-800">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {[
                        { label: "Float", value: s.closing.openingFloat },
                        { label: "Float in", value: s.closing.floatIn },
                        { label: "Payouts", value: s.closing.payouts },
                        { label: "Expected", value: s.closing.expectedDrawer },
                      ].map((chip) => (
                        <div key={chip.label} className="rounded border border-stone-100 bg-white/60 px-1.5 py-1 dark:border-stone-800 dark:bg-stone-950/40">
                          <p className="text-[9px] font-medium tracking-wide text-stone-400 uppercase dark:text-stone-500">{chip.label}</p>
                          <p className="text-[11px] font-semibold tabular-nums text-stone-700 dark:text-stone-200">
                            {chip.value != null ? formatKES(chip.value) : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                    {s.movements.length > 0 ? (
                      <div className="divide-y divide-stone-100 dark:divide-stone-800">
                        {s.movements.map((m) => {
                          const isIn = m.type === "FLOAT_IN";
                          return (
                            <div key={m.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                              <span className="flex min-w-0 items-center gap-1.5 text-stone-500 dark:text-stone-400">
                                {isIn ? (
                                  <ArrowDownToLine className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                ) : (
                                  <ArrowUpFromLine className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                                )}
                                <span className="shrink-0 font-medium">{isIn ? "Float in" : "Payout"}</span>
                                {m.note && <span className="truncate text-stone-400 dark:text-stone-500">· {m.note}</span>}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 font-medium tabular-nums",
                                  isIn ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                                )}
                              >
                                {isIn ? "+" : "−"}
                                {formatKES(m.amount)}
                                <span className="ml-1.5 text-[10px] text-stone-400 dark:text-stone-500">{histTime(m.createdAt)}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-stone-400 dark:text-stone-500">No mid-shift movements recorded.</p>
                    )}
                    {s.closing.closeNote && (
                      <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        <span className="font-semibold">Variance note:</span> {s.closing.closeNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {history && history.total > history.pageSize && (
        <div className="flex items-center justify-between pt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
          <span>
            Page {history.page} of {totalPages}
          </span>
          <span className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              disabled={history.page <= 1}
              onClick={() => onPage(-1)}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              disabled={history.page >= totalPages}
              onClick={() => onPage(1)}
            >
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

export function DrawerPanel({ session, branchId, onChanged }: DrawerPanelProps) {
  const isManager = roleAtLeast(session.role, "MANAGER");
  const [data, setData] = useState<DrawerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Open-session form (empty state).
  const [openFloat, setOpenFloat] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [opening, setOpening] = useState(false);

  // Movement dialog (active state).
  const [movementType, setMovementType] = useState<"FLOAT_IN" | "PAYOUT" | null>(null);
  const [movementAmount, setMovementAmount] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [moving, setMoving] = useState(false);

  // Session history (Task 21-a).
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchState = useCallback(async (silent = false) => {
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/v1/drawer?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DrawerResponse);
    } catch {
      if (!silent) toast.error("Could not load the drawer state");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  const fetchHistory = useCallback(
    async (page = historyPage, silent = false) => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(HISTORY_PAGE_SIZE) });
        if (branchId) params.set("branchId", branchId);
        const res = await fetch(`/api/v1/drawer/history?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setHistory((await res.json()) as HistoryResponse);
      } catch {
        if (!silent) toast.error("Could not load the session history");
      }
    },
    [branchId, historyPage],
  );

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (isManager) void fetchHistory(1);
  }, [fetchState, isManager]);

  // LIVE WALLBOARD (Task 21-b): revalidate every 30 s while the tab is
  // visible; paused in background tabs, one catch-up poll on return.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void fetchState(true);
      if (isManager) void fetchHistory(historyPage, true);
    };
    const id = window.setInterval(tick, AUTO_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchState, fetchHistory, historyPage, isManager]);

  const active = data?.active ?? null;

  // History drill-down interactions (Task 21-a).
  const toggleHistoryRow = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);
  const pageHistory = useCallback(
    (dir: 1 | -1) => {
      const next = Math.max(1, (history?.page ?? 1) + dir);
      setHistoryPage(next);
      setExpandedId(null);
      void fetchHistory(next);
    },
    [fetchHistory, history?.page],
  );

  // Live variance preview while the manager types the counted amount.
  const preview = useMemo(() => {
    if (!active || counted.trim() === "") return null;
    const value = Number(counted);
    if (!Number.isFinite(value) || value < 0) return null;
    return { value, variance: Math.round((value - active.expectedDrawer) * 100) / 100 };
  }, [active, counted]);

  const materialVariance = preview != null && Math.abs(preview.variance) > VARIANCE_NOTE_THRESHOLD;

  // ── Open a session ─────────────────────────────────────────────────────────
  const openDrawer = async () => {
    const value = Number(openFloat);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter the physical float counted into the till");
      return;
    }
    setOpening(true);
    try {
      const res = await fetch("/api/v1/drawer/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingFloat: value,
          ...(openNote.trim().length >= 3 ? { note: openNote.trim() } : {}),
          ...(branchId ? { branchId } : {}),
        }),
      });
      const body = (await res.json()) as { message?: string; session?: { openingFloat: number } };
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      toast.success("Drawer session opened", {
        description: `${formatKES(body.session?.openingFloat ?? value)} float recorded — the expected figure now tracks live.`,
      });
      setOpenFloat("");
      setOpenNote("");
      await fetchState();
      void fetchHistory(1, true);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the drawer");
    } finally {
      setOpening(false);
    }
  };

  // ── Float-in / payout ──────────────────────────────────────────────────────
  const submitMovement = async () => {
    if (!active || !movementType) return;
    const value = Number(movementAmount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a movement amount");
      return;
    }
    if (movementType === "PAYOUT" && value >= 50_000 && movementNote.trim().length < 3) {
      toast.error("A note is required for payouts of Ksh 50,000 or more");
      return;
    }
    setMoving(true);
    try {
      const res = await fetch("/api/v1/drawer/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: movementType,
          amount: value,
          sessionId: active.id,
          ...(movementNote.trim().length >= 3 ? { note: movementNote.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { message?: string; summary?: ActiveSession };
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      toast.success(
        movementType === "FLOAT_IN"
          ? `Float in ${formatKES(value)} recorded`
          : `Payout ${formatKES(value)} recorded`,
        { description: `Expected drawer is now ${formatKES(body.summary?.expectedDrawer ?? 0)}.` },
      );
      setMovementType(null);
      setMovementAmount("");
      setMovementNote("");
      await fetchState();
      void fetchHistory(historyPage, true);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the movement");
    } finally {
      setMoving(false);
    }
  };

  // ── Counted close ──────────────────────────────────────────────────────────
  const closeDrawer = async () => {
    if (!active || !preview) return;
    if (materialVariance && closeNote.trim().length < 3) {
      toast.error("Explain the variance in a note (required above Ksh 1,000)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/drawer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: active.id,
          countedAmount: preview.value,
          ...(closeNote.trim().length >= 3 ? { note: closeNote.trim() } : {}),
        }),
      });
      const data2 = (await res.json()) as {
        summary?: { expectedDrawer: number; countedAmount: number; variance: number; state: string };
        message?: string;
      };
      if (!res.ok) throw new Error(data2.message ?? `HTTP ${res.status}`);
      const s = data2.summary!;
      if (s.state === "BALANCED") {
        toast.success("Drawer balanced", { description: `Counted ${formatKES(s.countedAmount)} — matches expected exactly.` });
      } else {
        toast.warning(`Drawer ${s.state.toLowerCase()} by ${formatKES(Math.abs(s.variance))}`, {
          description: `Counted ${formatKES(s.countedAmount)} vs expected ${formatKES(s.expectedDrawer)} — variance is frozen on the session for the EOD report.`,
        });
      }
      setCounted("");
      setCloseNote("");
      setConfirmOpen(false);
      await fetchState();
      void fetchHistory(1, true);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close the drawer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-stone-200 shadow-sm dark:border-stone-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
          Cash drawer
          {isManager && (
            <span className="ml-auto flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400"
                title={`Drawer figures revalidate every ${AUTO_REFRESH_MS / 1000} s while this tab is open`}
              >
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75 motion-reduce:hidden" aria-hidden />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden />
                </span>
                Live · {AUTO_REFRESH_MS / 1000}s
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void fetchState();
                  void fetchHistory(historyPage);
                }}
                aria-label="Refresh drawer state"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
                <span className="sr-only sm:not-sr-only sm:text-xs">Refresh</span>
              </Button>
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Open the shift float, record mid-shift movements, then count &amp; close — M-Pesa and bank transfers never sit in the drawer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-stone-500 dark:text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading drawer…
          </div>
        ) : !active ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center dark:border-stone-800">
            <Banknote className="h-8 w-8 text-stone-300 dark:text-stone-600" aria-hidden />
            <div>
              <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No open drawer session</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-stone-500 dark:text-stone-400">
                {isManager
                  ? "Open the shift with the physical float counted into the till — this card then tracks the expected cash live."
                  : "The next shift opens a session with a float; this card then tracks the expected cash live."}
              </p>
            </div>

            {isManager && (
              <div className="w-full max-w-md space-y-2.5 rounded-lg border border-stone-100 bg-stone-50/60 p-3 text-left dark:border-stone-800 dark:bg-stone-900/60">
                <div className="space-y-1.5">
                  <Label htmlFor="drawer-open-float" className="text-xs">
                    Opening float (KES)
                  </Label>
                  <Input
                    id="drawer-open-float"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={openFloat}
                    onChange={(e) => setOpenFloat(e.target.value)}
                    placeholder="0.00"
                    className="text-right font-mono tabular-nums"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {FLOAT_CHIPS.map((chip) => (
                      <Button
                        key={chip}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs tabular-nums"
                        onClick={() => setOpenFloat(String(chip))}
                      >
                        {formatKES(chip)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="drawer-open-note" className="text-xs">
                    Note <span className="text-stone-400 dark:text-stone-500">(optional · required above Ksh 200,000)</span>
                  </Label>
                  <Input
                    id="drawer-open-note"
                    value={openNote}
                    onChange={(e) => setOpenNote(e.target.value)}
                    placeholder="e.g. Change-fund restock for weekend shift"
                    maxLength={255}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  disabled={opening || openFloat.trim() === "" || Number(openFloat) < 0 || !Number.isFinite(Number(openFloat))}
                  onClick={() => void openDrawer()}
                >
                  {opening ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ArrowDownToLine className="mr-1 h-3.5 w-3.5" aria-hidden />
                  )}
                  Open drawer session
                </Button>
              </div>
            )}

            {isManager && (
              <SessionHistorySection history={history} expandedId={expandedId} onToggle={toggleHistoryRow} onPage={pageHistory} />
            )}
          </div>
        ) : (
          <>
            {/* Live expected-figure ledger */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Opening float", value: active.openingFloat },
                { label: "Float in", value: active.floatIn },
                { label: "Cash sales", value: active.cashReceived },
                { label: "Payouts", value: active.payouts },
              ].map((row) => (
                <div
                  key={row.label}
                  className="rounded-lg border border-stone-100 bg-stone-50/60 p-2 dark:border-stone-800 dark:bg-stone-900/60"
                >
                  <p className="text-[10px] font-medium tracking-wide text-stone-400 uppercase dark:text-stone-500">{row.label}</p>
                  <p className="text-sm font-semibold tabular-nums text-stone-800 dark:text-stone-200">{formatKES(row.value)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div>
                <p className="text-[10px] font-medium tracking-wide text-emerald-700/80 uppercase dark:text-emerald-400/80">
                  Expected in drawer (live)
                </p>
                <p className="text-xl font-bold tabular-nums text-emerald-900 dark:text-emerald-200">
                  {formatKES(active.expectedDrawer)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isManager && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      onClick={() => { setMovementType("FLOAT_IN"); setMovementAmount(""); setMovementNote(""); }}
                    >
                      <ArrowDownToLine className="mr-1 h-3.5 w-3.5" aria-hidden /> Float in
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
                      onClick={() => { setMovementType("PAYOUT"); setMovementAmount(""); setMovementNote(""); }}
                    >
                      <Banknote className="mr-1 h-3.5 w-3.5" aria-hidden /> Payout
                    </Button>
                  </>
                )}
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Opened {new Date(active.openedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })} by{" "}
                  {active.openedByName}
                </p>
              </div>
            </div>

            {/* Count input + live variance preview */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="drawer-counted" className="text-xs">
                  Counted cash (KES)
                </Label>
                <Input
                  id="drawer-counted"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0.00"
                  className="w-40 text-right font-mono tabular-nums"
                />
              </div>
              {preview && (
                <div className="flex items-center gap-2 pb-0.5">
                  <Badge variant="outline" className={cn("text-[10px] font-semibold tracking-wide", varianceTone(preview.variance).chip)}>
                    {varianceTone(preview.variance).label} {preview.variance > 0 ? "+" : ""}
                    {formatKES(preview.variance)}
                  </Badge>
                  {materialVariance && (
                    <span className="flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-400">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> note required
                    </span>
                  )}
                  {preview.variance !== 0 && !materialVariance && (
                    <span className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                      <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden /> recount before closing
                    </span>
                  )}
                  {preview.variance === 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> matches expected
                    </span>
                  )}
                </div>
              )}
              <Button
                size="sm"
                className="ml-auto bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                disabled={!preview || busy}
                onClick={() => { setCloseNote(""); setConfirmOpen(true); }}
              >
                <Lock className="mr-1 h-3.5 w-3.5" aria-hidden /> Count &amp; close
              </Button>
            </div>

            {isManager && (
              <SessionHistorySection history={history} expandedId={expandedId} onToggle={toggleHistoryRow} onPage={pageHistory} />
            )}
          </>
        )}
      </CardContent>

      {/* ── Movement dialog (float-in / payout) ─────────────────────────────── */}
      <Dialog open={movementType != null} onOpenChange={(o) => { if (!o) setMovementType(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {movementType === "PAYOUT" ? (
                <Banknote className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              ) : (
                <ArrowDownToLine className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
              )}
              {movementType === "PAYOUT" ? "Record cash payout" : "Record float in"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {movementType === "PAYOUT"
                ? "Cash leaving the till mid-shift — supplier payments, petty cash or a banking drop. The expected figure drops immediately."
                : "Extra change-fund added to the till mid-shift. The expected figure rises immediately."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="movement-amount" className="text-xs">
                Amount (KES)
              </Label>
              <Input
                id="movement-amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="0.00"
                className="text-right font-mono tabular-nums"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-note" className="text-xs">
                Note{" "}
                <span className="text-stone-400 dark:text-stone-500">
                  {movementType === "PAYOUT" ? "(required ≥ Ksh 50,000)" : "(optional)"}
                </span>
              </Label>
              <Input
                id="movement-note"
                value={movementNote}
                onChange={(e) => setMovementNote(e.target.value)}
                placeholder={movementType === "PAYOUT" ? "e.g. Cash banking drop #412" : "e.g. Change-fund top-up"}
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMovementType(null)} disabled={moving}>
              Cancel
            </Button>
            <Button
              size="sm"
              className={cn(
                movementType === "PAYOUT"
                  ? "bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                  : "bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500",
              )}
              disabled={moving || movementAmount.trim() === "" || Number(movementAmount) <= 0}
              onClick={() => void submitMovement()}
            >
              {moving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {movementType === "PAYOUT" ? "Record payout" : "Record float in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Close confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close the drawer session?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  You counted <span className="font-semibold tabular-nums">{preview ? formatKES(preview.value) : "—"}</span>{" "}
                  against an expected <span className="font-semibold tabular-nums">{active ? formatKES(active.expectedDrawer) : "—"}</span>.
                </p>
                {preview && (
                  <p
                    className={cn(
                      "rounded-md px-2 py-1.5 text-xs",
                      varianceTone(preview.variance).text,
                      preview.variance === 0
                        ? "border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50"
                        : materialVariance
                          ? "border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/50"
                          : "border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
                    )}
                  >
                    Variance {preview.variance > 0 ? "+" : ""}{formatKES(preview.variance)} will be frozen on the
                    session and shown in the EOD report.
                  </p>
                )}
                {materialVariance && (
                  <div className="space-y-1.5">
                    <Label htmlFor="drawer-close-note" className="text-xs">
                      Variance note <span className="text-rose-600 dark:text-rose-400">(required above Ksh {formatKES(VARIANCE_NOTE_THRESHOLD)})</span>
                    </Label>
                    <Textarea
                      id="drawer-close-note"
                      value={closeNote}
                      onChange={(e) => setCloseNote(e.target.value)}
                      placeholder="e.g. Customer refund paid from till, receipt #MBM-…"
                      rows={2}
                      maxLength={255}
                    />
                  </div>
                )}
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  The session cannot be reopened — a new shift opens a fresh drawer with its own float.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep counting</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void closeDrawer(); }}
              disabled={busy || (materialVariance && closeNote.trim().length < 3)}
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              Close drawer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
