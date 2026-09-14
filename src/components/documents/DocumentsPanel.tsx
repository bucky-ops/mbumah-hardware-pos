"use client";

// src/components/documents/DocumentsPanel.tsx
//
// Documents & Quotations — the Document & Workflow Correlation Engine UI.
// Pipeline: QUOTE → PROFORMA → ORDER → SALE (receipt / debt ledger on SALE).
//
// The API (/api/v1/documents) is authoritative: the list endpoint drives the
// stat chips + table, the detail endpoint carries `nextTargets` which gates
// every conversion target choice. All money arrives as strings and is only
// formatted for display (formatKES) — except simple sums in the creation
// dialog, which reuse the shared computeCart() math from src/lib/format.ts so
// the client preview can never drift from the server's persisted totals.
//
// Palette: emerald (success/primary) / amber (pending/watch) / rose (danger)
// on slate+stone neutrals. Every custom class carries a dark: pair.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { format, isValid as isValidDate } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Check,
  Eye,
  FileText,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Smartphone,
  Trash2,
  UserX,
} from "lucide-react";
import { formatKES, formatQty, computeCart } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
// Frozen API contract types (/api/v1/documents, /api/v1/documents/convert)
// ─────────────────────────────────────────────────────────────────────────────

export type DocType = "QUOTE" | "PROFORMA" | "ORDER" | "SALE";
export type DocStatus =
  | "OPEN"
  | "CONVERTED"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED"
  | "CREDIT"
  | "PARTIAL";
type ConvertTarget = "PROFORMA" | "ORDER" | "SALE";
type DocPaymentMethod = "CASH" | "MPESA" | "BANK_TRANSFER";

interface DocumentSummary {
  id: string;
  ref: string;
  type: DocType;
  status: DocStatus;
  totalAmount: string;
  balanceDue: string;
  customerId: string | null;
  customerName: string | null;
  itemCount: number;
  createdAt: string;
  validUntil: string | null;
  convertedFromId: string | null;
  createdBy: string;
  branchCode: string;
}

interface DocumentItem {
  id: string;
  productId: string | null;
  description: string;
  uom: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  lineDiscount: string;
  lineNet: string;
  vatAmount: string;
  lineTotal: string;
  taxCategory: string;
}

interface DocumentPayment {
  method: string;
  amount: string;
  receivedAt: string;
}

