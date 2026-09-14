"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlarmClock,
  BellOff,
  CalendarClock,
  Download,
  Eye,
  FileText,
  Landmark,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { formatKES } from "@/lib/format";
import { PROGRESS_PAID_BAR, riskBand, utilizationTone } from "@/lib/risk-band";
import { cn } from "@/lib/utils";
import { StatementDialog } from "@/components/credit/StatementDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// DebtAgingReport — AR aging, credit scoring, debt plans (repay/schedule/
// remind/new), guarantors and the SMS reminder log in one workspace.
// Palette: emerald (healthy) / amber (watch) / orange+rose (danger) on slate/stone.
// ─────────────────────────────────────────────────────────────────────────────

export interface DebtAgingReportProps {
  session: SessionUser;
  customers: Array<{
    id: string;
    name: string;
    currentBalance: string;
    creditLimit: string;
    kraPin?: string | null;
  }>;
}

interface AgingBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}
interface AgingCustomer {
  id: string;
  name: string;
  currentBalance: string;
  creditLimit: string;
  utilization: number;
  riskScore: number;
  phoneMasked: string | null;
  oldestDebtDays: number;
}
interface AgingData {
  generatedAt: string;
  buckets: AgingBucket[];
  kpis: {
    totalReceivables: number;
    overdueAmount: number;
    activePlans: number;
    defaultedPlans: number;
    collectionRate: number;
  };
  customers: AgingCustomer[];
}
interface PlanInstallment {
  id: string;
  seq: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  status: string;
  penaltyApplied: string;
  penalizedAt: string | null;
}
interface PlanRow {
  id: string;
  creditAccountId: string;
  saleId: string | null;
  customer: { id: string; name: string; currentBalance: string; riskScore: number };
  totalAmount: string;
  downPayment: string;
  balanceRemaining: string;
  paidTotal: string;
  outstanding: string;
  installmentCount: number;
  installmentFrequency: string;
  interestRate: string;
  status: string;
  startDate: string;
  dueDate: string;
  nextDueDate: string | null;
  overdueCount: number;
  installments: PlanInstallment[];
}
interface DueItem {
  installmentId: string;
  planId: string;
  planRef: string;
  planStatus: string;
  seq: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  customerName: string;
  phoneMasked: string | null;
  overdue: boolean;
}
interface SmsLogRow {
  id: string;
  phone: string;
  message: string;
  provider: string;
  status: string;
  customerName: string | null;
  createdAt: string;
}
interface RemindData {
  due: DueItem[];
  smsLogs: SmsLogRow[];
}
interface GuarantorRow {
  id: string;
  name: string;
  phoneMasked: string | null;
  nationalIdMasked: string | null;
  guaranteedAmount: string;
  createdAt: string;
}
interface GuarantorAccount {
  id: string;
  customerId: string;
  customerName: string;
  totalDebt: string;
  creditLimit: string;
}

type RepayMethod = "MPESA" | "CASH" | "BANK_TRANSFER";

const bucketChip: Record<string, string> = {
  current: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  past_due: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  delinquent: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900",
  severe: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
};

function statusChip(status: string): string {
  switch (status) {
    case "ACTIVE":
    case "PAID":
    case "SENT":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900";
    case "PARTIAL":
    case "PENDING":
    case "QUEUED":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900";
    case "OVERDUE":
    case "DEFAULTED":
    case "FAILED":
      return "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
    default:
      return "bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700"; // COMPLETED etc.
  }
}

// Risk chips use the SHARED banding helper (src/lib/risk-band.ts) so the
// directory and this report can never drift apart.
function riskChip(score: number): string {
  return riskBand(score).badgeClass;
}

