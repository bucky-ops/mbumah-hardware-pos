// src/components/reports/EodReport.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  MessageCircle,
  PackageSearch,
  Percent,
  RefreshCw,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionUser } from "@/lib/types";
import { roleAtLeast } from "@/lib/types";
import { formatKES, formatQty } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// EodReport — End-of-Day report with a STRICT multi-tender split. Digital
// tenders (M-Pesa / bank / card) are settled straight to the bank and are
// therefore never mixed into drawer cash reconciliation.
// Also: NUMBERLESS WhatsApp share of a plain-text EOD summary (buildEodShareText
// + wa.me/?text=…, the Task 17-c pattern — no recipient number, no PII in URL).
// Palette: emerald (cash) / stone (M-Pesa) / slate (bank) / amber (card+credit).
// ─────────────────────────────────────────────────────────────────────────────

export interface EodReportProps {
  session: SessionUser;
  branches?: Array<{ id: string; name: string }>;
}

type TenderKey = "CASH" | "MPESA" | "BANK_TRANSFER" | "CARD" | "STORE_CREDIT";

interface EodData {
  date: string;
  tenders: Record<TenderKey, { total: number; count: number }>;
  drawer: {
    openingFloat: number;
    extraFloatIn: number;
    cashSales: number;
    payouts: number;
    expectedDrawer: number;
    countedAmount: number;
    variance: number | null;
    sessionsCount: number;
    allClosed: boolean;
  };
  vat: {
    gross: number;
    vatCollected: number;
    netExcl: number;
    creditOutstanding: number;
    vatInclusiveCount: number;
    vatExclusiveCount: number;
    basisNote: string;
    transactionCount: number;
  };
  hourly: Array<{ hour: number; cash: number; mpesa: number; bank: number; credit: number }>;
  topProducts: Array<{ name: string; qty: number; lineNet: number }>;
}