interface DocumentDTO extends DocumentSummary {
  subtotal: string;
  discountAmount: string;
  vatAmount: string;
  amountPaid: string;
  vatInclusive: boolean;
  notes: string | null;
  branchId: string;
  convertedFromRef: string | null;
  items: DocumentItem[];
  payments: DocumentPayment[];
  nextTargets: ConvertTarget[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge + label maps (light/dark pairs everywhere)
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<DocType, string> = {
  QUOTE:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  PROFORMA:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  ORDER:
    "border-emerald-300 bg-transparent text-emerald-800 dark:border-emerald-700 dark:text-emerald-300",
  SALE:
    "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-600 dark:bg-emerald-600 dark:text-white",
};

const TYPE_LABEL: Record<DocType, string> = {
  QUOTE: "Quotation",
  PROFORMA: "Proforma",
  ORDER: "Order",
  SALE: "Invoice",
};

const STATUS_BADGE: Record<DocStatus, string> = {
  OPEN: "border-stone-300 bg-transparent text-stone-600 dark:border-stone-600 dark:text-stone-300",
  CONVERTED:
    "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
  COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  CREDIT:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  PARTIAL:
    "border-amber-300 bg-transparent text-amber-700 dark:border-amber-800 dark:text-amber-300",
  CANCELLED:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  EXPIRED:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

const PAYMENT_BADGE: Record<string, string> = {
  CASH: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  MPESA: "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  BANK_TRANSFER:
    "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Cash",
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank transfer",
};

const TARGET_LABEL: Record<ConvertTarget, string> = {
  PROFORMA: "Proforma Invoice",
  ORDER: "Sales Order",
  SALE: "Invoice (Sale)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isValidDate(d) ? d : null;
}

/** Safe "d MMM yyyy HH:mm" — returns "—" for null/invalid dates. */
function fmtDateTime(value: string | null | undefined): string {
  const d = safeDate(value);
  return d ? format(d, "d MMM yyyy HH:mm") : "—";
}

/** Safe "d MMM yyyy" — returns "—" for null/invalid dates. */
function fmtDate(value: string | null | undefined): string {
  const d = safeDate(value);
  return d ? format(d, "d MMM yyyy") : "—";
}

/** "amber" when validUntil is within 7 days, "rose" once past, else null. */
function validUntilTone(value: string | null): "amber" | "rose" | null {
  const d = safeDate(value);
  if (!d) return null;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "rose";
  if (days <= 7) return "amber";
  return null;
}

const VALID_UNTIL_CLASS: Record<"amber" | "rose", string> = {
  amber: "font-medium text-amber-700 dark:text-amber-400",
  rose: "font-medium text-rose-600 dark:text-rose-400",
};

/** Draft line in the quotation builder — unitPrice comes from the product. */
interface DraftLine {
  productId: string;
  sku: string;
  description: string;
  uom: string;
  unitPrice: string;
  isTaxExempt: boolean;
  qty: string;
  discountPct: string;
}

interface ProductHit {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sellingPrice: string;
  stockQty: string;
  isTaxExempt: boolean;
}

interface CustomerOption {
  id: string;
  name: string;
  phoneMasked?: string | null;
}

const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────────────────────

function StatChipSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200 bg-card p-4 dark:border-stone-800" aria-hidden>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-7 w-28" />
    </div>
  );
}

function TableRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3.5 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

export default function DocumentsPanel() {
  // ── list + chips state ─────────────────────────────────────────────────────
  const [baseDocs, setBaseDocs] = useState<DocumentSummary[]>([]); // unfiltered (drives chips)
  const [docs, setDocs] = useState<DocumentSummary[]>([]); // filtered (drives table)
  const [loading, setLoading] = useState(true);
  const [chipsLoading, setChipsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | DocType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | DocStatus>("ALL");
  const [refreshKey, setRefreshKey] = useState(0);

  // ── detail dialog ──────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<DocumentDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── conversion dialog ──────────────────────────────────────────────────────
  const [convertSource, setConvertSource] = useState<DocumentDTO | null>(null);
  const [targetType, setTargetType] = useState<ConvertTarget>("PROFORMA");
  const [payMethod, setPayMethod] = useState<DocPaymentMethod>("CASH");
  const [payAmount, setPayAmount] = useState("");
  const [useCredit, setUseCredit] = useState(false);
  const [convertValidUntil, setConvertValidUntil] = useState("");
  const [convertNotes, setConvertNotes] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  // ── new quotation dialog ───────────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [prodQuery, setProdQuery] = useState("");
  const [prodHits, setProdHits] = useState<ProductHit[]>([]);
  const [prodSearching, setProdSearching] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [orderDiscountPct, setOrderDiscountPct] = useState("0");
  const [vatInclusive, setVatInclusive] = useState(false);
  const [newValidUntil, setNewValidUntil] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const prodRunRef = useRef(0);

  // ── data loading (list re-fetches on filter change; chips only on refresh) ─
  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const data = await apiGet<{ items: DocumentSummary[] }>(`/api/v1/documents?${params.toString()}`);
      setDocs(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  const fetchBase = useCallback(async () => {
    setChipsLoading(true);
    try {
      const data = await apiGet<{ items: DocumentSummary[] }>("/api/v1/documents?limit=100");
      setBaseDocs(data.items ?? []);
    } catch {
      // chips are derived stats — the table's error state already surfaces failures
    } finally {
      setChipsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList, refreshKey]);

  useEffect(() => {
    void fetchBase();
  }, [fetchBase, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── pipeline stat chips (computed from the unfiltered fetched list) ────────
  const chips = useMemo(() => {
    const openQuotes = baseDocs.filter((d) => d.type === "QUOTE" && d.status === "OPEN").length;
    const openProformas = baseDocs.filter((d) => d.type === "PROFORMA" && d.status === "OPEN").length;
    const openOrders = baseDocs.filter((d) => d.type === "ORDER" && d.status === "OPEN").length;
    const invoiceBalance = baseDocs
      .filter(
        (d) =>
          d.type === "SALE" &&
          (d.status === "CREDIT" || d.status === "PARTIAL" || d.status === "OPEN") &&
          Number(d.balanceDue) > 0,
      )
      .reduce((sum, d) => sum + Number(d.balanceDue), 0);
    return { openQuotes, openProformas, openOrders, invoiceBalance };
  }, [baseDocs]);

  // ── detail loading ─────────────────────────────────────────────────────────
  const openDetail = useCallback(async (id: string) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await apiGet<{ document: DocumentDTO }>(
        `/api/v1/documents/${encodeURIComponent(id)}`,
      );
      setDetail(data.document);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── conversion dialog open (authoritative nextTargets come from the detail) ─
  const resetConvertForm = useCallback((dto: DocumentDTO) => {
    setConvertSource(dto);
    setTargetType(dto.nextTargets[0] ?? "SALE");
    setPayMethod("CASH");
    setPayAmount(dto.totalAmount); // default = full payment
    setUseCredit(false);
    setConvertValidUntil("");
    setConvertNotes("");
    setConvertError(null);
  }, []);

  const openConvertFromSummary = useCallback(
    async (summary: DocumentSummary) => {
      setDetailError(null);
      setDetailLoading(true);
      try {
        const data = await apiGet<{ document: DocumentDTO }>(
          `/api/v1/documents/${encodeURIComponent(summary.id)}`,
        );
        const dto = data.document;
        if (dto.status !== "OPEN" || dto.nextTargets.length === 0) {
          toast.error("This document has no available conversions");
          return;
        }
        setDetail(null);
        resetConvertForm(dto);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        setDetailLoading(false);
      }
    },
    [resetConvertForm],
  );

  const openConvertFromDetail = useCallback(
    (dto: DocumentDTO) => {
      setDetail(null);
      resetConvertForm(dto);
    },
    [resetConvertForm],
  );

  // ── convert submit ─────────────────────────────────────────────────────────
  async function submitConvert() {
    const src = convertSource;
    if (!src) return;
    if (targetType === "SALE") {
      const amount = Number(payAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        setConvertError("Enter a valid payment amount (0 or more)");
        return;
      }
      if (amount <= 0 && !useCredit && !src.customerId) {
        setConvertError("Zero payment needs a customer to carry the shortfall — attach one first");
        return;
      }
    }
    setConverting(true);
    setConvertError(null);
    try {
      const body: Record<string, unknown> = { sourceId: src.id, targetType };
      if (targetType === "SALE") {
        body.paymentMethod = payMethod;
        body.paymentAmount = Number(payAmount);
        body.useCredit = useCredit;
      } else {
        if (convertValidUntil) body.validUntil = `${convertValidUntil}T00:00:00+03:00`;
        if (convertNotes.trim()) body.notes = convertNotes.trim();
      }
      const data = await apiPost<{ document: DocumentDTO; sourceRef: string }>(
        "/api/v1/documents/convert",
        body,
      );
      toast.success(`Converted ${data.sourceRef} → ${data.document.ref}`);
      setConvertSource(null);
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Conversion failed";
      setConvertError(msg); // server message surfaced verbatim (409 stock, 400 credit limit)
      toast.error(msg);
    } finally {
      setConverting(false);
    }
  }

  // ── new quotation dialog ───────────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    try {
      const data = await apiGet<{ items: CustomerOption[] }>("/api/customers");
      setCustomers(data.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load customers");
    }
  }, []);

  const openNewQuotation = useCallback(() => {
    setNewOpen(true);
    setCustomers([]);
    setCustomerFilter("");
    setSelectedCustomerId("");
    setProdQuery("");
    setProdHits([]);
    setLines([]);
    setOrderDiscountPct("0");
    setVatInclusive(false);
    setNewValidUntil("");
    setNewNotes("");
    setFormError(null);
    void loadCustomers();
  }, [loadCustomers]);

  // Debounced product search (300 ms, stale-response guarded).
  useEffect(() => {
    if (!newOpen) return;
    const q = prodQuery.trim();
    if (!q) {
      setProdHits([]);
      setProdSearching(false);
      return;
    }
    const run = ++prodRunRef.current;
    setProdSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiGet<{ items: ProductHit[] }>(
          `/api/products?q=${encodeURIComponent(q)}&limit=20`,
        );
        if (prodRunRef.current !== run) return; // a newer keystroke superseded us
        setProdHits(data.items ?? []);
      } catch {
        if (prodRunRef.current === run) setProdHits([]);
      } finally {
        if (prodRunRef.current === run) setProdSearching(false);
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [newOpen, prodQuery]);

  const addDraftLine = useCallback((p: ProductHit) => {
    setLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev
        : [
            ...prev,
            {
              productId: p.id,
              sku: p.sku,
              description: p.name,
              uom: p.unit,
              unitPrice: p.sellingPrice,
              isTaxExempt: p.isTaxExempt,
              qty: "1",
              discountPct: "0",
            },
          ],
    );
  }, []);

  const removeDraftLine = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const patchDraftLine = useCallback((productId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }, []);

  // Live totals — the EXACT same math the server applies (computeCart).
  const draftTotals = useMemo(() => {
    if (lines.length === 0) return null;
    return computeCart(
      lines.map((l) => ({
        qty: Number(l.qty) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        discountPct: Number(l.discountPct) || 0,
        isTaxExempt: l.isTaxExempt,
        uom: l.uom,
        description: l.description,
      })),
      { orderDiscountPct: Number(orderDiscountPct) || 0, vatInclusive },
    );
  }, [lines, orderDiscountPct, vatInclusive]);

  const linesValid = lines.length > 0 && lines.every((l) => Number(l.qty) > 0);

  const filteredCustomerOptions = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    const list = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
    return list.slice(0, 30);
  }, [customers, customerFilter]);

  async function submitQuotation() {
    if (!linesValid) {
      setFormError("Add at least one line with a quantity greater than 0");
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        type: "QUOTE",
        customerId: selectedCustomerId || null,
        items: lines.map((l) => ({
          productId: l.productId,
          qty: Number(l.qty),
          discountPct: Number(l.discountPct) || 0,
        })),
        vatInclusive,
        orderDiscountPct: Number(orderDiscountPct) || 0,
        validUntil: newValidUntil ? `${newValidUntil}T00:00:00+03:00` : null,
        notes: newNotes.trim() || null,
      };
      const data = await apiPost<{ document: DocumentSummary }>("/api/v1/documents", body);
      toast.success(`Quotation ${data.document.ref} created`);
      setNewOpen(false);
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Quotation creation failed";
      setFormError(msg); // server message surfaced verbatim
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  // ── render helpers ─────────────────────────────────────────────────────────
  const selectTriggerClass = "h-11 sm:h-9 w-full sm:w-[170px] bg-white dark:bg-stone-950";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
            <FileText className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            Documents &amp; Quotations
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Quote → Proforma → Order → Invoice pipeline — convert any open document down the
            chain; paid invoices become receipts, unpaid balances become the debt ledger.
          </p>
        </div>
        <Button
          size="sm"
          className="min-h-[44px] gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 sm:min-h-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          onClick={openNewQuotation}
          aria-label="Create a new quotation"
        >
          <Plus className="h-4 w-4" aria-hidden /> New Quotation
        </Button>
      </div>

      {/* Pipeline stat chips */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {chipsLoading ? (
          <>
            <StatChipSkeleton />
            <StatChipSkeleton />
            <StatChipSkeleton />
            <StatChipSkeleton />
          </>
        ) : (
          <>
            <StatChip label="Open quotes" value={String(chips.openQuotes)} icon={<FileText className="h-3.5 w-3.5" aria-hidden />} tone="slate" />
            <StatChip label="Open proformas" value={String(chips.openProformas)} icon={<Repeat className="h-3.5 w-3.5" aria-hidden />} tone="amber" />
            <StatChip label="Open orders" value={String(chips.openOrders)} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} tone="emerald" />
            <StatChip label="Invoices balance due" value={formatKES(chips.invoiceBalance)} icon={<Banknote className="h-3.5 w-3.5" aria-hidden />} tone="rose" />
          </>
        )}
      </div>

      {/* Filters + table */}
      <Card className="border-stone-200 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Pipeline documents
            <Badge variant="outline" className="ml-auto font-normal text-[10px] text-stone-500 dark:text-stone-400">
              {loading ? "…" : `${docs.length} shown · limit 100`}
            </Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-end gap-2 pt-1 text-xs">
            <div className="space-y-1">
              <Label htmlFor="doc-type-filter" className="text-[11px] text-stone-500 dark:text-stone-400">Type</Label>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "ALL" | DocType)}>
                <SelectTrigger id="doc-type-filter" className={selectTriggerClass} aria-label="Filter by document type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  <SelectItem value="QUOTE">Quotations</SelectItem>
                  <SelectItem value="PROFORMA">Proformas</SelectItem>
                  <SelectItem value="ORDER">Orders</SelectItem>
                  <SelectItem value="SALE">Invoices</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-status-filter" className="text-[11px] text-stone-500 dark:text-stone-400">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "ALL" | DocStatus)}>
                <SelectTrigger id="doc-status-filter" className={selectTriggerClass} aria-label="Filter by document status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="CONVERTED">Converted</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CREDIT">Credit</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5 sm:min-h-0"
              onClick={refresh}
              aria-label="Refresh documents"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-4">
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{error}</span>
                <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={refresh}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry
                </Button>
              </div>
            </div>
          ) : loading ? (
            <TableRowsSkeleton />
          ) : docs.length === 0 ? (
            <div className="m-4 rounded-lg border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
              <FileText className="mx-auto h-8 w-8 text-stone-300 dark:text-stone-600" aria-hidden />
              <p className="mt-3 text-sm font-medium text-stone-700 dark:text-stone-300">
                No documents yet — create your first quotation
              </p>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Quotes convert into proformas, orders and invoices as the deal progresses.
              </p>
              <Button size="sm" className="mt-4 min-h-[44px] gap-1.5 sm:min-h-0" onClick={openNewQuotation}>
                <Plus className="h-4 w-4" aria-hidden /> New Quotation
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow className="bg-stone-50 dark:bg-stone-900/60">
                    <TableHead>Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Valid until</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((d) => {
                    const tone = validUntilTone(d.validUntil);
                    const created = safeDate(d.createdAt);
                    const validUntil = safeDate(d.validUntil);
                    // List rows carry no nextTargets — status + terminal-type gate
                    // here; the authoritative nextTargets gate the dialog itself.
                    const canConvert = d.status === "OPEN" && d.type !== "SALE";
                    return (
                      <TableRow key={d.id} className="dark:hover:bg-stone-900/60">
                        <TableCell className="font-mono text-xs font-medium text-stone-800 dark:text-stone-200">
                          {d.ref}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${TYPE_BADGE[d.type]}`}>
                            {TYPE_LABEL[d.type]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[d.status]}`}>
                            {d.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-stone-700 dark:text-stone-300">
                          {d.customerName ?? <span className="text-stone-400 dark:text-stone-500">Walk-in</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.itemCount}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatKES(Number(d.totalAmount))}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            Number(d.balanceDue) > 0
                              ? "font-medium text-rose-600 dark:text-rose-400"
                              : "text-stone-500 dark:text-stone-400",
                          )}
                        >
                          {formatKES(Number(d.balanceDue))}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-stone-500 dark:text-stone-400">
                          {created ? format(created, "d MMM yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell className={cn("whitespace-nowrap", tone ? VALID_UNTIL_CLASS[tone] : "text-stone-500 dark:text-stone-400")}>
                          {validUntil ? format(validUntil, "d MMM yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-[44px] gap-1 sm:min-h-0"
                              onClick={() => void openDetail(d.id)}
                              aria-label={`View ${d.ref}`}
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden /> View
                            </Button>
                            {canConvert && (
                              <Button
                                size="sm"
                                className="min-h-[44px] gap-1 bg-emerald-700 text-white hover:bg-emerald-800 sm:min-h-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                                onClick={() => void openConvertFromSummary(d)}
                                disabled={detailLoading}
                                aria-label={`Convert ${d.ref}`}
                              >
                                <Repeat className="h-3.5 w-3.5" aria-hidden /> Convert
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Detail dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={detail !== null || detailLoading || detailError !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setDetailError(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-3xl">
          {detailLoading ? (
            <div className="space-y-3 py-2" aria-busy>
              {/* Radix validates title/description presence on MOUNT — the
                  skeleton branch must carry them too (sr-only). */}
              <DialogTitle className="sr-only">Document</DialogTitle>
              <DialogDescription className="sr-only">
                Loading document details…
              </DialogDescription>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailError ? (
            <div>
              <DialogHeader>
                <DialogTitle>Document</DialogTitle>
                <DialogDescription>Could not load this document.</DialogDescription>
              </DialogHeader>
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{detailError}</span>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailError(null)}>Close</Button>
              </DialogFooter>
            </div>
          ) : detail ? (
            <div>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-base">
                  {detail.ref}
                  <Badge variant="outline" className={`font-mono text-[10px] ${TYPE_BADGE[detail.type]}`}>
                    {TYPE_LABEL[detail.type]}
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${STATUS_BADGE[detail.status]}`}>
                    {detail.status}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {detail.customerName
                    ? `Customer: ${detail.customerName}`
                    : "Walk-in document (no customer attached)"}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-1 space-y-4">
                {/* Meta */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800 sm:grid-cols-3">
                  <MetaItem label="Created by" value={detail.createdBy} />
                  <MetaItem label="Created at" value={fmtDateTime(detail.createdAt)} />
                  <MetaItem label="Branch" value={detail.branchCode} />
                  <MetaItem
                    label="Valid until"
                    value={fmtDate(detail.validUntil)}
                    className={validUntilTone(detail.validUntil) ? VALID_UNTIL_CLASS[validUntilTone(detail.validUntil) as "amber" | "rose"] : undefined}
                  />
                  <MetaItem label="VAT basis" value={detail.vatInclusive ? "VAT inclusive" : "VAT exclusive"} />
                  {detail.convertedFromRef && (
                    <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
                      <span className="shrink-0 text-stone-500 dark:text-stone-400">Source:</span>
                      <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                        <Repeat className="h-3 w-3 shrink-0" aria-hidden />
                        Converted from {detail.convertedFromRef}
                      </span>
                    </div>
                  )}
                </div>

                {detail.notes && (
                  <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-xs text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
                    <span className="font-medium">Notes: </span>
                    {detail.notes}
                  </div>
                )}

                {/* Line items */}
                <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow className="bg-stone-50 dark:bg-stone-900/60">
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit price</TableHead>
                        <TableHead className="text-right">Disc %</TableHead>
                        <TableHead className="text-right">Line net</TableHead>
                        <TableHead className="text-right">VAT 16%</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="text-stone-800 dark:text-stone-200">{it.description}</span>
                              <Badge
                                variant="outline"
                                className="px-1 text-[9px] text-stone-500 dark:text-stone-400"
                                title={it.taxCategory === "A" ? "Tax category A (exempt)" : "Tax category B (16% standard)"}
                              >
                                {it.taxCategory === "A" ? "A · exempt" : "B · 16%"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(Number(it.qty), it.uom)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(Number(it.unitPrice))}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(it.discountPct)}%</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(Number(it.lineNet))}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(Number(it.vatAmount))}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatKES(Number(it.lineTotal))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals */}
                <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800">
                  <TotalRow label="Subtotal" value={formatKES(Number(detail.subtotal))} />
                  <TotalRow label="Discounts" value={`− ${formatKES(Number(detail.discountAmount))}`} />
                  <TotalRow label={`VAT ${detail.vatInclusive ? "(included)" : "(16%)"}`} value={formatKES(Number(detail.vatAmount))} />
                  <Separator className="my-1.5" />
                  <TotalRow label="Total" value={formatKES(Number(detail.totalAmount))} strong />
                  <TotalRow label="Paid" value={formatKES(Number(detail.amountPaid))} />
                  <TotalRow
                    label="Balance due"
                    value={formatKES(Number(detail.balanceDue))}
                    strong={Number(detail.balanceDue) > 0}
                    className={Number(detail.balanceDue) > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
                  />
                </div>

                {/* Payments */}
                {detail.payments.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">Payments</p>
                    <ul className="space-y-1.5">
                      {detail.payments.map((p, i) => (
                        <li key={`${p.method}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className={`gap-1 text-[10px] ${PAYMENT_BADGE[p.method] ?? "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300"}`}>
                            {p.method === "CASH" ? (
                              <Banknote className="h-3 w-3" aria-hidden />
                            ) : p.method === "MPESA" ? (
                              <Smartphone className="h-3 w-3" aria-hidden />
                            ) : p.method === "BANK_TRANSFER" ? (
                              <Landmark className="h-3 w-3" aria-hidden />
                            ) : null}
                            {PAYMENT_LABEL[p.method] ?? p.method}
                          </Badge>
                          <span className="font-medium tabular-nums text-stone-800 dark:text-stone-200">
                            {formatKES(Number(p.amount))}
                          </span>
                          {safeDate(p.receivedAt) && (
                            <span className="text-stone-400 dark:text-stone-500">{fmtDateTime(p.receivedAt)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <DialogFooter className="mt-4 gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Close
                </Button>
                {detail.status === "OPEN" && detail.nextTargets.length > 0 && (
                  <Button
                    className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    onClick={() => openConvertFromDetail(detail)}
                  >
                    <Repeat className="h-4 w-4" aria-hidden /> Convert to {TARGET_LABEL[detail.nextTargets[0]]}
                  </Button>
                )}
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Conversion dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={convertSource !== null}
        onOpenChange={(open) => {
          if (!open && !converting) setConvertSource(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-3xl">
          {convertSource && (
            <div>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
                  Convert document
                </DialogTitle>
                <DialogDescription>
                  Progress {convertSource.ref} down the pipeline. Stock, credit limits and the
                  state machine are re-validated on submit.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-1 space-y-4">
                {/* Source summary */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-xs dark:border-stone-800 dark:bg-stone-900/60">
                  <span className="font-mono font-medium text-stone-800 dark:text-stone-200">{convertSource.ref}</span>
                  <Badge variant="outline" className={`text-[10px] ${TYPE_BADGE[convertSource.type]}`}>
                    {TYPE_LABEL[convertSource.type]}
                  </Badge>
                  <span className="text-stone-500 dark:text-stone-400">
                    {convertSource.customerName ?? "Walk-in"}
                  </span>
                  <span className="ml-auto font-medium tabular-nums text-stone-800 dark:text-stone-200">
                    {formatKES(Number(convertSource.totalAmount))}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="convert-target">Convert to</Label>
                  <Select
                    value={targetType}
                    onValueChange={(v) => setTargetType(v as ConvertTarget)}
                    disabled={converting}
                  >
                    <SelectTrigger id="convert-target" className="h-11 w-full bg-white sm:h-9 dark:bg-stone-950">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {convertSource.nextTargets.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TARGET_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Allowed from this document now: {convertSource.nextTargets.map((t) => TARGET_LABEL[t]).join(", ")}.
                  </p>
                </div>

                {targetType === "SALE" ? (
                  <div className="space-y-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                      Payment — converts to an invoice immediately
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="convert-pay-method">Method</Label>
                        <Select
                          value={payMethod}
                          onValueChange={(v) => setPayMethod(v as DocPaymentMethod)}
                          disabled={converting}
                        >
                          <SelectTrigger id="convert-pay-method" className="h-11 w-full bg-white sm:h-9 dark:bg-stone-950">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CASH">Cash</SelectItem>
                            <SelectItem value="MPESA">M-Pesa</SelectItem>
                            <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="convert-pay-amount">Amount received (KES)</Label>
                        <Input
                          id="convert-pay-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className="h-11 tabular-nums sm:h-9"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          disabled={converting}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          id="convert-use-credit"
                          checked={useCredit}
                          onCheckedChange={(v) => setUseCredit(v === true)}
                          disabled={converting || !convertSource.customerId}
                          className="size-5 sm:size-4"
                        />
                        <Label
                          htmlFor="convert-use-credit"
                          className={cn(!convertSource.customerId && "text-stone-400 dark:text-stone-500")}
                        >
                          Charge shortfall to customer store credit
                        </Label>
                      </div>
                      {!convertSource.customerId && (
                        <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                          <UserX className="h-3 w-3 shrink-0" aria-hidden />
                          Attach a customer on the quotation first
                        </p>
                      )}
                      {Number(payAmount) < Number(convertSource.totalAmount) && (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">
                          Shortfall{" "}
                          {formatKES(Math.max(0, Number(convertSource.totalAmount) - (Number(payAmount) || 0)))}
                          {useCredit ? " → charged to store credit" : " → recorded as balance due (credit invoice)"}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="space-y-1.5">
                      <Label htmlFor="convert-valid-until">Valid until (optional)</Label>
                      <Input
                        id="convert-valid-until"
                        type="date"
                        className="h-11 sm:h-9"
                        value={convertValidUntil}
                        onChange={(e) => setConvertValidUntil(e.target.value)}
                        disabled={converting}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="convert-notes">Notes (optional)</Label>
                      <Textarea
                        id="convert-notes"
                        rows={3}
                        placeholder="Carried over from the quotation — anything to add?"
                        value={convertNotes}
                        onChange={(e) => setConvertNotes(e.target.value)}
                        disabled={converting}
                      />
                    </div>
                  </div>
                )}

                {convertError && (
                  <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {convertError}
                  </p>
                )}
              </div>

              <DialogFooter className="mt-4 gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setConvertSource(null)} disabled={converting}>
                  Cancel
                </Button>
                <Button
                  className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  onClick={() => void submitConvert()}
                  disabled={converting}
                >
                  {converting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat className="h-4 w-4" aria-hidden />}
                  {converting ? "Converting…" : `Convert to ${TARGET_LABEL[targetType]}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── New quotation dialog ──────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={(open) => { if (!open && !creating) setNewOpen(false); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
              New quotation
            </DialogTitle>
            <DialogDescription>
              Build a quotation — it converts to proforma, order or invoice once the customer commits.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Customer picker */}
            <div className="space-y-2">
              <Label>Customer (optional)</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" aria-hidden />
                <Input
                  placeholder="Filter customers by name…"
                  className="h-11 pl-9"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  aria-label="Filter customers"
                />
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-1.5 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId("")}
                  className={cn(
                    "flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm",
                    selectedCustomerId === ""
                      ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
                  )}
                >
                  <UserX className="h-4 w-4 shrink-0" aria-hidden /> No customer (walk-in)
                  {selectedCustomerId === "" && <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden />}
                </button>
                {filteredCustomerOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(c.id)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm",
                      selectedCustomerId === c.id
                        ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                        : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.phoneMasked && (
                      <span className="shrink-0 font-mono text-[11px] text-stone-400 dark:text-stone-500">{c.phoneMasked}</span>
                    )}
                    {selectedCustomerId === c.id && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                  </button>
                ))}
                {filteredCustomerOptions.length === 0 && customerFilter.trim() !== "" && (
                  <p className="px-2 py-1.5 text-xs text-stone-400 dark:text-stone-500">
                    No customers match “{customerFilter.trim()}”.
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* Product search + add */}
            <div className="space-y-2">
              <Label>Add line items</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" aria-hidden />
                <Input
                  placeholder="Search products by name, SKU or barcode…"
                  className="h-11 pl-9"
                  value={prodQuery}
                  onChange={(e) => setProdQuery(e.target.value)}
                  aria-label="Search products"
                />
                {prodSearching && (
                  <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-600" aria-hidden />
                )}
              </div>
              {prodQuery.trim() !== "" && (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-1.5 dark:border-stone-800">
                  {prodHits.length === 0 && !prodSearching ? (
                    <p className="px-2 py-1.5 text-xs text-stone-400 dark:text-stone-500">
                      No products match “{prodQuery.trim()}”.
                    </p>
                  ) : (
                    prodHits.map((p) => {
                      const added = lines.some((l) => l.productId === p.id);
                      return (
                        <div
                          key={p.id}
                          className="flex min-h-[44px] items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-stone-50 dark:hover:bg-stone-900"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-stone-800 dark:text-stone-200">
                              {p.name}
                              <span className="ml-1.5 font-mono text-[11px] text-stone-400 dark:text-stone-500">{p.sku}</span>
                            </p>
                            <p className="text-[11px] text-stone-500 dark:text-stone-400">
                              {formatKES(Number(p.sellingPrice))} · {Number(p.stockQty)} {p.unit} in stock
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px] gap-1 sm:min-h-0"
                            onClick={() => addDraftLine(p)}
                            disabled={added}
                            aria-label={added ? `${p.name} already added` : `Add ${p.name}`}
                          >
                            {added ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                            {added ? "Added" : "Add"}
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Draft lines */}
            {lines.length > 0 && (
              <div className="space-y-2">
                <Label>Line items ({lines.length})</Label>
                <div className="space-y-2">
                  {lines.map((l) => {
                    const qty = Number(l.qty) || 0;
                    const lineNet = qty * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100);
                    return (
                      <div
                        key={l.productId}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2.5 dark:border-stone-800"
                      >
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{l.description}</p>
                          <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
                            {l.sku} · {formatKES(Number(l.unitPrice))} / {l.uom}
                            {l.isTaxExempt ? " · VAT exempt" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={`qty-${l.productId}`} className="sr-only">Quantity for {l.description}</Label>
                          <Input
                            id={`qty-${l.productId}`}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            aria-label={`Quantity for ${l.description}`}
                            className={cn(
                              "h-11 w-20 tabular-nums sm:h-9",
                              qty <= 0 && "border-rose-400 dark:border-rose-700",
                            )}
                            value={l.qty}
                            onChange={(e) => patchDraftLine(l.productId, { qty: e.target.value })}
                          />
                          <Label htmlFor={`disc-${l.productId}`} className="sr-only">Discount percent for {l.description}</Label>
                          <Input
                            id={`disc-${l.productId}`}
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            inputMode="decimal"
                            aria-label={`Discount percent for ${l.description}`}
                            className="h-11 w-16 tabular-nums sm:h-9"
                            value={l.discountPct}
                            onChange={(e) => patchDraftLine(l.productId, { discountPct: e.target.value })}
                          />
                        </div>
                        <span className="w-24 text-right text-sm font-medium tabular-nums text-stone-800 dark:text-stone-200">
                          {formatKES(lineNet)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-8 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                          onClick={() => removeDraftLine(l.productId)}
                          aria-label={`Remove ${l.description}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Options row */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="order-discount">Order discount %</Label>
                <Input
                  id="order-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  inputMode="decimal"
                  className="h-11 tabular-nums sm:h-9"
                  value={orderDiscountPct}
                  onChange={(e) => setOrderDiscountPct(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-valid-until">Valid until (optional)</Label>
                <Input
                  id="quote-valid-until"
                  type="date"
                  className="h-11 sm:h-9"
                  value={newValidUntil}
                  onChange={(e) => setNewValidUntil(e.target.value)}
                />
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="vat-inclusive"
                    checked={vatInclusive}
                    onCheckedChange={(v) => setVatInclusive(v === true)}
                    className="size-5 sm:size-4"
                  />
                  <Label htmlFor="vat-inclusive" className="text-xs">
                    VAT inclusive (prices include 16%)
                  </Label>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quote-notes">Notes (optional)</Label>
              <Textarea
                id="quote-notes"
                rows={2}
                placeholder="Delivery terms, site reference, follow-up plan…"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>

            {/* Live totals — same math as the server (computeCart) */}
            {draftTotals && (
              <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800">
                <TotalRow label="Subtotal" value={formatKES(draftTotals.totals.grossSubtotal)} />
                <TotalRow
                  label="Discounts"
                  value={`− ${formatKES(draftTotals.totals.lineDiscounts + draftTotals.totals.orderDiscount)}`}
                />
                <TotalRow
                  label={`VAT ${vatInclusive ? "(included)" : "(16%)"}`}
                  value={formatKES(draftTotals.totals.vatAmount)}
                />
                <Separator className="my-1.5" />
                <TotalRow label="Total" value={formatKES(draftTotals.totals.grandTotal)} strong />
              </div>
            )}

            {formError && (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-600 dark:text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {formError}
              </p>
            )}
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              className="min-h-[44px] gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 sm:min-h-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              onClick={() => void submitQuotation()}
              disabled={creating || !linesValid}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              {creating ? "Creating…" : "Create quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────────

const CHIP_TONE: Record<"slate" | "amber" | "emerald" | "rose", { icon: string; value: string }> = {
  slate: { icon: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300", value: "text-slate-900 dark:text-slate-100" },
  amber: { icon: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400", value: "text-amber-900 dark:text-amber-300" },
  emerald: { icon: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", value: "text-emerald-900 dark:text-emerald-300" },
  rose: { icon: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400", value: "text-rose-900 dark:text-rose-300" },
};

function StatChip({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: "slate" | "amber" | "emerald" | "rose";
}) {
  const t = CHIP_TONE[tone];
  return (
    <div className="rounded-xl border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
      <div className="flex items-center gap-1.5">
        <span className={cn("flex size-5 items-center justify-center rounded", t.icon)}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {label}
        </span>
      </div>
      <p className={cn("mt-1.5 truncate text-xl font-semibold tabular-nums", t.value)}>{value}</p>
    </div>
  );
}

function MetaItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-stone-400 dark:text-stone-500">{label}</p>
      <p className={cn("truncate font-medium text-stone-800 dark:text-stone-200", className)}>{value}</p>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "font-semibold text-stone-900 dark:text-stone-100" : "text-stone-700 dark:text-stone-300",
          className,
        )}
      >
        {value}
      </span>
    </div>
  );
}