function todayNairobi(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function apiSend<T>(
  url: string,
  method: "POST" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured loading skeletons — mirror the real content shape (KPI card =
// label + big value + caption lines; tables = pulsing rows; lists = item
// cards). Shells use semantic bg-card/border tokens → adapt to dark mode.
// ─────────────────────────────────────────────────────────────────────────────

function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card" aria-hidden>
      <div className="space-y-2 p-6 pb-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="p-6 pt-0">
        <Skeleton className="h-3 w-44" />
      </div>
    </div>
  );
}

function TableRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3.5" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-52" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function DebtAgingReport({ session, customers }: DebtAgingReportProps) {
  const isManager = session.role === "OWNER" || session.role === "MANAGER";

  const [aging, setAging] = useState<AgingData | null>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [remind, setRemind] = useState<RemindData | null>(null);
  const [loading, setLoading] = useState(true);

  // Statement dialog (per-customer ledger timeline + print + WhatsApp share)
  const [statementCustomer, setStatementCustomer] = useState<{ id: string; name: string } | null>(null);

  // Repay dialog
  const [repayPlan, setRepayPlan] = useState<PlanRow | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayMethod, setRepayMethod] = useState<RepayMethod>("MPESA");
  const [repayPhone, setRepayPhone] = useState("");
  const [repayReference, setRepayReference] = useState("");
  const [busy, setBusy] = useState(false);

  // Schedule + Remind dialogs
  const [schedulePlan, setSchedulePlan] = useState<PlanRow | null>(null);
  const [remindPlan, setRemindPlan] = useState<PlanRow | null>(null);
  const [remindChannel, setRemindChannel] = useState<"SMS" | "IN_PERSON">("SMS");
  const [remindPreview, setRemindPreview] = useState<string>("");

  // New plan dialog
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [np, setNp] = useState({
    customerId: "",
    amount: "",
    downPayment: "0",
    installmentCount: "3",
    frequency: "MONTHLY",
    interestRate: "0",
    lateFeeRate: "0",
    lateFeeFlat: "0",
    gracePeriodDays: "3",
    startDate: todayNairobi(),
    saleId: "",
    notes: "",
  });

  // Guarantors tab
  const creditCustomers = useMemo(
    () => customers.filter((c) => Number(c.creditLimit) > 0),
    [customers]
  );
  const [guarantorAccountId, setGuarantorAccountId] = useState<string>("");
  const [guarantorAccount, setGuarantorAccount] = useState<GuarantorAccount | null>(null);
  const [guarantors, setGuarantors] = useState<GuarantorRow[] | null>(null);
  const [guarantorForm, setGuarantorForm] = useState({ name: "", phone: "", nationalId: "", guaranteedAmount: "" });
  const [deleteGuarantor, setDeleteGuarantor] = useState<GuarantorRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([
        apiGet<AgingData>("/api/v1/credit/aging"),
        apiGet<{ plans: PlanRow[] }>("/api/v1/credit/debt-plans"),
      ]);
      setAging(a);
      setPlans(p.plans);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load credit data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadReminders = useCallback(async () => {
    try {
      setRemind(await apiGet<RemindData>("/api/v1/credit/remind"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load reminders");
    }
  }, []);

  const loadGuarantors = useCallback(async (accountId: string) => {
    if (!accountId) {
      setGuarantors(null);
      setGuarantorAccount(null);
      return;
    }
    try {
      const data = await apiGet<{ account: GuarantorAccount; guarantors: GuarantorRow[] }>(
        `/api/v1/credit/guarantors?creditAccountId=${encodeURIComponent(accountId)}`
      );
      setGuarantorAccount(data.account);
      setGuarantors(data.guarantors);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load guarantors");
    }
  }, []);

  // ── actions ──────────────────────────────────────────────────────────────
  function openRepay(plan: PlanRow) {
    const next = plan.installments.find((i) => i.status !== "PAID");
    const outstanding = next
      ? Math.max(0, Number(next.amountDue) - Number(next.amountPaid))
      : Number(plan.outstanding);
    setRepayAmount(String(outstanding));
    setRepayMethod("MPESA");
    setRepayPhone("");
    setRepayReference("");
    setRepayPlan(plan);
  }

  async function submitRepay() {
    if (!repayPlan) return;
    const amount = Number(repayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid repayment amount");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        creditAccountId: repayPlan.creditAccountId,
        amount,
        method: repayMethod,
        direct: true,
      };
      if (repayMethod === "MPESA" && repayPhone.trim()) payload.phone = repayPhone.trim();
      if (repayMethod === "BANK_TRANSFER" && repayReference.trim()) payload.reference = repayReference.trim();
      const data = await apiSend<{ checkoutRequestId?: string; remainingDebt?: string }>(
        "/api/v1/credit/repay",
        "POST",
        payload
      );
      if (data.checkoutRequestId) {
        toast.info("STK push sent — customer to enter PIN");
      } else {
        toast.success(
          `Repayment recorded${data.remainingDebt ? ` — remaining debt KES ${Number(data.remainingDebt).toLocaleString()}` : ""}`
        );
      }
      setRepayPlan(null);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Repayment failed");
    } finally {
      setBusy(false);
    }
  }

  function openRemind(plan: PlanRow) {
    setRemindChannel("SMS");
    setRemindPreview("");
    setRemindPlan(plan);
    apiGet<{ preview: string }>(
      `/api/v1/credit/remind?planId=${encodeURIComponent(plan.id)}`
    )
      .then((d) => setRemindPreview(d.preview))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to load message preview")
      );
  }

  async function submitRemind() {
    if (!remindPlan) return;
    setBusy(true);
    try {
      const data = await apiSend<{ status: string }>("/api/v1/credit/remind", "POST", {
        planId: remindPlan.id,
        channel: remindChannel,
      });
      toast.success(`Reminder ${data.status === "SENT" ? "sent" : "logged"} (${remindChannel.replace("_", "-")})`);
      setRemindPlan(null);
      void loadReminders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reminder failed");
    } finally {
      setBusy(false);
    }
  }

  async function quickRemind(planId: string) {
    try {
      await apiSend("/api/v1/credit/remind", "POST", { planId, channel: "SMS" });
      toast.success("SMS reminder sent");
      void loadReminders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reminder failed");
    }
  }

  async function submitNewPlan() {
    const amount = Number(np.amount);
    const downPayment = Number(np.downPayment || "0");
    const installmentCount = Number(np.installmentCount);
    if (!np.customerId) return void toast.error("Select a customer");
    if (!Number.isFinite(amount) || amount <= 0) return void toast.error("Enter a valid amount");
    if (!Number.isFinite(installmentCount) || installmentCount < 1 || installmentCount > 24)
      return void toast.error("Installments must be 1–24");
    if (downPayment > amount) return void toast.error("Down payment cannot exceed amount");
    setBusy(true);
    try {
      await apiSend("/api/v1/credit/debt-plans", "POST", {
        customerId: np.customerId,
        amount,
        downPayment,
        installmentCount,
        frequency: np.frequency,
        interestRate: Number(np.interestRate || "0"),
        lateFeeRate: Number(np.lateFeeRate || "0"),
        lateFeeFlat: Number(np.lateFeeFlat || "0"),
        gracePeriodDays: Number(np.gracePeriodDays || "3"),
        startDate: `${np.startDate}T00:00:00+03:00`, // Nairobi midnight
        ...(np.saleId.trim() ? { saleId: np.saleId.trim() } : {}),
        ...(np.notes.trim() ? { notes: np.notes.trim() } : {}),
      });
      toast.success("Debt plan created");
      setNewPlanOpen(false);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Plan creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitGuarantor() {
    if (!guarantorAccountId) return;
    const guaranteedAmount = Number(guarantorForm.guaranteedAmount);
    if (!guarantorForm.name.trim() || !guarantorForm.phone.trim() || !guarantorForm.nationalId.trim()) {
      return void toast.error("Name, phone and national ID are required");
    }
    if (!Number.isFinite(guaranteedAmount) || guaranteedAmount <= 0)
      return void toast.error("Enter a valid guaranteed amount");
    setBusy(true);
    try {
      await apiSend("/api/v1/credit/guarantors", "POST", {
        creditAccountId: guarantorAccountId,
        name: guarantorForm.name.trim(),
        phone: guarantorForm.phone.trim(),
        nationalId: guarantorForm.nationalId.trim(),
        guaranteedAmount,
      });
      toast.success("Guarantor added");
      setGuarantorForm({ name: "", phone: "", nationalId: "", guaranteedAmount: "" });
      void loadGuarantors(guarantorAccountId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add guarantor");
    } finally {
      setBusy(false);
    }
  }

  async function removeGuarantor(id: string) {
    try {
      await apiSend(`/api/v1/credit/guarantors?id=${encodeURIComponent(id)}`, "DELETE");
      toast.success("Guarantor removed");
      setDeleteGuarantor(null);
      if (guarantorAccountId) void loadGuarantors(guarantorAccountId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove guarantor");
    }
  }

  function exportAgingCsv() {
    if (!aging) return;
    const rows: string[][] = [
      ["Customer", "Phone", "Balance KES", "Credit Limit KES", "Utilization %", "Risk Score", "Oldest Debt Days"],
      ...aging.customers.map((c) => [
        c.name,
        c.phoneMasked ?? "",
        c.currentBalance,
        c.creditLimit,
        String(c.utilization),
        String(c.riskScore),
        String(c.oldestDebtDays),
      ]),
      [],
      ["Bucket", "Amount KES", "Accounts"],
      ...aging.buckets.map((b) => [b.label, String(b.amount), String(b.count)]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mbumah-credit-aging.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const agingTotal = aging?.buckets.reduce((s, b) => s + b.amount, 0) ?? 0;
  const bucketColor: Record<string, string> = {
    current: "bg-emerald-500",
    past_due: "bg-amber-500",
    delinquent: "bg-orange-500",
    severe: "bg-rose-500",
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* KPI cards */}
      {loading || !aging ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Wallet className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Total receivables
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums text-emerald-700 dark:text-emerald-400">{formatKES(aging.kpis.totalReceivables)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-stone-500 dark:text-stone-400">
              Across {aging.customers.length} debtor{aging.customers.length === 1 ? "" : "s"} with open balances
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <AlarmClock className="size-4 text-rose-600 dark:text-rose-400" aria-hidden /> Overdue
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums text-rose-700 dark:text-rose-400">{formatKES(aging.kpis.overdueAmount)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-stone-500 dark:text-stone-400">
              Arrears + past-due pending installments
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <CalendarClock className="size-4 text-slate-600 dark:text-slate-400" aria-hidden /> Plans
              </CardDescription>
              <CardTitle className="text-2xl">
                {aging.kpis.activePlans}
                <span className="ml-2 text-sm font-medium text-rose-600 dark:text-rose-400">{aging.kpis.defaultedPlans} defaulted</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-stone-500 dark:text-stone-400">Active repayment plans in progress</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Collection rate
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums">{aging.kpis.collectionRate.toFixed(1)}%</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Emerald fill — collection rate is money IN, never the default dark bar. */}
              <Progress
                value={Math.min(100, Math.max(0, aging.kpis.collectionRate))}
                className="h-2 [&_[data-slot=progress-indicator]]:bg-emerald-500"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Aging buckets + watchlist */}
      {loading || !aging ? (
        <div className="rounded-xl border bg-card" aria-hidden>
          <div className="flex items-start justify-between gap-3 p-6 pb-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
          <div className="space-y-4 p-6">
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-44 rounded-full" />
              ))}
            </div>
            <TableRowsSkeleton rows={4} />
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Aging buckets</CardTitle>
              <CardDescription>Age measured from the oldest unpaid charge per customer</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={exportAgingCsv}>
              <Download className="mr-1.5 size-4" aria-hidden /> CSV
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              {aging.buckets.map((b) =>
                b.amount > 0 ? (
                  <div
                    key={b.key}
                    className={bucketColor[b.key] ?? "bg-stone-400"}
                    style={{ width: `${agingTotal > 0 ? (b.amount / agingTotal) * 100 : 0}%` }}
                    title={`${b.label}: ${formatKES(b.amount)}`}
                  />
                ) : null
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {aging.buckets.map((b) => (
                <Badge key={b.key} variant="outline" className={`${bucketChip[b.key] ?? ""} px-2.5 py-1`}>
                  {b.label}: {formatKES(b.amount)} · {b.count} acct{b.count === 1 ? "" : "s"}
                </Badge>
              ))}
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">Credit scoring — top debtors</p>
              <ScrollArea className="max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Utilization</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead className="text-right">Oldest debt</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aging.customers.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-stone-500 dark:text-stone-400">{c.phoneMasked ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(c.currentBalance)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(100, c.utilization)}
                              className={cn("h-1.5 w-20", utilizationTone(c.utilization).bar)}
                            />
                            <span className={cn("text-xs tabular-nums", utilizationTone(c.utilization).text)}>
                              {c.utilization.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={riskChip(c.riskScore)}>
                            {c.riskScore}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-stone-500 dark:text-stone-400">{c.oldestDebtDays}d</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`View statement for ${c.name}`}
                            title={`View statement for ${c.name}`}
                            onClick={() => setStatementCustomer({ id: c.id, name: c.name })}
                          >
                            <FileText className="size-4" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {aging.customers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                            <Users className="size-8 text-stone-300 dark:text-stone-600" aria-hidden />
                            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No customers with open credit balances</p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">Debtors appear here as soon as credit balances age.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans / Guarantors / Reminders */}
      <Tabs defaultValue="plans">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="guarantors">Guarantors</TabsTrigger>
            <TabsTrigger value="reminders">Reminders</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RefreshCw className="mr-1.5 size-4" aria-hidden /> Refresh
            </Button>
            {isManager && (
              <Button size="sm" onClick={() => setNewPlanOpen(true)}>
                <UserPlus className="mr-1.5 size-4" aria-hidden /> New plan
              </Button>
            )}
          </div>
        </div>

        {/* ── Plans tab ── */}
        <TabsContent value="plans" className="mt-4">
          {loading || !plans ? (
            <div className="rounded-xl border bg-card p-6" aria-hidden>
              <TableRowsSkeleton rows={5} />
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-36">Paid</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Next due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => {
                      const total = Number(p.totalAmount) || 1;
                      const paidPct = Math.min(100, Math.max(0, ((total - Number(p.balanceRemaining)) / total) * 100));
                      const nextOverdue =
                        p.overdueCount > 0 ||
                        (p.nextDueDate ? new Date(p.nextDueDate).getTime() < Date.now() : false);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <p className="font-medium">{p.customer.name}</p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              {p.installmentCount}× {formatKES(Number(p.totalAmount) / Math.max(1, p.installmentCount))} ·
                              risk {p.customer.riskScore}
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(p.totalAmount)}</TableCell>
                          <TableCell>
                            <Progress value={paidPct} className={cn("h-2", PROGRESS_PAID_BAR)} />
                            <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">{paidPct.toFixed(0)}%</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                              {p.installmentFrequency.toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {p.nextDueDate ? (
                              <span className={nextOverdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-stone-600 dark:text-stone-500"}>
                                {format(new Date(p.nextDueDate), "d MMM yyyy")}
                              </span>
                            ) : (
                              <span className="text-stone-400 dark:text-stone-500">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusChip(p.status)}>
                              {p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.overdueCount > 0 ? (
                              <span className="font-medium text-rose-600 dark:text-rose-400">{p.overdueCount}</span>
                            ) : (
                              <span className="text-stone-400 dark:text-stone-500">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => openRepay(p)}>
                                <Wallet className="mr-1 size-3.5" /> Repay
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setSchedulePlan(p)}>
                                <Eye className="size-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openRemind(p)}>
                                <Send className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {plans.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                            <Landmark className="size-8 text-stone-300 dark:text-stone-600" aria-hidden />
                            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No debt plans yet</p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              Create one with “New plan” — schedules, repayments and reminders live here.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Guarantors tab ── */}
        <TabsContent value="guarantors" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Landmark className="size-4 text-slate-600 dark:text-slate-400" /> Credit accounts
                </CardTitle>
                <CardDescription>Customers with a credit line</CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={guarantorAccountId}
                  onValueChange={(v) => {
                    setGuarantorAccountId(v);
                    void loadGuarantors(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select credit account" />
                  </SelectTrigger>
                  <SelectContent>
                    {creditCustomers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — limit {formatKES(c.creditLimit)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {guarantorAccount && (
                  <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-900/60">
                    <p className="font-medium">{guarantorAccount.customerName}</p>
                    <p className="text-stone-500 dark:text-stone-400">
                      Debt {formatKES(guarantorAccount.totalDebt)} / limit {formatKES(guarantorAccount.creditLimit)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Guarantors (collateral)</CardTitle>
                <CardDescription>Contact details stored encrypted, shown masked</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!guarantorAccountId ? (
                  <p className="py-4 text-center text-sm text-stone-500 dark:text-stone-400">Select a credit account first.</p>
                ) : !guarantors ? (
                  <ListRowsSkeleton rows={2} />
                ) : guarantors.length > 0 ? (
                  <div className="space-y-2">
                    {guarantors.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60"
                      >
                        <div>
                          <p className="text-sm font-medium">{g.name}</p>
                          <p className="text-xs text-stone-500 dark:text-stone-400">
                            {g.phoneMasked ?? "—"} · ID {g.nationalIdMasked ?? "—"} · covers {formatKES(g.guaranteedAmount)}
                          </p>
                        </div>
                        {isManager && (
                          <Button variant="ghost" size="sm" onClick={() => setDeleteGuarantor(g)}>
                            <Trash2 className="size-4 text-rose-600 dark:text-rose-400" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {isManager && guarantorAccountId && (
                  <>
                    <Separator />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="Guarantor name"
                        value={guarantorForm.name}
                        onChange={(e) => setGuarantorForm({ ...guarantorForm, name: e.target.value })}
                      />
                      <Input
                        placeholder="Phone (+254…)"
                        value={guarantorForm.phone}
                        onChange={(e) => setGuarantorForm({ ...guarantorForm, phone: e.target.value })}
                      />
                      <Input
                        placeholder="National ID"
                        value={guarantorForm.nationalId}
                        onChange={(e) => setGuarantorForm({ ...guarantorForm, nationalId: e.target.value })}
                      />
                      <Input
                        type="number"
                        placeholder="Guaranteed amount KES"
                        value={guarantorForm.guaranteedAmount}
                        onChange={(e) => setGuarantorForm({ ...guarantorForm, guaranteedAmount: e.target.value })}
                      />
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void submitGuarantor()}>
                      <ShieldCheck className="mr-1.5 size-4" /> Add guarantor
                    </Button>
                  </>
                )}
                {guarantorAccountId && guarantors && guarantors.length === 0 && (
                  <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center dark:border-stone-700 dark:bg-stone-900/60">
                    <ShieldCheck className="mx-auto size-5 text-stone-400 dark:text-stone-500" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-stone-600 dark:text-stone-500">
                      No guarantors recorded for this account yet
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Add one above — contacts are stored encrypted and shown masked.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Reminders tab ── */}
        <TabsContent value="reminders" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlarmClock className="size-4 text-amber-600 dark:text-amber-400" /> Due soon / overdue
                </CardTitle>
                <CardDescription>Installments due within 3 days, overdue first</CardDescription>
              </CardHeader>
              <CardContent>
                {!remind ? (
                  <ListRowsSkeleton rows={3} />
                ) : (
                  <div className="space-y-2">
                    {remind.due.map((d) => (
                      <div
                        key={d.installmentId}
                        className="flex items-center justify-between rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {d.customerName}{" "}
                            <span className="text-xs font-normal text-stone-500 dark:text-stone-400">
                              · {d.planRef} #{d.seq}
                            </span>
                          </p>
                          <p className="text-xs text-stone-500 dark:text-stone-400">
                            {formatKES(Number(d.amountDue) - Number(d.amountPaid))} due{" "}
                            <span className={d.overdue ? "font-medium text-rose-600 dark:text-rose-400" : ""}>
                              {format(new Date(d.dueDate), "d MMM")}
                            </span>{" "}
                            · {d.phoneMasked ?? "no phone"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.overdue && (
                            <Badge variant="outline" className="border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
                              OVERDUE
                            </Badge>
                          )}
                          <Button variant="outline" size="sm" onClick={() => void quickRemind(d.planId)}>
                            <MessageSquare className="mr-1 size-3.5" /> Remind
                          </Button>
                        </div>
                      </div>
                    ))}
                    {remind.due.length === 0 && (
                      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center dark:border-stone-700 dark:bg-stone-900/60">
                        <AlarmClock className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                        <p className="text-sm font-medium text-stone-600 dark:text-stone-300">Nothing due in the next 3 days</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">
                          Collections are on schedule — reminders fire at T−3 days.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent reminders</CardTitle>
                <CardDescription>Last 20 SMS / in-person logs</CardDescription>
              </CardHeader>
              <CardContent>
                {!remind ? (
                  <ListRowsSkeleton rows={3} />
                ) : remind.smsLogs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center dark:border-stone-700 dark:bg-stone-900/60">
                    <BellOff className="mx-auto size-5 text-stone-400 dark:text-stone-500" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-stone-600 dark:text-stone-500">No reminders sent yet</p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Reminders fire automatically T−3 days before an installment due date.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>To</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {remind.smsLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{log.phone}</TableCell>
                          <TableCell className="max-w-56 truncate text-xs text-stone-500 dark:text-stone-400" title={log.message}>
                            {log.message}
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.provider === "in_person" ? "In person" : log.provider === "africastalking" ? "Africa's Talking" : log.provider}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusChip(log.status)}>
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-stone-500 dark:text-stone-400">
                            {format(new Date(log.createdAt), "d MMM HH:mm")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Repay dialog ── */}
      <Dialog open={!!repayPlan} onOpenChange={(open) => !open && setRepayPlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record repayment</DialogTitle>
            <DialogDescription>
              {repayPlan && `${repayPlan.customer.name} — ${formatKES(repayPlan.outstanding)} outstanding`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="repay-amount">Amount (KES)</Label>
              <Input
                id="repay-amount"
                type="number"
                min="0"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={repayMethod} onValueChange={(v) => setRepayMethod(v as RepayMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MPESA">M-Pesa</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {repayMethod === "MPESA" && (
              <div className="space-y-1.5">
                <Label htmlFor="repay-phone">Customer phone (STK push)</Label>
                <Input
                  id="repay-phone"
                  placeholder="+2547XXXXXXXX"
                  value={repayPhone}
                  onChange={(e) => setRepayPhone(e.target.value)}
                />
              </div>
            )}
            {repayMethod === "BANK_TRANSFER" && (
              <div className="space-y-1.5">
                <Label htmlFor="repay-ref">Bank reference</Label>
                <Input
                  id="repay-ref"
                  placeholder="e.g. FT2509ABC123"
                  value={repayReference}
                  onChange={(e) => setRepayReference(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepayPlan(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void submitRepay()}>
              Apply repayment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Schedule dialog ── */}
      <Dialog open={!!schedulePlan} onOpenChange={(open) => !open && setSchedulePlan(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Installment schedule</DialogTitle>
            <DialogDescription>
              {schedulePlan &&
                `${schedulePlan.customer.name} — ${formatKES(schedulePlan.totalAmount)} over ${schedulePlan.installmentCount} ${schedulePlan.installmentFrequency.toLowerCase()} installments`}
            </DialogDescription>
          </DialogHeader>
          {schedulePlan && (
            <ScrollArea className="max-h-80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount due</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Penalty</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedulePlan.installments.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.seq}</TableCell>
                      <TableCell>{format(new Date(i.dueDate), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-right">{formatKES(i.amountDue)}</TableCell>
                      <TableCell className="text-right">{formatKES(i.amountPaid)}</TableCell>
                      <TableCell className="text-right text-rose-600 dark:text-rose-400">
                        {Number(i.penaltyApplied) > 0 ? formatKES(i.penaltyApplied) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusChip(i.status)}>
                          {i.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Remind dialog ── */}
      <Dialog open={!!remindPlan} onOpenChange={(open) => !open && setRemindPlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send reminder</DialogTitle>
            <DialogDescription>{remindPlan?.customer.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={remindChannel} onValueChange={(v) => setRemindChannel(v as "SMS" | "IN_PERSON")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="IN_PERSON">In person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
              {remindPreview || "Loading message preview…"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemindPlan(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void submitRemind()}>
              <Send className="mr-1.5 size-4" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New plan dialog ── */}
      <Dialog open={newPlanOpen} onOpenChange={setNewPlanOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New debt plan</DialogTitle>
            <DialogDescription>
              Hard credit limit is enforced — over-limit charges are rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Customer</Label>
              <Select value={np.customerId} onValueChange={(v) => setNp({ ...np, customerId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — balance {formatKES(c.currentBalance)} / limit {formatKES(c.creditLimit)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-amount">Amount (KES)</Label>
              <Input id="np-amount" type="number" value={np.amount} onChange={(e) => setNp({ ...np, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-down">Down payment (KES)</Label>
              <Input id="np-down" type="number" value={np.downPayment} onChange={(e) => setNp({ ...np, downPayment: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Installments (1–24)</Label>
              <Input type="number" min={1} max={24} value={np.installmentCount} onChange={(e) => setNp({ ...np, installmentCount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={np.frequency} onValueChange={(v) => setNp({ ...np, frequency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="BIWEEKLY">Bi-weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-interest">Interest %</Label>
              <Input id="np-interest" type="number" value={np.interestRate} onChange={(e) => setNp({ ...np, interestRate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-lfr">Late fee %</Label>
              <Input id="np-lfr" type="number" value={np.lateFeeRate} onChange={(e) => setNp({ ...np, lateFeeRate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-lff">Late fee flat (KES)</Label>
              <Input id="np-lff" type="number" value={np.lateFeeFlat} onChange={(e) => setNp({ ...np, lateFeeFlat: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-grace">Grace days</Label>
              <Input id="np-grace" type="number" value={np.gracePeriodDays} onChange={(e) => setNp({ ...np, gracePeriodDays: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-start">Start date</Label>
              <Input id="np-start" type="date" value={np.startDate} onChange={(e) => setNp({ ...np, startDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-sale">Sale ref (optional)</Label>
              <Input id="np-sale" value={np.saleId} onChange={(e) => setNp({ ...np, saleId: e.target.value })} maxLength={60} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="np-notes">Notes (optional)</Label>
              <Input id="np-notes" value={np.notes} onChange={(e) => setNp({ ...np, notes: e.target.value })} maxLength={300} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPlanOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void submitNewPlan()}>
              Create plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete guarantor confirm ── */}
      <AlertDialog open={!!deleteGuarantor} onOpenChange={(open) => !open && setDeleteGuarantor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove guarantor?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteGuarantor &&
                `${deleteGuarantor.name} covering ${formatKES(deleteGuarantor.guaranteedAmount)} will be removed from this account. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700 dark:hover:bg-rose-500"
              onClick={() => deleteGuarantor && void removeGuarantor(deleteGuarantor.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Statement dialog (ledger timeline + print + WhatsApp share) ── */}
      <StatementDialog
        customerId={statementCustomer?.id ?? null}
        customerName={statementCustomer?.name ?? ""}
        open={!!statementCustomer}
        onOpenChange={(o) => !o && setStatementCustomer(null)}
        session={session}
      />
    </div>
  );
}