function todayNairobi(): string {
  // Nairobi is UTC+3 fixed (no DST) → shift now by +3h and take the UTC date.
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** ISO instant → Nairobi business date (UTC+3, same convention as the EOD API). */
function nairobiDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

// Task 21-b — closed-session slice returned by GET /api/v1/drawer (MANAGER+),
// used for the variance auto-alert banner.
interface DrawerVarianceRow {
  id: string;
  countedAmount: number;
  variance: number | null;
  closedAt: string | null;
  closedByName: string;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2025-01-09" (a Nairobi business date) → "9 Jan 2025". Parsed by parts —
 *  never via new Date(iso) — so no machine-TZ can shift the day. */
function formatBusinessDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[(m ?? 1) - 1]} ${y}`;
}

/** Nairobi wall-clock now (same UTC+3 shift as todayNairobi) → "HH:mm" + ISO date. */
function nairobiNowStamp(): { time: string; date: string } {
  const shifted = new Date(Date.now() + 3 * 3_600_000).toISOString();
  return { time: shifted.slice(11, 16), date: shifted.slice(0, 10) };
}

/** Plain-text EOD summary for the owner. Aggregates only — no staff phones, no
 *  customer names/numbers, no drawer-session detail (same disclosure surface as
 *  the on-screen cards). KES via the shared formatKES formatter. */
function buildEodShareText(d: EodData, branchName: string): string {
  const t = d.tenders;
  const tenderParts = [`Cash: ${formatKES(t.CASH.total)}`, `M-Pesa: ${formatKES(t.MPESA.total)}`];
  if (t.BANK_TRANSFER.total !== 0) tenderParts.push(`Bank transfer: ${formatKES(t.BANK_TRANSFER.total)}`);
  if (t.CARD.total !== 0) tenderParts.push(`Card: ${formatKES(t.CARD.total)}`);
  if (t.STORE_CREDIT.total !== 0) tenderParts.push(`Store credit: ${formatKES(t.STORE_CREDIT.total)}`);
  const nonCashPresent =
    t.MPESA.total !== 0 || t.BANK_TRANSFER.total !== 0 || t.CARD.total !== 0 || t.STORE_CREDIT.total !== 0;

  const lines = [
    "MBUMAH HARDWARE — End of Day report",
    `Business date: ${formatBusinessDate(d.date)} · Branch: ${branchName}`,
    tenderParts.join(" · ") + (nonCashPresent ? " · never in drawer" : ""),
    `Expected drawer: ${formatKES(d.drawer.expectedDrawer)}`,
    `Transactions: ${d.vat.transactionCount}`,
  ];
  if (d.vat.creditOutstanding !== 0) lines.push(`Credit issued: ${formatKES(d.vat.creditOutstanding)}`);
  if (d.drawer.payouts !== 0) lines.push(`Payouts: ${formatKES(d.drawer.payouts)}`);
  const stamp = nairobiNowStamp();
  lines.push("", `Generated ${stamp.time}, ${formatBusinessDate(stamp.date)}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured loading skeletons — each mirrors the real content shape (tender
// card = label + big number + caption lines; reconciliation table = 5 pulsing
// two-cell rows; hourly chart = bar field; top products = ranked rows).
// All shells use semantic bg-card/border tokens, so they adapt to dark mode.
// ─────────────────────────────────────────────────────────────────────────────

function TenderCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border bg-card">
          <div className="space-y-2 p-6 pb-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
          <div className="space-y-2 p-6 pt-0">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryTablesSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border bg-card">
          <div className="space-y-2 p-6 pb-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="space-y-3 p-6 pt-0">
            {[0, 1, 2, 3, 4].map((r) => (
              <div key={r} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HourlyChartSkeleton() {
  return (
    <div className="rounded-xl border bg-card" aria-hidden>
      <div className="space-y-2 p-6 pb-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="flex h-48 items-end gap-2 p-6 pt-0">
        {[42, 66, 38, 74, 92, 58, 46, 80, 96, 62, 44, 70].map((h, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function TopProductsSkeleton() {
  return (
    <div className="rounded-xl border bg-card" aria-hidden>
      <div className="space-y-2 p-6 pb-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="space-y-2 p-6 pt-0">
        {[0, 1, 2, 3, 4].map((r) => (
          <div
            key={r}
            className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800"
          >
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EodReport({ session, branches }: EodReportProps) {
  const isOwner = session.role === "OWNER";
  const isManager = roleAtLeast(session.role, "MANAGER");
  const [date, setDate] = useState<string>(todayNairobi());
  const [branchId, setBranchId] = useState<string>(isOwner ? (branches?.[0]?.id ?? "") : session.branchId);
  const [data, setData] = useState<EodData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [varianceRows, setVarianceRows] = useState<DrawerVarianceRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (isOwner && branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/v1/reports/eod?${params.toString()}`);
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? `Failed to load EOD (${res.status})`);
      }
      setData(json as EodData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load EOD report");
    } finally {
      setLoading(false);
    }
  }, [date, branchId, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  // VARIANCE AUTO-ALERT (Task 21-b): pull the branch's closed sessions and
  // surface any material variance (|v| > Ksh 1,000 — the close-governance
  // threshold) that froze on the SELECTED business date. Silent on failure —
  // the banner is an enhancement, never a blocker for the report itself.
  useEffect(() => {
    if (!isManager || !branchId) {
      setVarianceRows([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ branchId });
    fetch(`/api/v1/drawer?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { recentClosed?: DrawerVarianceRow[] } | null) => {
        if (cancelled || !json?.recentClosed) return;
        setVarianceRows(
          json.recentClosed.filter(
            (s) =>
              s.variance != null &&
              Math.abs(s.variance) > 1_000 &&
              s.closedAt != null &&
              nairobiDateOf(s.closedAt) === date,
          ),
        );
      })
      .catch(() => {
        /* silent — the EOD report stands on its own */
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, date, isManager]);

  // Share-text branch label: OWNER with a picker list → the selected branch's
  // name; OWNER without a list → whole-company scope; everyone else is pinned
  // to their own branch (session.branchName, id as last resort).
  const branchLabel =
    branches?.find((b) => b.id === branchId)?.name ??
    (isOwner ? "All branches" : (session.branchName ?? session.branchId));

  // NUMBERLESS wa.me share (Task 17-c pattern): no recipient number in the URL —
  // WhatsApp opens its own chat picker, so no phone/PII crosses the URL.
  const shareEod = useCallback(() => {
    if (!data) return;
    setSharing(true);
    try {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(buildEodShareText(data, branchLabel))}`,
        "_blank",
        "noopener,noreferrer"
      );
    } finally {
      // Popup chooser is async — hold the gate briefly so a double-click
      // can't spawn two choosers.
      setTimeout(() => setSharing(false), 500);
    }
  }, [data, branchLabel]);

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [
      ["Mbumah Hardware — EOD", data.date],
      [],
      ["Tender", "Total KES", "Transactions"],
      ["CASH", String(data.tenders.CASH.total), String(data.tenders.CASH.count)],
      ["MPESA", String(data.tenders.MPESA.total), String(data.tenders.MPESA.count)],
      ["BANK_TRANSFER", String(data.tenders.BANK_TRANSFER.total), String(data.tenders.BANK_TRANSFER.count)],
      ["CARD", String(data.tenders.CARD.total), String(data.tenders.CARD.count)],
      ["STORE_CREDIT", String(data.tenders.STORE_CREDIT.total), String(data.tenders.STORE_CREDIT.count)],
      [],
      ["Reconciliation", "Amount KES"],
      ["Opening float", String(data.drawer.openingFloat)],
      ["Extra float in", String(data.drawer.extraFloatIn)],
      ["Cash sales", String(data.drawer.cashSales)],
      ["Payouts (-)", String(data.drawer.payouts)],
      ["EXPECTED DRAWER", String(data.drawer.expectedDrawer)],
      ["Counted amount", String(data.drawer.countedAmount)],
      ["Variance", data.drawer.variance === null ? "open session" : String(data.drawer.variance)],
      [],
      ["VAT", "Amount KES"],
      ["Gross", String(data.vat.gross)],
      ["VAT 16% collected", String(data.vat.vatCollected)],
      ["Net excl VAT", String(data.vat.netExcl)],
      ["Credit sales outstanding", String(data.vat.creditOutstanding)],
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mbumah-eod-${data.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const d = data;

  // Theme-aware recharts skin (Task 21-e, same pattern as 21-c's SalesInsights):
  // recharts SVG attributes can't be reached by CSS dark: classes, so axis /
  // grid / default-tooltip colors are resolved from the active theme.
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartSkin = isDark
    ? {
        grid: "#57534e",
        axis: "#a8a29e",
        tooltipBg: "#1c1917",
        tooltipBorder: "#44403c",
        tooltipText: "#fafaf9",
      }
    : {
        grid: "#e7e5e4",
        axis: "#78716c",
        tooltipBg: "#ffffff",
        tooltipBorder: "#e7e5e4",
        tooltipText: "#1c1917",
      };

  // Genuinely-empty business day: no payments recorded (every tender sum 0)
  // AND zero transactions in bounds AND nothing moved through the drawer.
  // Only then do we swap the all-zero report for the friendly idle Alert.
  const idleDay =
    !!d &&
    d.vat.transactionCount === 0 &&
    d.tenders.CASH.total === 0 &&
    d.tenders.MPESA.total === 0 &&
    d.tenders.BANK_TRANSFER.total === 0 &&
    d.tenders.CARD.total === 0 &&
    d.tenders.STORE_CREDIT.total === 0 &&
    d.drawer.openingFloat === 0 &&
    d.drawer.extraFloatIn === 0 &&
    d.drawer.cashSales === 0 &&
    d.drawer.payouts === 0;

  // Hourly buckets with zero revenue across every tender would render as a
  // blank recharts canvas — swap in the friendly empty state instead.
  const hourlyEmpty =
    !!d && (d.hourly.length === 0 || d.hourly.every((h) => h.cash + h.mpesa + h.bank + h.credit === 0));

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="eod-date">Business date</Label>
            <Input id="eod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          {isOwner && branches && branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isOwner && !branches?.length && (
            <p className="pb-2 text-xs text-stone-500 dark:text-stone-400">Own-branch data (no branch list provided)</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1.5 size-4" aria-hidden />
            )}
            Refresh
          </Button>
          <Button variant="outline" size="sm" disabled={!d} onClick={exportCsv}>
            <Download className="mr-1.5 size-4" aria-hidden /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!d || sharing}
            title={d ? "Opens WhatsApp's chat picker — no recipient number is stored" : "Load the report first"}
            onClick={shareEod}
            aria-label="Share end-of-day summary via WhatsApp"
          >
            <MessageCircle className="mr-1.5 size-4" aria-hidden /> WhatsApp
          </Button>
        </div>
      </div>

      {/* VARIANCE AUTO-ALERT (Task 21-b) — material variance frozen on the
          selected business date, straight from the drawer close governance. */}
      {isManager && varianceRows.length > 0 && (
        <Alert className="animate-fade-in-up border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
          <AlertTitle className="flex items-center gap-2">
            Drawer variance detected on {formatBusinessDate(date)}
            <Badge variant="outline" className="border-rose-300 bg-rose-100 text-[10px] font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {varianceRows.length} session{varianceRows.length === 1 ? "" : "s"}
            </Badge>
          </AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {varianceRows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                    {(s.variance ?? 0) > 0 ? "+" : ""}{formatKES(s.variance ?? 0)}
                  </span>
                  <span>
                    counted {formatKES(s.countedAmount)} · closed {s.closedByName}
                    {s.closedAt &&
                      ` · ${new Date(s.closedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-300/80">
              Each close above required a written variance note — see the drawer card&apos;s Session history for the frozen explanations.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* STRICT tender split cards */}
      {loading || !d ? (
        <TenderCardsSkeleton />
      ) : idleDay ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Wallet className="size-4" aria-hidden />
          <AlertTitle>No sales recorded on this date</AlertTitle>
          <AlertDescription>Pick another business date or make the first sale of the day.</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/40">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                <Banknote className="size-4" aria-hidden /> Cash
              </CardDescription>
              <CardTitle className="text-xl tabular-nums text-emerald-900 dark:text-emerald-300">{formatKES(d.tenders.CASH.total)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">{d.tenders.CASH.count} cash payment{d.tenders.CASH.count === 1 ? "" : "s"}</p>
              <Separator className="my-2" />
              <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Expected drawer</p>
              <p className="text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-300">{formatKES(d.drawer.expectedDrawer)}</p>
            </CardContent>
          </Card>
          <Card className="border-stone-200 dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                <Smartphone className="size-4" aria-hidden /> M-Pesa
              </CardDescription>
              <CardTitle className="text-xl tabular-nums text-stone-900 dark:text-stone-50">{formatKES(d.tenders.MPESA.total)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-stone-500 dark:text-stone-400">{d.tenders.MPESA.count} transaction{d.tenders.MPESA.count === 1 ? "" : "s"}</p>
              <Badge variant="outline" className="mt-2 border-stone-300 bg-stone-100 text-[11px] text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                Settled to bank — NOT in drawer
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <Landmark className="size-4" aria-hidden /> Bank transfer
              </CardDescription>
              <CardTitle className="text-xl tabular-nums text-slate-900 dark:text-slate-50">{formatKES(d.tenders.BANK_TRANSFER.total)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-stone-500 dark:text-stone-400">{d.tenders.BANK_TRANSFER.count} transfer{d.tenders.BANK_TRANSFER.count === 1 ? "" : "s"}</p>
              <Badge variant="outline" className="mt-2 border-slate-300 bg-slate-100 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Settled to bank — NOT in drawer
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/40">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-amber-800 dark:text-amber-400">
                <CreditCard className="size-4" aria-hidden /> Card + Store credit
              </CardDescription>
              <CardTitle className="text-xl tabular-nums text-amber-900 dark:text-amber-300">
                {formatKES(d.tenders.CARD.total + d.tenders.STORE_CREDIT.total)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Card {formatKES(d.tenders.CARD.total)} ({d.tenders.CARD.count}) · Store credit{" "}
                {formatKES(d.tenders.STORE_CREDIT.total)} ({d.tenders.STORE_CREDIT.count})
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading || !d ? (
        <SummaryTablesSkeleton />
      ) : idleDay ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Drawer reconciliation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> Drawer reconciliation
              </CardTitle>
              <CardDescription>
                M-Pesa &amp; bank transfers excluded from drawer cash
                {d.drawer.sessionsCount > 0 ? ` · ${d.drawer.sessionsCount} drawer session${d.drawer.sessionsCount === 1 ? "" : "s"}` : " · no drawer session found"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Opening float</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(d.drawer.openingFloat)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Extra float in</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(d.drawer.extraFloatIn)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Cash sales</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(d.drawer.cashSales)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Payouts (−)</TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">−{formatKES(d.drawer.payouts)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-stone-50 dark:bg-stone-900/60">
                    <TableCell className="font-bold">EXPECTED DRAWER</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{formatKES(d.drawer.expectedDrawer)}</TableCell>
                  </TableRow>
                  {d.drawer.variance !== null && (
                    <TableRow>
                      <TableCell className="text-stone-600 dark:text-stone-400">Counted / variance</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${Math.abs(d.drawer.variance) < 0.01 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {formatKES(d.drawer.countedAmount)} / {d.drawer.variance >= 0 ? "+" : ""}
                        {formatKES(d.drawer.variance)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* VAT summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Percent className="size-4 text-slate-600 dark:text-slate-400" aria-hidden /> VAT &amp; credit summary
              </CardTitle>
              <CardDescription>{d.vat.basisNote}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">VAT 16% collected</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatKES(d.vat.vatCollected)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Net excl. VAT</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(d.vat.netExcl)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Gross (incl. VAT)</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(d.vat.gross)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-stone-600 dark:text-stone-400">Credit sales outstanding</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">{formatKES(d.vat.creditOutstanding)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                {d.vat.transactionCount} completed/partial transaction{d.vat.transactionCount === 1 ? "" : "s"} in bounds
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Hourly revenue */}
      {loading || !d ? (
        <HourlyChartSkeleton />
      ) : idleDay ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> Hourly revenue (08:00–19:00, Nairobi)
            </CardTitle>
            <CardDescription>Stacked by tender — card settlements grouped with bank</CardDescription>
          </CardHeader>
          <CardContent>
            {hourlyEmpty ? (
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center dark:border-stone-700 dark:bg-stone-900/60">
                <TrendingUp className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No revenue recorded in today&apos;s trading hours</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">Hourly buckets fill in as payments land.</p>
              </div>
            ) : (
            <ResponsiveContainer key={isDark ? "dark" : "light"} width="100%" height={220}>
              <BarChart data={d.hourly} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartSkin.grid} />
                <XAxis dataKey="hour" tickFormatter={(h: number) => `${h}:00`} stroke={chartSkin.axis} fontSize={12} />
                <YAxis stroke={chartSkin.axis} fontSize={12} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip
                  formatter={(value) => formatKES(Number(value))}
                  contentStyle={{
                    background: chartSkin.tooltipBg,
                    border: `1px solid ${chartSkin.tooltipBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: chartSkin.tooltipText,
                  }}
                  cursor={{ fill: isDark ? "rgba(168,162,158,0.12)" : "rgba(120,113,108,0.08)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cash" name="Cash" stackId="rev" fill="#10b981" radius={[0, 0, 2, 2]} />
                <Bar dataKey="mpesa" name="M-Pesa" stackId="rev" fill="#57534e" />
                <Bar dataKey="bank" name="Bank/Card" stackId="rev" fill={isDark ? "#94a3b8" : "#475569"} />
                <Bar dataKey="credit" name="Store credit" stackId="rev" fill="#f59e0b" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top products */}
      {loading || !d ? (
        <TopProductsSkeleton />
      ) : idleDay ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageSearch className="size-4 text-slate-600 dark:text-slate-400" aria-hidden /> Top products
            </CardTitle>
            <CardDescription>By net revenue across the day&apos;s transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {d.topProducts.map((p, idx) => (
                <div
                  key={`${p.name}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 transition-colors hover:bg-stone-100/70 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:bg-stone-900"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">{formatKES(p.lineNet)}</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">{formatQty(p.qty)}</p>
                  </div>
                </div>
              ))}
              {d.topProducts.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center dark:border-stone-700 dark:bg-stone-900/60">
                  <PackageSearch className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                  <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No product sales recorded for this date</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">Top movers appear here once transactions land.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
